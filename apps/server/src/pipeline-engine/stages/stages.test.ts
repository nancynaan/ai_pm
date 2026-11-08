import { type AnsweredQuestionnaire, NOT_SURE, type Questionnaire, type RunEvent } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type {
  DiscoveryReview,
  ElicitationResult,
  ImpactAnalysis,
  RequirementsAnalysis,
} from '../../agents/schemas.js';
import type { AnalysisRepository, AnalysisToSave } from '../analysis-repository.js';
import { requirementCodes } from '../analysis-repository.js';
import type { ContextBuilder } from '../context.js';
import { loadAssessmentConfig } from '../assessment-config.js';
import { loadDiscoveryConfig, toUiQuestion } from '../discovery-config.js';
import { clarificationQuestion } from '../discovery.js';
import { classifyChange } from '../magnitude.js';
import type { StageContext } from '../engine.js';
import type { RunRecord, RunRepository } from '../repository.js';
import type { StageServices } from '../services.js';
import { analyzingStage } from './analyzing.js';
import { elicitingStage } from './eliciting.js';
import { intakeStage } from './intake.js';
import { toQuestions, transcript } from './prompts.js';

const COMPONENTS = [
  { name: 'Physics & Movement', sensitivity: 'core' as const },
  { name: 'Save System', sensitivity: 'core' as const },
  { name: 'Backend', sensitivity: 'feature' as const },
  { name: 'Characters & Skins', sensitivity: 'cosmetic' as const },
  { name: 'UI & HUD', sensitivity: 'cosmetic' as const },
];

describe('change magnitude rule', () => {
  it('calls skins and screens cosmetic, even when heavily changed', () => {
    const result = classifyChange(
      [
        { component: 'Characters & Skins', level: 'high' },
        { component: 'UI & HUD', level: 'medium' },
        { component: 'Backend', level: 'low' },
      ],
      COMPONENTS,
    );
    expect(result.magnitude).toBe('cosmetic');
  });

  it('calls new backend behaviour a feature extension', () => {
    expect(classifyChange([{ component: 'Backend', level: 'medium' }], COMPONENTS).magnitude).toBe(
      'feature_extension',
    );
  });

  it('never escalates on low impacts alone, even on core components', () => {
    const result = classifyChange(
      [
        { component: 'Save System', level: 'low' },
        { component: 'UI & HUD', level: 'medium' },
      ],
      COMPONENTS,
    );
    expect(result.magnitude).toBe('cosmetic');
  });

  it('calls a medium or high change to a core component a core engine change', () => {
    const result = classifyChange(
      [
        { component: 'Physics & Movement', level: 'high' },
        { component: 'UI & HUD', level: 'low' },
      ],
      COMPONENTS,
    );
    expect(result).toEqual({
      magnitude: 'core_engine',
      reason: 'Core components need real changes: Physics & Movement (high).',
    });
  });

  it('treats unknown components as feature-level', () => {
    expect(classifyChange([{ component: 'Multiplayer', level: 'high' }], COMPONENTS).magnitude).toBe(
      'feature_extension',
    );
  });
});

describe('prompt helpers', () => {
  it('adds "not sure" to every question and keeps ids unique', () => {
    const questions = toQuestions([
      {
        id: 'goal',
        text: 'Goal?',
        kind: 'single',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        why: 'Why it matters',
        gap: 'goal',
      },
      {
        id: 'goal',
        text: 'Goal again?',
        kind: 'multi',
        options: [
          { value: 'a', label: 'A' },
          { value: NOT_SURE, label: 'x' },
        ],
        why: 'Why it matters',
        gap: 'goal',
      },
    ]);
    expect(questions.map((q) => q.id)).toEqual(['goal', 'goal_2']);
    expect(questions[1]!.options.map((o) => o.value)).toEqual(['a', NOT_SURE]);
  });

  it('writes a readable transcript with labels', () => {
    const q: Questionnaire = {
      id: 'q1',
      round: 1,
      questions: toQuestions([
        {
          id: 'deadline',
          text: 'Deadline?',
          kind: 'single',
          options: [
            { value: 'fixed', label: 'Fixed date' },
            { value: 'flexible', label: 'Flexible' },
          ],
          why: 'Planning',
          gap: 'time',
        },
      ]),
    };
    expect(transcript([{ ...q, answers: { deadline: [NOT_SURE] } }])).toBe(
      'Q (deadline): Deadline?\nA: Not sure',
    );
    expect(
      transcript([
        {
          ...q,
          answers: { deadline: ['fixed'] },
          details: { 'deadline:fixed': '31 October' },
          comment: 'For Halloween',
        },
      ]),
    ).toBe(
      'Q (deadline): Deadline?\nA: Fixed date (<client_text>31 October</client_text>)\n\nAdditional comments (round 1): <client_text>For Halloween</client_text>',
    );
  });

  it('prefixes agent question ids so they never collide with discovery questions', () => {
    const [q] = toQuestions([question('priority')], { prefix: 'feature_', section: 'feature' });
    expect(q).toMatchObject({ id: 'feature_priority', section: 'feature' });
  });

  it('numbers requirement codes per type', () => {
    const codes = requirementCodes([
      { ref: 'FR-1', type: 'functional' },
      { ref: 'NFR-1', type: 'non_functional' },
      { ref: 'FR-2', type: 'functional' },
    ]);
    expect([...codes.values()]).toEqual(['REQ-FR-001', 'REQ-NFR-001', 'REQ-FR-002']);
  });
});

