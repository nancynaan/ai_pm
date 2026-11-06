/**
 * Shared test fixtures: a small feature run through discovery, analysis and the three
 * assessment agents (fake answers), used by the estimating and documents tests.
 */
import type { AnsweredQuestionnaire, Assessment, RunEvent } from '@ai-pm/shared';
import type { EstimationResult, RiskAssessment, ValueAssessment } from '../../agents/schemas.js';
import { loadSeedData } from '../../baseline/seed-data.js';
import type { AnalysisRepository, StoredAnalysis } from '../analysis-repository.js';
import { loadAssessmentConfig } from '../assessment-config.js';
import type { ContextBuilder } from '../context.js';
import { loadDiscoveryConfig, toUiQuestion } from '../discovery-config.js';
import type { StageContext } from '../engine.js';
import type { RunRecord, RunRepository } from '../repository.js';
import type { StageServices } from '../services.js';

export const seed = loadSeedData();
export const discovery = loadDiscoveryConfig();

export const round1 = (
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

// ---- the stage with fake agents --------------------------------------------------------------

export const run: RunRecord = {
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

export const analysis: StoredAnalysis = {
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

export const estimation: EstimationResult = {
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

export const risks: RiskAssessment = {
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

export const value: ValueAssessment = {
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

export function setupEstimating(
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
