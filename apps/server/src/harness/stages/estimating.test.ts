import { type AnsweredQuestionnaire, type Assessment, assessmentSchema, type RunEvent } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type { EstimationResult, RiskAssessment, ValueAssessment } from '../../agents/schemas.js';
import { loadSeedData } from '../../baseline/seed-data.js';
import type { AnalysisRepository, StoredAnalysis } from '../analysis-repository.js';
import { loadAssessmentConfig } from '../assessment-config.js';
import type { ContextBuilder } from '../context.js';
import { loadDiscoveryConfig, toUiQuestion } from '../discovery-config.js';
import type { StageContext } from '../orchestrator.js';
import type { RunRecord, RunRepository } from '../repository.js';
import type { StageServices } from '../services.js';
import { clientConstraints, estimatingStage } from './estimating.js';

const seed = loadSeedData();
const discovery = loadDiscoveryConfig();

const round1 = (
  answers: Record<string, string[]>,
  details: Record<string, string> = {},
): AnsweredQuestionnaire => ({
  id: 'q1',
  round: 1,
  questions: discovery.questions.map(toUiQuestion),
  answers: {
    problem: ['engagement'],
    outcome: ['session_length'],
    evidence: ['analytics'],
    audience: ['active'],
    first_release_scope: ['core', 'ui'],
    success: ['engagement'],
    priority: ['high'],
    constraints: ['flexible_budget'],
    dependencies: ['backend'],
    approval: ['full'],
    ...answers,
  },
  details,
});

describe('client constraints', () => {
  it('reads a hard date and a budget limit from the answers', () => {
    const c = clientConstraints([
      round1(
        { priority: ['critical'], constraints: ['fixed_budget', 'fixed_deadline'] },
        { 'constraints:fixed_deadline': '1 July 2027', 'constraints:fixed_budget': 'about $90k' },
      ),
    ]);
    expect(c.deadline).toEqual({ text: '1 July 2027', date: '2027-07-01', hard: true, source: 'answer' });
    expect(c.budget).toEqual({ text: 'about $90k', amountUsd: 90_000 });
  });

  it('prefers the clarified date, and keeps a named date without a day for the estimator', () => {
    const clarified = clientConstraints([
      round1({ priority: ['critical'] }, { 'priority:critical': 'Halloween update' }),
      {
        id: 'q2',
        round: 2,
        questions: [],
        answers: { clarify_critical_but_flexible_timeline: ['firm_date'] },
        details: { 'clarify_critical_but_flexible_timeline:firm_date': 'Summer event, 1 July 2027' },
      },
    ]);
    expect(clarified.deadline).toMatchObject({ date: '2027-07-01', hard: true, source: 'clarification' });
    const named = clientConstraints([
      round1({ priority: ['critical'] }, { 'priority:critical': 'Halloween update' }),
    ]);
    expect(named.deadline).toMatchObject({ text: 'Halloween update', date: null, hard: true });
  });

  it('treats a date the client says can move as soft, and no limit as none', () => {
    const c = clientConstraints([
      round1(
        { priority: ['medium'], constraints: ['fixed_deadline'] },
        { 'constraints:fixed_deadline': '15 March 2027' },
      ),
      {
        id: 'q2',
        round: 2,
        questions: [],
        answers: { clarify_not_urgent_but_fixed_date: ['date_can_move'] },
      },
    ]);
    expect(c.deadline).toMatchObject({ date: '2027-03-15', hard: false });
    expect(c.budget.amountUsd).toBeNull();
  });
});

// ---- the stage with fake agents --------------------------------------------------------------

