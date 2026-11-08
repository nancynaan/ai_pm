// Live smoke test against your real Jira and Confluence, read only: the health checks, the
// baseline pages, and a dry-run of every published feature (its documents and, once approved,
// its Jira backlog) to show that Confluence and Jira still match what the pipeline wrote.
// Nothing is written: the gateway refuses every write, the publishers run in dry-run, nothing
// is saved to the database and no Claude call is made.
//
//   docker compose exec app node apps/server/dist/evals/smoke-cli.js
import type { RunEvent } from '@ai-pm/shared';
import { DocumentDraft } from '../agents/schemas.js';
import { loadSeedData } from '../baseline/seed-data.js';
import { pageSyncKey } from '../baseline/store.js';
import { atlassianCredentials, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { buildProbes } from '../health/checks.js';
import { createAtlassianGateway } from '../integrations/atlassian/index.js';
import { createClaudeCli } from '../integrations/claude-cli.js';
import { loadAgentDefinitions } from '../agents/registry.js';
import { agentVersion, createRepositories } from '../pipeline.js';
import { createBacklogWriter, initialBacklogBlock } from '../pipeline-engine/backlog/write.js';
import { createContextBuilder } from '../pipeline-engine/context.js';
import { loadDocumentInputs } from '../pipeline-engine/documents/load.js';
import { createDocumentPublisher } from '../pipeline-engine/documents/publish.js';
import { renderDocuments } from '../pipeline-engine/documents/render.js';
import { loadTemplates } from '../pipeline-engine/documents/templates.js';
import type { StageContext } from '../pipeline-engine/engine.js';
import { prepareBacklog } from '../pipeline-engine/stages/backlog.js';
import { drizzleSyncLog } from '../sync/sync-log.js';

const tally = (xs: { status: string }[]) =>
  Object.entries(
    xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {}),
  )
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');

async function main() {
  const config = loadConfig();
  const credentials = atlassianCredentials(config);
  if (!credentials) throw new Error('Atlassian is not configured in .env; the smoke test needs it.');
  const gateway = createAtlassianGateway(credentials, { readOnly: true });
  const { db, pool } = createDb(config.databaseUrl);
  let failures = 0;
  let drift = 0;
  try {
    console.log('Health');
    const probes = buildProbes({
      config,
      query: (sql) => pool.query(sql),
      atlassian: gateway,
      claude: createClaudeCli({ cliPath: config.claude.cliPath }),
      claudeToken: process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || undefined,
    });
    for (const probe of probes) {
      const result = await probe.run().catch((err: unknown) => ({
        status: 'error' as const,
        detail: err instanceof Error ? err.message : String(err),
      }));
      if (result.status !== 'ok') failures++;
      console.log(`  ${result.status === 'ok' ? 'ok  ' : 'FAIL'} ${probe.name}: ${result.detail}`);
    }

    const store = drizzleSyncLog(db);
    console.log('Baseline pages in Confluence');
    const seed = loadSeedData();
    let found = 0;
    const missing: string[] = [];
    for (const page of seed.pages) {
      const id = (await store.get(pageSyncKey(page.type)))?.externalId;
      const remote = id ? await gateway.confluence.getPage(id) : null;
      if (remote) found++;
      else missing.push(page.type);
    }
    if (missing.length) failures++;
    console.log(
      `  ${missing.length ? 'FAIL' : 'ok  '} ${found} of ${seed.pages.length} found${missing.length ? `; missing: ${missing.join(', ')}` : ''}`,
    );

    const repos = createRepositories(db);
    const context = createContextBuilder({
      db,
      atlassian: gateway,
      jiraProjectKey: config.atlassian.jiraProjectKey,
    });
    const templates = loadTemplates();
    const { siteUrl, jiraProjectKey, confluenceSpaceKey } = config.atlassian;
    const publisher = createDocumentPublisher({
      gateway,
      store,
      mode: 'dry-run',
      siteUrl,
      jiraProjectKey,
      spaceKey: confluenceSpaceKey,
    });
    const backlogWriter = createBacklogWriter({ gateway, store, mode: 'dry-run', jiraProjectKey, siteUrl });

    console.log('Published features (dry-run: what a re-publish would change)');
    for (const run of await repos.repo.listRuns()) {
      const set = await repos.documents.setOf(run.id);
      const draft = DocumentDraft.safeParse(set?.draft);
      if (!set?.publishedAt || !draft.success) continue;
      const inputs = await loadDocumentInputs(
        { analysis: repos.analysis, context, documents: repos.documents, repo: repos.repo },
        run,
        set.faNumber,
      );
      const { results } = await publisher.publish(inputs, (links) =>
        renderDocuments(inputs, draft.data, templates, links),
      );
      const changed = results.filter((r) => r.status !== 'unchanged' && r.status !== 'not_needed');
      drift += changed.length;
      console.log(`  FA-${set.faNumber} ${run.title} (${run.state})`);
      console.log(
        `    ${changed.length ? 'WARN' : 'ok  '} documents: ${tally(results)}${changed.length ? `; would change: ${changed.map((r) => r.type).join(', ')}` : ''}`,
      );

      const backlog = await repos.backlog.backlogOf(run.id);
      if (!backlog?.epic) continue;
      const events: RunEvent[] = [];
      const ctx = {
        run,
        executionId: 'smoke',
        repo: repos.repo,
        baselineDigest: await repos.repo.baselineDigest(run.projectId),
        emit: async (e: RunEvent) => void events.push(e),
      } as StageContext;
      const services = {
        ask: () =>
          Promise.reject(new Error('the smoke test makes no Claude calls; the cached draft is stale')),
        analysis: repos.analysis,
        context,
        backlog: {
          repo: repos.backlog,
          documents: repos.documents,
          writer: backlogWriter,
          republish: async () => null,
          // The server's version: a draft cached by the live stage is reused, and no call is made.
          builderVersion: agentVersion(loadAgentDefinitions().get('backlog-builder')!),
        },
      };
      const { inputs: bInputs, plan } = await prepareBacklog(services as never, ctx, {
        useCache: true,
      });
      const result = await backlogWriter.writeIssues(run.id, plan, bInputs.briefUrl);
      const block = await backlogWriter.writeInitialBacklog(
        run.id,
        `aipm-fa-${bInputs.docs.faNumber}`,
        initialBacklogBlock(`FA-${bInputs.docs.faNumber}`, plan, result, bInputs.briefUrl),
      );
      const all = [result.epic, ...result.stories];
      const changedIssues = all.filter((x) => x.status !== 'unchanged');
      drift += changedIssues.length + result.links.planned + (block.status === 'unchanged' ? 0 : 1);
      console.log(
        `    ${changedIssues.length || result.links.planned ? 'WARN' : 'ok  '} Jira: Epic ${result.epic.key ?? '-'} ${result.epic.status}; stories ${tally(result.stories)}; Blocks links ${result.links.unchanged} in place, ${result.links.planned} missing`,
      );
      console.log(
        `    ${block.status === 'unchanged' ? 'ok  ' : 'WARN'} Initial Product Backlog: ${block.status}`,
      );
    }

    console.log(
      failures
        ? `\nFAIL: ${failures} check(s) failed.`
        : `\nPASS: Jira and Confluence are reachable${drift ? `; ${drift} item(s) differ from what the pipeline last wrote (edited by hand, or a re-publish is due)` : ' and match what the pipeline wrote'}. Nothing was written.`,
    );
  } finally {
    await pool.end();
  }
  if (failures) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
