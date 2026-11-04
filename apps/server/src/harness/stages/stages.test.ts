import { NOT_SURE, type Questionnaire, type RunEvent } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type {
  ElicitationResult,
  ElicitationReview,
  ImpactAnalysis,
  RequirementsAnalysis,
} from '../../agents/schemas.js';
import type { AnalysisRepository, AnalysisToSave } from '../analysis-repository.js';
import { requirementCodes } from '../analysis-repository.js';
import type { ContextBuilder } from '../context.js';
import { classifyChange } from '../magnitude.js';
import type { StageContext } from '../orchestrator.js';
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

const question = (id: string) => ({
  id,
  text: `${id}?`,
  kind: 'single' as const,
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
  why: 'It changes the estimate',
  gap: id,
});

function setup(
  agentAnswers: Record<string, unknown>,
  state: { answered?: number; stageOutput?: unknown } = {},
) {
  const events: RunEvent[] = [];
  const prompts: Record<string, string> = {};
  const saved: {
    questionnaires: { round: number; ids: string[] }[];
    analysis?: AnalysisToSave;
    assumptions?: unknown;
  } = {
    questionnaires: [],
  };
  const answered = Array.from({ length: state.answered ?? 0 }, (_, i) => ({
    id: `q${i + 1}`,
    round: i + 1,
    questions: toQuestions([question('goal')]),
    answers: { goal: ['yes'] },
  }));
  const repo = {
    latestStageOutput: async () => state.stageOutput ?? null,
    answeredQuestionnaires: async () => answered,
    latestDecision: async () => null,
    async saveQuestionnaire(_runId: string, round: number, questions: { id: string }[]) {
      saved.questionnaires.push({ round, ids: questions.map((q) => q.id) });
      return { id: `q-${round}`, round, questions };
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
    analysis: {
      replaceElicitationAssumptions: async (_id: string, a: unknown) => void (saved.assumptions = a),
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
  epicSummary: 'Ghost race against friends',
  candidateRequirements: [{ text: 'Show the ghost of a friend', type: 'functional', source: 'stated' }],
  gaps: [{ topic: 'deadline', description: 'No deadline given', critical: true }],
  questions: [question('goal'), question('deadline')],
};

describe('intake stage', () => {
  it('drafts the Epic, explains the idea back and sends the questionnaire', async () => {
    const { ctx, services, events, prompts, saved } = setup({ elicitation });
    const outcome = await intakeStage(services)(ctx);

    expect(outcome.next).toBe('awaiting_answers');
    expect(prompts.elicitation).toContain(
      "<client_request>\nRace against a friend's ghost.\n</client_request>",
    );
    expect(saved.questionnaires).toEqual([{ round: 1, ids: ['goal', 'deadline'] }]);
    const message = events.find((e) => e.type === 'message');
    expect(message).toMatchObject({ role: 'ai' });
    expect((message as { text: string }).text).toContain('AIPM-40');
    expect(events.at(-1)?.type).toBe('questionnaire');
  });
});

const review = (followUps: number, critical: boolean): ElicitationReview => ({
  requirements: [{ text: 'Show the ghost of a friend', type: 'functional', source: 'answer' }],
  assumptions: [{ text: 'Assume iOS and Android', reason: 'not sure about platforms' }],
  remainingGaps: critical
    ? [{ topic: 'netcode', description: 'Whether ghosts must sync live', critical: true }]
    : [],
  followUpQuestions: Array.from({ length: followUps }, (_, i) => question(`custom_${i + 1}`)),
});

describe('eliciting stage', () => {
  it('asks a follow-up round only for critical gaps, and only once', async () => {
    const first = setup(
      { 'elicitation-review': review(1, true) },
      { answered: 1, stageOutput: { elicitation } },
    );
    expect((await elicitingStage(first.services)(first.ctx)).next).toBe('awaiting_answers');
    expect(first.saved.questionnaires).toEqual([{ round: 2, ids: ['custom_1'] }]);
    expect(first.saved.assumptions).toEqual([
      { text: 'Assume iOS and Android', reason: 'not sure about platforms' },
    ]);

    const second = setup({ 'elicitation-review': review(1, true) }, { answered: 2 });
    expect((await elicitingStage(second.services)(second.ctx)).next).toBe('analyzing');
    expect(second.prompts['elicitation-review']).toContain('This was the last round');
  });

  it('moves on and lists the assumptions when nothing critical is left', async () => {
    const { ctx, services, events } = setup({ 'elicitation-review': review(0, false) }, { answered: 1 });
    expect((await elicitingStage(services)(ctx)).next).toBe('analyzing');
    expect((events[0] as { text: string }).text).toContain('- Assume iOS and Android');
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
});
