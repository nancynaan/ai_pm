// Writer-only eval: runs the pm-writer once on a saved run's real data (analysis, assessment,
// discovery) and checks the draft and the rendered documents with the document validator. One
// Claude call (plus repairs); the cached draft is ignored. Writes nothing to the database,
// Jira or Confluence.
//
//   docker compose exec app node apps/server/dist/evals/writer-cli.js [--run <runId>]
import type { RunEvent } from '@ai-pm/shared';
import { desc } from 'drizzle-orm';
import { loadAgentDefinitions } from '../agents/registry.js';
import { type CallRecord, createAgentRunner } from '../agents/runner.js';
import { AGENT_SCHEMAS, type DocumentDraft } from '../agents/schemas.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { assessments } from '../db/schema.js';
import { createAnalysisRepository } from '../pipeline-engine/analysis-repository.js';
import { needsRoadmapProposal } from '../pipeline-engine/calculators/baseline.js';
import { createContextBuilder } from '../pipeline-engine/context.js';
import { buildFigures } from '../pipeline-engine/documents/figures.js';
import { loadDocumentInputs } from '../pipeline-engine/documents/load.js';
import { writerPrompt } from '../pipeline-engine/documents/prompt.js';
import { renderDocuments } from '../pipeline-engine/documents/render.js';
import { createDocumentRepository } from '../pipeline-engine/documents/repository.js';
import { loadTemplates } from '../pipeline-engine/documents/templates.js';
import { checkDraft, checkRendered, draftCheckContext } from '../pipeline-engine/documents/validate.js';
import type { StageContext } from '../pipeline-engine/engine.js';
import { createRunRepository, type RunRepository } from '../pipeline-engine/repository.js';
import { createAgentAsker } from '../pipeline-engine/services.js';
import { createClaudeCli } from '../integrations/claude-cli.js';

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

    const set = await documents.setOf(run.id);
    const inputs = await loadDocumentInputs(
      { analysis, context: createContextBuilder({ db }), documents, repo },
      run,
      set?.faNumber ?? 0,
    );
    const templates = loadTemplates();
    const roadmapNeeded = needsRoadmapProposal(inputs.assessment.roadmapImpact);
    const checks = draftCheckContext(inputs, roadmapNeeded);

    // Calls are counted here, not written to llm_calls.
    const calls: CallRecord[] = [];
    const events: RunEvent[] = [];
    const ctx: StageContext = {
      run,
      executionId: 'writer-eval',
      repo: {
        recordCall: async (_r: string, _e: string, call: CallRecord) => void calls.push(call),
      } as unknown as RunRepository,
      baselineDigest: await repo.baselineDigest(run.projectId),
      emit: async (e) => void events.push(e),
    };
    const ask = createAgentAsker({
      runner: createAgentRunner({ claude: createClaudeCli({ cliPath: config.claude.cliPath }) }),
      definitions: loadAgentDefinitions(),
      schemas: AGENT_SCHEMAS,
      defaultModel: config.claude.model,
    });

    console.log(`- ${inputs.featureName} (run ${run.id}): writing…`);
    const started = Date.now();
    const draft = await ask<DocumentDraft>(
      ctx,
      'pm-writer',
      writerPrompt(inputs, buildFigures(inputs), templates, roadmapNeeded),
      {
        check: (d) => checkDraft(d, checks),
      },
    );
    const docs = renderDocuments(inputs, draft, templates, {
      brief: null,
      riskRegister: null,
      assumptionLog: null,
    });
    const problems = [...checkDraft(draft, checks), ...checkRendered(docs, inputs)];

    const covered = new Set(draft.requirements.acceptanceCriteria.map((c) => c.requirementCode));
    const figuresUsed = new Set(docs.flatMap((d) => Object.keys(d.figures)));
    const tokens = calls.reduce((n, c) => n + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);
    console.log(
      `  calls: ${calls.map((c) => c.status).join(' → ')} (${calls.length}; ${tokens.toLocaleString('en-US')} tokens; ${Math.round((Date.now() - started) / 1000)} s)`,
    );
    for (const c of calls.filter((x) => x.status === 'invalid_output')) console.log(`  repaired: ${c.error}`);
    console.log(
      `  documents: ${docs.filter((d) => d.needed).length} rendered; roadmap proposal ${roadmapNeeded ? 'needed' : 'not needed'} (${draft.roadmap ? 'written' : 'null'})`,
    );
    console.log(
      `  acceptance criteria: ${covered.size} requirements covered, ${checks.mvpCodes.filter((c) => !covered.has(c)).length} MVP requirements missing`,
    );
    console.log(
      `  user flows ${draft.requirements.userFlows.length}, business rules ${draft.requirements.businessRules.length}, figures cited ${figuresUsed.size}`,
    );
    console.log(problems.length ? `FAIL: ${problems.join(' | ')}` : 'PASS: the validator found nothing');
    if (problems.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