const run: RunRecord = {
  id: '22222222-2222-2222-2222-222222222222',
  state: 'estimating',
  failedState: null,
  error: null,
  title: 'Weekend tournament',
  description: 'A weekend tournament with a neon level and rewards for the top 10 %.',
  projectId: 'p1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const analysis: StoredAnalysis = {
  requirements: [
    {
      code: 'REQ-FR-001',
      type: 'functional',
      category: 'tournament',
      title: 'Weekend schedule',
      description: 'Runs Friday to Sunday',
      moscow: 'must',
      inMvp: true,
      source: 'stated',
    },
    {
      code: 'REQ-FR-002',
      type: 'functional',
      category: 'ranking',
      title: 'Ranking',
      description: 'Best distance ranks players',
      moscow: 'must',
      inMvp: true,
      source: 'stated',
    },
    {
      code: 'REQ-NFR-001',
      type: 'non_functional',
      category: 'performance efficiency',
      title: '30 FPS',
      description: '30 FPS on the low-end device',
      moscow: 'must',
      inMvp: true,
      source: 'inferred',
    },
  ],
  conflicts: [
    {
      requirementCode: null,
      with: 'GDD',
      kind: 'conflict',
      description: 'Paid revives break no-pay-to-win in a ranked mode.',
      blocking: true,
    },
  ],
  impacts: [{ component: 'Backend', level: 'high', rationale: 'Leaderboard service' }],
  dependencies: [{ type: 'component', target: 'Backend', description: 'Leaderboard API', blocking: true }],
  magnitude: 'feature_extension',
  magnitudeReason: 'Extends existing systems: Backend (high).',
  mvpSummary: 'One weekend tournament with a global ranking.',
  spike: { needed: true, question: 'Can distances be validated on the server?', timeboxDays: 3 },
  performanceRisks: [],
};

const estimation: EstimationResult = {
  items: [
    {
      ref: 'S-1',
      activity: 'Enter',
      title: 'Tournament entry',
      type: 'story',
      release: 'mvp',
      discipline: 'gameplay',
      requirementCodes: ['REQ-FR-001'],
      optimistic: 3,
      mostLikely: 5,
      pessimistic: 8,
      referenceStory: 'ST-05',
      rationale: 'Like the revive flow',
    },
    {
      ref: 'S-2',
      activity: 'Rank',
      title: 'Leaderboard service',
      type: 'enabler',
      release: 'mvp',
      discipline: 'backend',
      requirementCodes: ['REQ-FR-002'],
      optimistic: 5,
      mostLikely: 8,
      pessimistic: 13,
      referenceStory: null,
      rationale: 'New server endpoint',
    },
    {
      ref: 'S-3',
      activity: 'Rank',
      title: 'Server-side distance checks',
      type: 'spike',
      release: 'mvp',
      discipline: 'backend',
      requirementCodes: [],
      optimistic: 3,
      mostLikely: 3,
      pessimistic: 5,
      referenceStory: null,
      rationale: 'Timeboxed spike',
    },
    {
      ref: 'S-4',
      activity: 'Reward',
      title: 'Trail effect reward',
      type: 'story',
      release: 'later',
      discipline: 'ui_art',
      requirementCodes: [],
      optimistic: 2,
      mostLikely: 3,
      pessimistic: 5,
      referenceStory: null,
      rationale: 'Art and reward grant',
    },
  ],
  nonLabour: [
    {
      description: 'Leaderboard hosting',
      kind: 'monthly',
      amountUsd: 300,
      basis: 'Managed service, small tier',
    },
  ],
  deadline: null,
  assumptions: ['The existing account system identifies players'],
};

const risks: RiskAssessment = {
  risks: [
    {
      title: 'Cheated distances',
      cause: 'Distances are reported by the client',
      event: 'Players submit fake scores',
      effect: 'Rewards go to cheaters',
      category: 'Technical',
      probability: 4,
      impact: 4,
      strategy: 'Mitigate',
      response: 'Server-side plausibility checks',
      owner: 'Tomasz Kowalski',
      trigger: 'Top scores above the theoretical maximum',
      costImpact: { extraPoints: 8, delaySprints: 0, directCostUsd: 0 },
      existingRiskId: null,
      source: 'analysis',
    },
  ],
};

