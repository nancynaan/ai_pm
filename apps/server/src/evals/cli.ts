// Eval set v1: runs each sample feature through the real intake, elicitation and analysis stages
// (real Claude calls, real baseline and Jira backlog, no Jira writes) and checks the outcome.
//
//   docker compose exec app node apps/server/dist/evals/cli.js [--only ghost-race,cloud-save]
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Questionnaire, RunEvent, RunState } from '@ai-pm/shared';
import { parse } from 'yaml';
import { z } from 'zod';
import { loadAgentDefinitions } from '../agents/registry.js';
import { createAgentRunner, type CallRecord } from '../agents/runner.js';
import { AGENT_SCHEMAS } from '../agents/schemas.js';
import { atlassianCredentials, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { projects } from '../db/schema.js';
import type { AnalysisRepository, AnalysisToSave } from '../harness/analysis-repository.js';
import { createContextBuilder } from '../harness/context.js';
import type { StageContext, StageHandler } from '../harness/orchestrator.js';
import type { RunRecord, RunRepository } from '../harness/repository.js';
import { createAgentAsker, type StageServices } from '../harness/services.js';
import { analyzingStage } from '../harness/stages/analyzing.js';
import { elicitingStage } from '../harness/stages/eliciting.js';
import { intakeStage } from '../harness/stages/intake.js';
import { createAtlassianGateway } from '../integrations/atlassian/index.js';
import { createClaudeCli } from '../integrations/claude-cli.js';

const FEATURES_FILE = fileURLToPath(new URL('../../../../evals/features.yaml', import.meta.url));
const featuresSchema = z.object({
  features: z.array(
    z.object({
      id: z.string(),
      expected: z.enum(['cosmetic', 'feature_extension', 'core_engine']),
      description: z.string(),
    }),
  ),
});
const CORE_QUESTIONS = ['goal', 'kpi_impact', 'deadline', 'budget'];

interface Result {
  id: string;
  expected: string;
  magnitude: string;
  questions: number[];
  coreAsked: string;
  requirements: number;
  calls: number;
  tokens: number;
  seconds: number;
  ok: boolean;
  error?: string;
}

/** In-memory run state, so the eval writes nothing to the database or Jira. */
function memoryRun(run: RunRecord, calls: CallRecord[]) {
  const questionnaires: (Questionnaire & { answers?: Record<string, string[]> })[] = [];
  const outputs = new Map<RunState, unknown>();
  let analysis: AnalysisToSave | undefined;
  let assumptions: string[] = [];
  const repo = {
    latestStageOutput: async (_id: string, stage: RunState) => outputs.get(stage) ?? null,
    answeredQuestionnaires: async () =>
      questionnaires.filter((q) => q.answers).map((q) => ({ ...q, answers: q.answers! })),
    latestDecision: async () => null,
    recordCall: async (_r: string, _e: string, call: CallRecord) => void calls.push(call),
    async saveQuestionnaire(_id: string, round: number, questions: Questionnaire['questions']) {
      const q = { id: randomUUID(), round, questions };
      questionnaires.push(q);
      return q;
    },
  } as unknown as RunRepository;
  const analysisRepo = {
    replaceElicitationAssumptions: async (_id: string, items: { text: string; reason: string }[]) =>
      void (assumptions = items.map((a) => `${a.text} (${a.reason})`)),
    elicitationAssumptions: async () => assumptions,
    saveAnalysis: async (_id: string, a: AnalysisToSave) => {
      analysis = a;
      return new Map();
    },
  } as unknown as AnalysisRepository;
  /** Answers every open question with its first option, like a decisive client. */
  const answerOpen = () => {
    for (const q of questionnaires.filter((x) => !x.answers)) {
      q.answers = Object.fromEntries(
        q.questions.map((question) => [question.id, [question.options[0]!.value]]),
      );
    }
  };
  return { repo, analysisRepo, questionnaires, outputs, answerOpen, analysis: () => analysis };
}

async function main() {
  const config = loadConfig();
  // --only a,b  or  --only=a,b
  const args = process.argv.slice(2);
  const flag = args.indexOf('--only');
  const only =
    args.find((a) => a.startsWith('--only='))?.slice(7) ?? (flag >= 0 ? args[flag + 1] : undefined);
  const wanted = only ? new Set(only.split(',')) : null;
  const { features } = featuresSchema.parse(parse(readFileSync(FEATURES_FILE, 'utf8')));

  const { db, pool } = createDb(config.databaseUrl);
  const [project] = await db.select().from(projects).limit(1);
  if (!project) throw new Error('No project baseline in the database; run the seed first.');
  const credentials = atlassianCredentials(config);
  const context = createContextBuilder({
    db,
    atlassian: credentials && createAtlassianGateway(credentials, { readOnly: true }),
    jiraProjectKey: config.atlassian.jiraProjectKey,
  });
  const ask = createAgentAsker({
    runner: createAgentRunner({ claude: createClaudeCli({ cliPath: config.claude.cliPath }) }),
    definitions: loadAgentDefinitions(),
    schemas: AGENT_SCHEMAS,
    defaultModel: config.claude.model,
  });

  const results: Result[] = [];
  try {
    for (const feature of features.filter((f) => !wanted || wanted.has(f.id))) {
      const started = Date.now();
      const calls: CallRecord[] = [];
      const run: RunRecord = {
        id: randomUUID(),
        state: 'intake',
        failedState: null,
        error: null,
        title: feature.id,
        description: feature.description,
        projectId: project.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const memory = memoryRun(run, calls);
      const events: RunEvent[] = [];
      const ctx: StageContext = {
        run,
        executionId: 'eval',
        repo: memory.repo,
        baselineDigest: project.baselineDigest,
        emit: async (e) => void events.push(e),
      };
      const services: StageServices = {
        ask,
        createDraftEpic: async () => ({ key: null, url: null, note: '(eval: no Epic)' }),
        analysis: memory.analysisRepo,
        context,
      };
      const step = async (stage: RunState, handler: StageHandler) => {
        const outcome = await handler(ctx);
        memory.outputs.set(stage, outcome.output);
        return outcome.next;
      };

      process.stdout.write(`- ${feature.id}: `);
      try {
        await step('intake', intakeStage(services));
        memory.answerOpen();
        let next = await step('eliciting', elicitingStage(services));
        if (next === 'awaiting_answers') {
          memory.answerOpen();
          next = await step('eliciting', elicitingStage(services));
        }
        await step('analyzing', analyzingStage(services));
        const saved = memory.analysis()!;
        const firstIds = memory.questionnaires[0]?.questions.map((q) => q.id) ?? [];
        const result: Result = {
          id: feature.id,
          expected: feature.expected,
          magnitude: saved.magnitude,
          questions: memory.questionnaires.map((q) => q.questions.length),
          coreAsked: `${CORE_QUESTIONS.filter((c) => firstIds.includes(c)).length}/4`,
          requirements: saved.analysis.requirements.length,
          calls: calls.length,
          tokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0),
          seconds: Math.round((Date.now() - started) / 1000),
          ok: false,
        };
        result.ok =
          result.magnitude === feature.expected &&
          (result.questions[0] ?? 0) <= 8 &&
          result.questions.length <= 2 &&
          (result.questions[1] ?? 0) <= 3;
        results.push(result);
        console.log(`${result.ok ? 'PASS' : 'FAIL'} (${result.magnitude}, ${result.seconds} s)`);
        const impacts = saved.impact.componentImpacts
          .filter((i) => i.level !== 'none')
          .map((i) => `${i.component} ${i.level}`)
          .join(', ');
        console.log(`    impacts: ${impacts}`);
        if (!result.ok) {
          // Why the model rated the deciding components as it did, to tell a prompt gap from a fair call.
          for (const i of saved.impact.componentImpacts.filter(
            (x) => x.level === 'medium' || x.level === 'high',
          )) {
            console.log(`    why ${i.component} ${i.level}: ${i.rationale}`);
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        results.push({
          id: feature.id,
          expected: feature.expected,
          magnitude: '-',
          questions: [],
          coreAsked: '-',
          requirements: 0,
          calls: calls.length,
          tokens: 0,
          seconds: Math.round((Date.now() - started) / 1000),
          ok: false,
          error,
        });
        console.log(`ERROR ${error}`);
        if (err instanceof Error && err.name === 'UsageLimitReached') break;
      }
    }
  } finally {
    await pool.end();
  }

  console.log('\n| Feature | Expected | Got | Questions | Core asked | Reqs | Calls | Tokens | Time |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| ${r.id} | ${r.expected} | ${r.magnitude}${r.ok ? '' : ' ✗'} | ${r.questions.join(' + ') || '-'} | ${r.coreAsked} | ${r.requirements} | ${r.calls} | ${r.tokens.toLocaleString('en-US')} | ${r.seconds} s |`,
    );
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} passed.`);
  for (const r of results.filter((x) => x.error)) console.log(`${r.id}: ${r.error}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
