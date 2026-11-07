// Backlog dry-run: runs stage 06 up to the Jira write on a saved run, without changing the run.
// The backlog builder writes the stories (one Claude call plus repairs, or none when the cached
// draft still fits), the gates check them, and the writer runs in dry-run against a read-only
// gateway: it reads Jira and Confluence and reports what a live run would create or update.
// Nothing is written to Jira or Confluence; the draft is cached in backlog_sets, so the live
// stage after Approve reuses it.
//
//   docker compose exec app node apps/server/dist/evals/backlog-cli.js [--run <runId>] [--fresh]
import type { RunEvent } from '@ai-pm/shared';
import { desc } from 'drizzle-orm';
import { loadAgentDefinitions } from '../agents/registry.js';
import { type CallRecord, createAgentRunner } from '../agents/runner.js';
import { AGENT_SCHEMAS } from '../agents/schemas.js';
import { atlassianCredentials, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { assessments } from '../db/schema.js';
import { createAtlassianGateway } from '../integrations/atlassian/index.js';
import { createClaudeCli } from '../integrations/claude-cli.js';
import { createAnalysisRepository } from '../pipeline-engine/analysis-repository.js';
import { coverageGaps } from '../pipeline-engine/backlog/plan.js';
import { createBacklogRepository } from '../pipeline-engine/backlog/repository.js';
import { createBacklogWriter, initialBacklogBlock } from '../pipeline-engine/backlog/write.js';
import { createContextBuilder } from '../pipeline-engine/context.js';
import { createDocumentRepository } from '../pipeline-engine/documents/repository.js';
import type { StageContext } from '../pipeline-engine/engine.js';
import { createRunRepository, type RunRepository } from '../pipeline-engine/repository.js';
import { createAgentAsker } from '../pipeline-engine/services.js';
import { prepareBacklog } from '../pipeline-engine/stages/backlog.js';
import { drizzleSyncLog } from '../sync/sync-log.js';
import { createHash } from 'node:crypto';
import { loadSkill } from '../agents/registry.js';

function runArg(args: string[]): string | null {
  const i = args.indexOf('--run');
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

async function main() {
  const config = loadConfig();
  const { db, pool } = createDb(config.databaseUrl);
  try {
    const repo = createRunRepository(db);
    const analysis = createAnalysisRepository(db);
    const documents = createDocumentRepository(db);
    const runId =
      runArg(process.argv.slice(2)) ??
      (
        await db
          .select({ id: assessments.runId })
          .from(assessments)
          .orderBy(desc(assessments.updatedAt))
          .limit(1)
      )[0]?.id;
    if (!runId) throw new Error('No run with an assessment; run /demo first or pass --run <id>.');
    const run = await repo.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    // Read-only: the gateway refuses every write, and the writer is in dry-run anyway.
    const credentials = atlassianCredentials(config);
    const gateway = credentials ? createAtlassianGateway(credentials, { readOnly: true }) : undefined;
    const store = drizzleSyncLog(db);
    const definitions = loadAgentDefinitions();
    const builder = definitions.get('backlog-builder')!;
    const writer = createBacklogWriter({
      gateway,
      store,
      mode: 'dry-run',
      jiraProjectKey: config.atlassian.jiraProjectKey,
      siteUrl: config.atlassian.siteUrl,
    });

    const calls: CallRecord[] = [];
    const events: RunEvent[] = [];
    const ctx: StageContext = {
      run,
      executionId: 'backlog-dry-run',
      repo: {
        answeredQuestionnaires: (id: string) => repo.answeredQuestionnaires(id),
        latestStageOutput: (id: string, stage: Parameters<RunRepository['latestStageOutput']>[1]) =>
          repo.latestStageOutput(id, stage),
        recordCall: async (_r: string, _e: string, call: CallRecord) => void calls.push(call),
      } as unknown as RunRepository,
      baselineDigest: await repo.baselineDigest(run.projectId),
      emit: async (e) => void events.push(e),
    };
    const services = {
      ask: createAgentAsker({
        runner: createAgentRunner({ claude: createClaudeCli({ cliPath: config.claude.cliPath }) }),
        definitions,
        schemas: AGENT_SCHEMAS,
        defaultModel: config.claude.model,
      }),
      analysis,
      context: createContextBuilder({
        db,
        atlassian: gateway,
        jiraProjectKey: config.atlassian.jiraProjectKey,
      }),
      backlog: {
        repo: createBacklogRepository(db),
        documents,
        writer,
        republish: async () => null,
        // Must match the server's builderVersion, so the live stage reuses this draft.
        builderVersion: createHash('sha256')
          .update(JSON.stringify(builder))
          .update(builder.skills.map((name) => loadSkill(name).body).join('\n'))
          .digest('hex'),
      },
    };

    console.log(`- run ${run.id} (${run.state}): ${run.title}`);
    const started = Date.now();
    const { inputs, draft, plan, cached } = await prepareBacklog(services, ctx, {
      useCache: !process.argv.includes('--fresh'),
    });
    const tokens = calls.reduce((n, c) => n + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);
    console.log(
      cached
        ? '  draft: cached (no Claude call)'
        : `  calls: ${calls.map((c) => c.status).join(' → ')} (${calls.length}; ${tokens.toLocaleString('en-US')} tokens; ${Math.round((Date.now() - started) / 1000)} s)`,
    );
    for (const c of calls.filter((x) => x.status === 'invalid_output')) console.log(`  repaired: ${c.error}`);
    console.log(`  coverage gaps: ${coverageGaps(inputs).join(', ') || 'none'}`);
    console.log(
      `  Epic [${plan.epic.priority}] ${plan.epic.summary} | components: ${plan.epic.components.join(', ')}`,
    );
    for (const s of plan.stories) {
      const text = draft.stories.find((d) => d.ref === s.localId)!;
      console.log(
        `  ${s.localId} [${s.type}, ${s.priority}, AI ${s.aiEstimate}] ${s.summary}${s.blockedBy.length ? ` (blocked by ${s.blockedBy.join(', ')})` : ''} | ${text.acceptanceCriteria.length} scenarios`,
      );
    }

    const result = await writer.writeIssues(run.id, plan, inputs.briefUrl);
    const tally = (xs: { status: string }[]) =>
      Object.entries(
        xs.reduce<Record<string, number>>((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {}),
      )
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');
    console.log(
      `  Jira (dry-run): Epic ${result.epic.status}${result.epic.key ? ` ${result.epic.key}` : ''}; stories ${tally(result.stories)}; Blocks links ${result.links.planned} planned, ${result.links.unchanged} existing`,
    );
    const block = await writer.writeInitialBacklog(
      run.id,
      `aipm-fa-${inputs.docs.faNumber}`,
      initialBacklogBlock(`FA-${inputs.docs.faNumber}`, plan, result, inputs.briefUrl),
    );
    console.log(
      `  Initial Product Backlog (dry-run): ${block.status}${block.note ? ` (${block.note})` : ''}`,
    );
    if (process.argv.includes('--show')) {
      console.log('\n--- Epic description ---\n' + plan.epic.description);
      console.log('\n--- ' + plan.stories[0]!.localId + ' description ---\n' + plan.stories[0]!.description);
    }
    console.log('PASS: the backlog gates found nothing; nothing was written to Jira or Confluence');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