const value: ValueAssessment = {
  primaryKpi: 'session_minutes',
  drivers: 'Competitive players play more runs on weekends to climb the ranking.',
  scenarios: {
    pessimistic: {
      reach: 0.35,
      kpiChanges: [{ kpi: 'session_minutes', change: 0.1 }],
      rationale: 'Few join',
    },
    base: {
      reach: 0.35,
      kpiChanges: [
        { kpi: 'session_minutes', change: 0.4 },
        { kpi: 'd7_retention', change: 0.5 },
      ],
      rationale: 'Typical event uplift',
    },
    optimistic: {
      reach: 0.35,
      kpiChanges: [
        { kpi: 'session_minutes', change: 0.8 },
        { kpi: 'd7_retention', change: 1 },
        { kpi: 'arpdau', change: 15 },
      ],
      rationale: 'Strong uptake, tournament entry offers sell',
    },
  },
  wsjf: { businessValue: 8, timeCriticality: 3, riskReduction: 5, rationale: 'Supports retention risk R-01' },
  validation: 'Run one tournament for a soft-launch cohort and compare weekend sessions.',
  assumptions: ['Tournament players are mostly daily players'],
};

function setup(
  answered: AnsweredQuestionnaire[],
  discoveryDecision: { decision: string; comment: string | null } | null = null,
) {
  const events: RunEvent[] = [];
  const prompts: Record<string, string> = {};
  let saved: Assessment | undefined;
  const repo = {
    latestStageOutput: async () => null,
    answeredQuestionnaires: async () => answered,
    latestDecision: async (_id: string, gate = 'assessment') =>
      gate === 'discovery' ? discoveryDecision : null,
  } as unknown as RunRepository;
  const ctx: StageContext = {
    run,
    executionId: 'e1',
    repo,
    baselineDigest: '# digest',
    emit: async (e) => void events.push(e),
  };
  const answers: Record<string, unknown> = {
    estimator: estimation,
    'risk-analyst': risks,
    'value-analyst': value,
  };
  const services: StageServices = {
    async ask<T>(_ctx: StageContext, agent: string, prompt: string) {
      prompts[agent] = prompt;
      return answers[agent] as T;
    },
    createDraftEpic: async () => ({ key: null, url: null, note: '' }),
    discovery,
    assessment: loadAssessmentConfig(),
    analysis: {
      analysisOf: async () => analysis,
      saveAssessment: async (a: Assessment) => void (saved = a),
    } as unknown as AnalysisRepository,
    context: {
      baselineData: async () => ({
        project_charter: { project: seed.project, financials: seed.kpis.financials },
        team_velocity: seed.team,
        business_case: seed.kpis,
        product_roadmap: seed.roadmap,
        initial_backlog: seed.backlog,
        risk_register: seed.risks,
        stakeholder_register: seed.stakeholders,
        definition_of_done: seed.dod,
      }),
    } as unknown as ContextBuilder,
  };
  return { ctx, services, events, prompts, saved: () => saved };
}