// ---- stages with fake agents --------------------------------------------------------------

const run: RunRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  state: 'intake',
  failedState: null,
  error: null,
  title: 'Ghost race',
  description: "Race against a friend's ghost.",
  projectId: 'p1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function question(id: string) {
  return {
    id,
    text: `${id}?`,
    kind: 'single' as const,
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
    why: 'It changes the estimate',
    gap: id,
  };
}

const config = loadDiscoveryConfig();

/** Round 1 of the discovery questionnaire, answered consistently with evidence. */
const discoveryRound = (overrides: Record<string, string[]> = {}): AnsweredQuestionnaire => ({
  id: 'q1',
  round: 1,
  questions: config.questions.map(toUiQuestion),
  answers: {
    problem: ['retention'],
    outcome: ['retention_d1_d7'],
    evidence: ['analytics'],
    audience: ['casual'],
    first_release_scope: ['core', 'ui'],
    success: ['retention'],
    priority: ['high'],
    constraints: ['flexible_budget'],
    dependencies: ['modify_existing'],
    approval: ['full'],
    ...overrides,
  },
});

function setup(
  agentAnswers: Record<string, unknown>,
  state: {
    answered?: AnsweredQuestionnaire[];
    stageOutput?: unknown;
    discoveryDecision?: { decision: string; comment: string | null };
  } = {},
) {
  const events: RunEvent[] = [];
  const prompts: Record<string, string> = {};
  const saved: {
    questionnaires: { round: number; ids: string[]; sections?: string[] }[];
    analysis?: AnalysisToSave;
    assumptions?: { kind?: string }[];
    title?: string;
  } = {
    questionnaires: [],
  };
  const answered = state.answered ?? [];
  const repo = {
    setTitle: async (_id: string, title: string) => void (saved.title = title),
    latestStageOutput: async () => state.stageOutput ?? null,
    answeredQuestionnaires: async () => answered,
    latestDecision: async (_id: string, gate = 'assessment') =>
      gate === 'discovery' ? (state.discoveryDecision ?? null) : null,
    async saveQuestionnaire(
      _runId: string,
      round: number,
      questions: { id: string }[],
      layout: Pick<Questionnaire, 'sections'> = {},
    ) {
      saved.questionnaires.push({
        round,
        ids: questions.map((q) => q.id),
        ...(layout.sections ? { sections: layout.sections.map((s) => s.id) } : {}),
      });
      return { id: `q-${round}`, round, questions, ...layout };
    },
  } as unknown as RunRepository;
  const ctx: StageContext = {
    run,
    executionId: 'e1',
    repo,
    baselineDigest: '# digest',
    emit: async (event) => void events.push(event),
  };
  const services: StageServices = {
    async ask<T>(_ctx: StageContext, agent: string, prompt: string) {
      prompts[agent] = prompt;
      return agentAnswers[agent] as T;
    },
    createDraftEpic: async () => ({
      key: 'AIPM-40',
      url: 'https://x/browse/AIPM-40',
      note: 'I created a draft Epic in Jira: AIPM-40',
    }),
    discovery: config,
    assessment: loadAssessmentConfig(),
    analysis: {
      replaceElicitationAssumptions: async (_id: string, a: { kind?: string }[]) =>
        void (saved.assumptions = a),
      elicitationAssumptions: async () => ['Assume iOS and Android (not sure)'],
      saveAnalysis: async (_id: string, a: AnalysisToSave) => {
        saved.analysis = a;
        return new Map();
      },
    } as unknown as AnalysisRepository,
    context: {
      backlog: async () => 'AIPM-12 [Story, Done] Daily missions',
      components: async () => COMPONENTS,
      baselineTexts: async () => ({
        game_design_document: '## GDD',
        architecture_overview: '## Architecture',
      }),
    } as unknown as ContextBuilder,
  };
  return { ctx, services, events, prompts, saved };
}

