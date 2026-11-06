// Eval set v2: runs each sample feature through the real intake, discovery, analysis and assessment stages
// (real Claude calls, real baseline and Jira backlog, no Jira writes) and checks the outcome.
//
//   docker compose exec app node apps/server/dist/evals/cli.js [--only ghost-race,cloud-save]
import { randomUUID } from 'node:crypto';
import { type Assessment, NOT_SURE, type Questionnaire, type RunEvent, type RunState } from '@ai-pm/shared';
import { loadAgentDefinitions } from '../agents/registry.js';
import { createAgentRunner, type CallRecord } from '../agents/runner.js';
import { AGENT_SCHEMAS } from '../agents/schemas.js';
import { atlassianCredentials, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { projects } from '../db/schema.js';
import {
  type AnalysisRepository,
  type AnalysisToSave,
  requirementCodes,
  type StoredAnalysis,
} from '../pipeline-engine/analysis-repository.js';
import { createContextBuilder } from '../pipeline-engine/context.js';
import { loadAssessmentConfig } from '../pipeline-engine/assessment-config.js';
import { loadDiscoveryConfig } from '../pipeline-engine/discovery-config.js';
import type { StageContext, StageHandler } from '../pipeline-engine/engine.js';
import type { RunRecord, RunRepository } from '../pipeline-engine/repository.js';
import { createAgentAsker, type StageServices } from '../pipeline-engine/services.js';
import { analyzingStage } from '../pipeline-engine/stages/analyzing.js';
import { estimatingStage } from '../pipeline-engine/stages/estimating.js';
import { elicitingStage } from '../pipeline-engine/stages/eliciting.js';
import { intakeStage } from '../pipeline-engine/stages/intake.js';
import { createAtlassianGateway } from '../integrations/atlassian/index.js';
import { createClaudeCli } from '../integrations/claude-cli.js';
import { loadEvalFeatures, onlyArg } from './features.js';

interface Result {
  id: string;
  expected: string;
  magnitude: string;
  discovery: string[];
  discoveryOk: boolean;
  confidence: string;
  verdict: string;
  assessmentOk: boolean;
  costP85: number;
  questions: number[];
  requirements: number;
  calls: number;
  tokens: number;
  seconds: number;
  ok: boolean;
  error?: string;
}

/** In-memory run state, so the eval writes nothing to the database or Jira. */
function memoryRun(calls: CallRecord[]) {
  const questionnaires: (Questionnaire & {
    answers?: Record<string, string[]>;
    details?: Record<string, string>;
  })[] = [];
  const outputs = new Map<RunState, unknown>();
  let analysis: AnalysisToSave | undefined;
  let assessment: Assessment | undefined;
  let assumptions: string[] = [];
  let discoveryDecision: { decision: string; comment: string | null } | null = null;
  const repo = {
    latestStageOutput: async (_id: string, stage: RunState) => outputs.get(stage) ?? null,
    answeredQuestionnaires: async () =>
      questionnaires.filter((q) => q.answers).map((q) => ({ ...q, answers: q.answers! })),
    latestDecision: async (_id: string, gate = 'assessment') =>
      gate === 'discovery' ? discoveryDecision : null,
    recordCall: async (_r: string, _e: string, call: CallRecord) => void calls.push(call),
    async saveQuestionnaire(
      _id: string,
      round: number,
      questions: Questionnaire['questions'],
      layout: Pick<Questionnaire, 'sections' | 'allowComment'> = {},
    ) {
      const q = { id: randomUUID(), round, questions, ...layout };
      questionnaires.push(q);
      return q;
    },
  } as unknown as RunRepository;
  const analysisRepo = {
    replaceElicitationAssumptions: async (
      _id: string,
      items: { text: string; reason: string; kind?: string }[],
    ) => void (assumptions = items.map((a) => `[${a.kind ?? 'assumption'}] ${a.text} (${a.reason})`)),
    elicitationAssumptions: async () => assumptions,
    saveAnalysis: async (_id: string, a: AnalysisToSave) => {
      analysis = a;
      return new Map();
    },
    analysisOf: async (): Promise<StoredAnalysis> => {
      const a = analysis!;
      const codes = requirementCodes(a.analysis.requirements);
      return {
        requirements: a.analysis.requirements.map((r) => ({ ...r, code: codes.get(r.ref)! })),
        conflicts: a.analysis.conflicts.map((c) => ({
          requirementCode: c.requirementRef ? (codes.get(c.requirementRef) ?? null) : null,
          with: c.with,
          kind: c.kind,
          description: c.description,
          blocking: c.blocking,
        })),
        impacts: a.impact.componentImpacts,
        dependencies: a.impact.dependencies,
        magnitude: a.magnitude,
        magnitudeReason: a.magnitudeReason,
        mvpSummary: a.analysis.mvpSummary,
        spike: {
          needed: a.impact.spike.needed,
          ...(a.impact.spike.question ? { question: a.impact.spike.question } : {}),
          ...(a.impact.spike.timeboxDays ? { timeboxDays: a.impact.spike.timeboxDays } : {}),
        },
        performanceRisks: a.impact.performanceRisks,
      };
    },
    saveAssessment: async (a: Assessment) => void (assessment = a),
  } as unknown as AnalysisRepository;
  /**
   * Answers open questions like the client in features.yaml: core questions from the profile,
   * feature-specific and clarification questions with their first definite option.
   */
  const answerOpen = (profile: Record<string, string[]>, details: Record<string, string> = {}) => {
    for (const q of questionnaires.filter((x) => !x.answers)) {
      q.answers = Object.fromEntries(
        q.questions.map((question) => [
          question.id,
          profile[question.id] ?? [question.options.find((o) => o.value !== NOT_SURE)!.value],
        ]),
      );
      q.details = details;
    }
  };
  const acceptPreliminary = () => void (discoveryDecision = { decision: 'proceed', comment: null });
  return {
    repo,
    analysisRepo,
    questionnaires,
    outputs,
    answerOpen,
    acceptPreliminary,
    analysis: () => analysis,
    assessment: () => assessment,
  };
}

async function main() {
  const config = loadConfig();
  const wanted = onlyArg(process.argv.slice(2));
  const features = loadEvalFeatures();

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
  const discovery = loadDiscoveryConfig();
  const assessment = loadAssessmentConfig();

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
      const memory = memoryRun(calls);
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
        discovery,
        assessment,
      };
      const step = async (stage: RunState, handler: StageHandler) => {
        const outcome = await handler(ctx);
        memory.outputs.set(stage, outcome.output);
        return outcome.next;
      };
      const reports = () => events.flatMap((e) => (e.type === 'discovery_report' ? [e.report] : []));

      process.stdout.write(`- ${feature.id}: `);
      try {
        await step('intake', intakeStage(services));
        memory.answerOpen(feature.answers, feature.details);
        let next = await step('eliciting', elicitingStage(services));
        for (let round = 2; next === 'awaiting_answers' && round <= discovery.maxRounds; round++) {
          memory.answerOpen(feature.answers, feature.details);
          next = await step('eliciting', elicitingStage(services));
        }
        if (next === 'awaiting_confirmation') memory.acceptPreliminary();
        await step('analyzing', analyzingStage(services));
        await step('estimating', estimatingStage(services));
        const saved = memory.analysis()!;
        const assessed = memory.assessment()!;
        const expectPreliminary = feature.assessment?.preliminary;
        const discoveryResults = reports().map((r) => r.result);
        const result: Result = {
          id: feature.id,
          expected: feature.expected,
          magnitude: saved.magnitude,
          discovery: discoveryResults,
          discoveryOk: feature.discovery.includes(discoveryResults[0]!),
          confidence: reports().at(-1)?.confidence ?? '-',
          verdict: assessed.verdict.label,
          assessmentOk:
            (expectPreliminary === undefined || assessed.preliminary === expectPreliminary) &&
            (!feature.assessment?.decision ||
              feature.assessment.decision.includes(assessed.verdict.decision)),
          costP85: assessed.budget.total.p85,
          questions: memory.questionnaires.map((q) => q.questions.length),
          requirements: saved.analysis.requirements.length,
          calls: calls.length,
          tokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0),
          seconds: Math.round((Date.now() - started) / 1000),
          ok: false,
        };
        result.ok =
          result.magnitude === feature.expected &&
          result.discoveryOk &&
          result.assessmentOk &&
          (result.questions[0] ?? 0) <= discovery.questions.length + discovery.maxFeatureQuestions &&
          result.questions.length <= discovery.maxRounds &&
          (result.questions[1] ?? 0) <= discovery.maxClarifications;
        results.push(result);
        console.log(
          `${result.ok ? 'PASS' : 'FAIL'} (${result.magnitude}; discovery ${discoveryResults.join(' → ')}, confidence ${result.confidence}; ${result.seconds} s)`,
        );
        const impacts = saved.impact.componentImpacts
          .filter((i) => i.level !== 'none')
          .map((i) => `${i.component} ${i.level}`)
          .join(', ');
        console.log(`    impacts: ${impacts}`);
        const base = assessed.value.scenarios.find((x) => x.name === 'base')!;
        console.log(
          `    assessment: ${assessed.verdict.label}; ${assessed.storyMap.totals.full.items} items, ${assessed.storyMap.totals.full.mean} points; MVP P85 ${assessed.forecast.mvp.dates.p85}, full P85 ${assessed.forecast.full.dates.p85}; cost P85 ${assessed.budget.total.p85.toLocaleString('en-US')}; base ROI ${Math.round(base.roi * 100)} %; ${assessed.risks.length} risks`,
        );
        for (const c of assessed.verdict.conditions) console.log(`    condition: ${c}`);
        for (const report of reports()) {
          const issues = [
            ...report.contradictions.map((c) => `${c.severity}${c.resolved ? ' (resolved)' : ''}: ${c.text}`),
            ...report.gaps.map((g) => `${g.critical ? 'critical gap' : 'gap'}: ${g.text}`),
          ];
          for (const issue of issues) console.log(`    round ${report.round} ${issue}`);
        }
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
          discovery: reports().map((r) => r.result),
          discoveryOk: false,
          confidence: '-',
          verdict: '-',
          assessmentOk: false,
          costP85: 0,
          questions: memory.questionnaires.map((q) => q.questions.length),
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

  console.log(
    '\n| Feature | Expected | Got | Discovery | Confidence | Verdict | Cost P85 | Questions | Reqs | Calls | Tokens | Time |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const magnitudeOk = r.magnitude === r.expected;
    console.log(
      `| ${r.id} | ${r.expected} | ${r.magnitude}${magnitudeOk ? '' : ' ✗'} | ${r.discovery.join(' → ') || '-'}${r.discoveryOk ? '' : ' ✗'} | ${r.confidence} | ${r.verdict}${r.assessmentOk ? '' : ' ✗'} | ${Math.round(r.costP85).toLocaleString('en-US')} | ${r.questions.join(' + ') || '-'} | ${r.requirements} | ${r.calls} | ${r.tokens.toLocaleString('en-US')} | ${r.seconds} s |`,
    );
  }
  // Across features: a cosmetic change must cost less than a core-engine change.
  const cosmetic = results.filter((r) => r.magnitude === 'cosmetic' && r.costP85 > 0);
  const core = results.filter((r) => r.magnitude === 'core_engine' && r.costP85 > 0);
  if (cosmetic.length && core.length) {
    const ok = Math.max(...cosmetic.map((r) => r.costP85)) < Math.min(...core.map((r) => r.costP85));
    console.log(`Cosmetic features cost less than core-engine features: ${ok ? 'yes' : 'NO ✗'}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} passed.`);
  for (const r of results.filter((x) => x.error)) console.log(`${r.id}: ${r.error}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