describe('estimating stage', () => {
  it('runs the three agents, computes the assessment, saves it and links it from the chat', async () => {
    const { ctx, services, events, prompts, saved } = setup([
      round1(
        { priority: ['critical'], constraints: ['fixed_deadline'] },
        { 'constraints:fixed_deadline': '1 July 2027' },
      ),
    ]);
    const outcome = await estimatingStage(services)(ctx);
    expect(outcome.next).toBe('documenting');

    const a = assessmentSchema.parse(saved());
    // Prompts carry the facts each agent needs.
    expect(prompts.estimator).toContain('REQ-FR-002');
    expect(prompts.estimator).toContain('Planning Poker points');
    expect(prompts.estimator).toContain('Return `deadline: null`');
    expect(prompts['risk-analyst']).toContain('R-01');
    expect(prompts['value-analyst']).toContain('Evidence behind the request: strong');

    // Inputs come from the baseline and the client's answers.
    expect(a.inputs).toMatchObject({
      startSprint: 23,
      startDate: '2026-11-16',
      capacityShare: 0.5,
      teamCostPerSprintUsd: 38_600,
    });
    expect(a.inputs.deadline).toMatchObject({ date: '2027-07-01', hard: true });
    expect(a.inputs.budgetLimit).toMatchObject({ amountUsd: 485_400, source: 'remaining_project_budget' });

    // ~30 points at ~15 a sprint: a few sprints, well before July 2027.
    expect(a.storyMap.totals.full.items).toBe(4);
    expect(a.forecast.mvp.sprints.p50).toBeLessThanOrEqual(a.forecast.full.sprints.p50);
    expect(a.forecast.full.meetsDeadline).toEqual({ p50: true, p85: true });
    // A small scope can land in the same sprint count at P50 and P85.
    expect(a.budget.total.p85).toBeGreaterThanOrEqual(a.budget.total.p50);
    expect(a.budget.total.p50).toBe(a.budget.labour.p50 + a.budget.nonLabourTotal + a.budget.contingency);
    expect(a.budget.contingency).toBe(a.risks[0]!.emvUsd);
    expect(a.risks[0]).toMatchObject({ id: 'F-R1', score: 16, level: 'high' });
    expect(a.resources.find((r) => r.discipline === 'backend')?.bottleneck).toBe(true);
    expect(a.value.scenarios.map((s) => s.name)).toEqual(['pessimistic', 'base', 'optimistic']);
    expect(a.wsjf.score).toBeGreaterThan(0);

    // Go with conditions: spike, blocking conflict, high risk, backend bottleneck, re-estimate.
    expect(a.verdict.decision).toBe('go_with_conditions');
    const conditions = a.verdict.conditions.join('\n');
    expect(conditions).toContain('Run the technical spike first (3 days)');
    expect(conditions).toContain('no-pay-to-win');
    // The backend sets the pace: its own duration is built into the forecast, not a condition.
    const backend = a.resources.find((r) => r.discipline === 'backend')!;
    expect(a.forecast.full.sprints.p50).toBeGreaterThanOrEqual(Math.floor(backend.sprintsNeeded!));
    expect(conditions).not.toContain('backend needs');
    expect(a.preliminary).toBe(false);

    const card = events.find((e) => e.type === 'assessment_ready');
    expect(card).toMatchObject({ decision: 'go_with_conditions', label: 'Go with conditions' });
    expect(outcome.output).toMatchObject({ verdict: 'Go with conditions' });
  });

  it('marks the assessment preliminary when the client accepted open issues, and drops the no-evidence pessimistic effect', async () => {
    const { ctx, services, saved } = setup([round1({ evidence: ['no_evidence'] })], {
      decision: 'proceed',
      comment: null,
    });
    await estimatingStage(services)(ctx);
    const a = saved()!;
    expect(a.preliminary).toBe(true);
    expect(a.verdict.label).toMatch(/\(preliminary\)$/);
    expect(a.verdict.conditions.join('\n')).toContain('unvalidated hypothesis');
    const pessimistic = a.value.scenarios.find((s) => s.name === 'pessimistic')!;
    expect(pessimistic).toMatchObject({ kpiChanges: [], monthlyRevenueUsd: 0 });
  });

  it('asks the estimator to read a deadline named without a date, and labels the reading', async () => {
    const { ctx, services, prompts, saved } = setup([
      round1({ priority: ['critical'] }, { 'priority:critical': 'Halloween update' }),
    ]);
    services.ask = async <T>(_c: StageContext, agent: string, prompt: string) => {
      prompts[agent] = prompt;
      const answer = {
        estimator: {
          ...estimation,
          deadline: { date: '2027-10-15', basis: 'Halloween update ships mid-October' },
        },
        'risk-analyst': risks,
        'value-analyst': value,
      }[agent];
      return answer as T;
    };
    await estimatingStage(services)(ctx);
    expect(prompts.estimator).toContain('The client named the deadline "Halloween update" without a date');
    expect(saved()!.inputs.deadline).toMatchObject({
      date: '2027-10-15',
      source: 'ai_interpretation',
      hard: true,
    });
    expect(saved()!.preliminaryReasons.join()).toContain('was read as 2027-10-15');
  });
});