const elicitation: ElicitationResult = {
  summary: "Players race a transparent ghost of a friend's best run.",
  title: "Race against a friend's ghost run",
  epicSummary: 'Ghost race against friends',
  candidateRequirements: [{ text: 'Show the ghost of a friend', type: 'functional', source: 'stated' }],
  gaps: [{ topic: 'netcode', description: 'Whether ghosts must sync live', critical: false }],
  featureQuestions: [question('social'), question('connectivity'), question('extra')],
};

describe('intake stage', () => {
  it('drafts the Epic and sends the discovery questionnaire plus at most two feature questions', async () => {
    const { ctx, services, events, prompts, saved } = setup({ elicitation });
    const outcome = await intakeStage(services)(ctx);

    expect(outcome.next).toBe('awaiting_answers');
    expect(saved.title).toBe("Race against a friend's ghost run"); // the short name replaces the first line
    expect(prompts.elicitation).toContain(
      "<client_request>\nRace against a friend's ghost.\n</client_request>",
    );
    expect(prompts.elicitation).toContain('What is the basis for requesting this feature?');
    const [sent] = saved.questionnaires;
    expect(sent!.ids).toHaveLength(12);
    expect(sent!.ids.slice(0, 3)).toEqual(['problem', 'outcome', 'evidence']);
    // Feature questions sit after the scope section, before feasibility.
    expect(sent!.ids.slice(6, 9)).toEqual(['feature_social', 'feature_connectivity', 'priority']);
    expect(sent!.sections).toEqual([
      'business_justification',
      'product_context',
      'scope',
      'feature',
      'feasibility',
      'decision_readiness',
    ]);
    const message = events.find((e) => e.type === 'message') as { text: string };
    expect(message.text).toContain('AIPM-40');
    expect(message.text).toContain('Not yet determined');
    expect(events.at(-1)?.type).toBe('questionnaire');
  });
});

const review = (extra: Partial<DiscoveryReview> = {}): DiscoveryReview => ({
  summary: 'The request is clear: a ghost race for casual players, backed by analytics.',
  requirements: [{ text: 'Show the ghost of a friend', type: 'functional', source: 'answer' }],
  findings: [{ kind: 'ai_hypothesis', area: 'feasibility', text: 'Ghosts need replay data', source: 'ai' }],
  assumptions: [{ text: 'Ghosts replay offline', reason: 'inferred from the GDD', kind: 'ai_hypothesis' }],
  gaps: [],
  contradictions: [],
  clarificationQuestions: [],
  ...extra,
});

describe('discovery stage', () => {
  it('passes a complete discovery to the analysis and publishes the report', async () => {
    const { ctx, services, events, prompts, saved } = setup(
      { 'discovery-review': review() },
      { answered: [discoveryRound()], stageOutput: { elicitation } },
    );
    const outcome = await elicitingStage(services)(ctx);

    expect(outcome.next).toBe('analyzing');
    expect(prompts['discovery-review']).toContain('What the completeness rules already found');
    expect(prompts['discovery-review']).toContain('[client_assumption] Expected outcome');
    const report = events.find((e) => e.type === 'discovery_report') as Extract<
      RunEvent,
      { type: 'discovery_report' }
    >;
    expect(report.report).toMatchObject({ result: 'complete', confidence: 'high' });
    expect(saved.assumptions).toEqual([expect.objectContaining({ kind: 'ai_hypothesis' })]);
    expect((events.at(-1) as { text: string }).text).toContain('Discovery is complete and consistent');
  });

  it('stops for clarification on a blocking contradiction and estimates nothing', async () => {
    const { ctx, services, events, saved } = setup(
      { 'discovery-review': review() },
      {
        answered: [
          discoveryRound({ priority: ['critical'], constraints: ['fixed_budget', 'flexible_timeline'] }),
        ],
      },
    );
    expect((await elicitingStage(services)(ctx)).next).toBe('awaiting_answers');
    expect(saved.questionnaires).toEqual([
      { round: 2, ids: ['clarify_critical_but_flexible_timeline'], sections: ['clarification'] },
    ]);
    const message = events.find((e) => e.type === 'message') as { text: string };
    expect(message.text).toContain("I won't estimate anything");
  });

  it('asks the client to decide after the last round, without more questions', async () => {
    const rule = config.rules.find((r) => r.id === 'critical_but_flexible_timeline')!;
    const { ctx, services, prompts, saved } = setup(
      {
        'discovery-review': review({ clarificationQuestions: [question('anything')] }),
      },
      {
        answered: [
          discoveryRound({ priority: ['critical'], constraints: ['flexible_timeline'] }),
          {
            id: 'q2',
            round: 2,
            questions: [clarificationQuestion(rule)],
            answers: { clarify_critical_but_flexible_timeline: [NOT_SURE] },
          },
        ],
      },
    );
    expect((await elicitingStage(services)(ctx)).next).toBe('awaiting_confirmation');
    expect(prompts['discovery-review']).toContain('This was the last round');
    expect(saved.questionnaires).toEqual([]);
    expect(saved.assumptions).toContainEqual(expect.objectContaining({ kind: 'open_issue' }));
  });
});

describe('analyzing stage', () => {
  const analysis: RequirementsAnalysis = {
    requirements: [
      {
        ref: 'FR-1',
        type: 'functional',
        category: 'gameplay',
        title: 'Ghost runner',
        description: 'Show the ghost of a friend in the run',
        moscow: 'must',
        inMvp: true,
        source: 'stated',
      },
      {
        ref: 'NFR-1',
        type: 'non_functional',
        category: 'performance efficiency',
        title: 'Frame rate',
        description: 'Ghost keeps 30 FPS on low-end devices',
        moscow: 'must',
        inMvp: true,
        source: 'inferred',
      },
    ],
    conflicts: [],
    assumptions: [],
    constraints: [{ type: 'platform', text: 'iOS and Android' }],
    mvpSummary: 'One ghost of one friend, replayed offline from a stored run.',
  };
  const impact: ImpactAnalysis = {
    componentImpacts: [
      { component: 'physics & movement', level: 'high', rationale: 'Replays need deterministic movement' },
      { component: 'Netcode', level: 'medium', rationale: 'Not a known component' },
      { component: 'UI & HUD', level: 'low', rationale: 'Ghost toggle on the results screen' },
    ],
    dependencies: [
      { type: 'component', target: 'Backend', description: 'Store and serve ghost runs', blocking: true },
    ],
    performanceRisks: ['A second runner may cost 1–2 ms per frame on low-end devices'],
    spike: { needed: true, question: 'Can movement be replayed deterministically?', timeboxDays: 3 },
  };

  it('runs both analysts, keeps known components, applies the rule and saves', async () => {
    const { ctx, services, events, prompts, saved } = setup({
      'requirements-analyst': analysis,
      'impact-analyst': impact,
    });
    const outcome = await analyzingStage(services)(ctx);

    expect(outcome.next).toBe('estimating');
    expect(prompts['requirements-analyst']).toContain('AIPM-12 [Story, Done] Daily missions');
    expect(prompts['impact-analyst']).toContain('## Architecture');
    expect(saved.analysis?.magnitude).toBe('core_engine');
    expect(saved.analysis?.impact.componentImpacts.map((i) => i.component)).toEqual([
      'Physics & Movement',
      'UI & HUD',
    ]);
    const text = (events[0] as { text: string }).text;
    expect(text).toContain('**2 requirements**: 1 functional, 1 non-functional; 2 in the MVP.');
    expect(text).toContain('**Core engine change.**');
    expect(text).toContain('Technical spike proposed: Can movement be replayed deterministically? (3 days).');
  });

  it('gives the analysts the discovery report and marks an accepted incomplete discovery preliminary', async () => {
    const report = {
      round: 2,
      result: 'insufficient' as const,
      confidence: 'low' as const,
      confidenceReason: '1 unresolved contradiction.',
      summary: 'Timing is unclear.',
      coverage: [],
      findings: [
        {
          kind: 'client_assumption' as const,
          area: 'business_justification' as const,
          text: 'Expected outcome: DAU (unvalidated client hypothesis: no supporting evidence)',
          source: 'outcome',
        },
      ],
      gaps: [],
      contradictions: [
        { id: 'x', text: 'Critical but flexible', severity: 'blocking' as const, resolved: false },
      ],
      readiness: { canApprove: 'full' as const, note: 'The client can approve.' },
      nextAction: { action: 'client_decision' as const, text: 'Decide.' },
    };
    const { ctx, services, events, prompts, saved } = setup(
      { 'requirements-analyst': analysis, 'impact-analyst': impact },
      {
        stageOutput: { review: review(), report },
        discoveryDecision: { decision: 'proceed', comment: 'Go on' },
      },
    );
    const outcome = await analyzingStage(services)(ctx);
    expect(outcome.output).toMatchObject({ preliminary: true });
    expect(saved.analysis).toBeDefined();
    for (const agent of ['requirements-analyst', 'impact-analyst']) {
      expect(prompts[agent]).toContain('# Discovery completeness report');
      expect(prompts[agent]).toContain('## Client assumptions (expectations, not facts)');
      expect(prompts[agent]).toContain('PRELIMINARY. Discovery is incomplete and the client accepted');
    }
    expect((events[0] as { text: string }).text).toContain('**Preliminary:**');
  });
});
