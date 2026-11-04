import { type AnsweredQuestionnaire, NOT_SURE, type Questionnaire } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type { DiscoveryReview } from '../agents/schemas.js';
import { loadDiscoveryConfig, parseDiscoveryConfig, toUiQuestion } from './discovery-config.js';
import {
  buildReport,
  clarificationQuestion,
  evaluateAnswers,
  InvalidSubmission,
  validateSubmission,
} from './discovery.js';

const config = loadDiscoveryConfig();
const coreQuestionnaire: Questionnaire = {
  id: 'q1',
  round: 1,
  questions: config.questions.map(toUiQuestion),
  allowComment: true,
};

/** A decisive, consistent client with data behind the request. */
const GOOD: Record<string, string[]> = {
  problem: ['retention'],
  outcome: ['retention_d1_d7'],
  evidence: ['analytics'],
  audience: ['casual'],
  first_release_scope: ['core', 'ui', 'economy'],
  success: ['retention'],
  priority: ['high'],
  constraints: ['flexible_budget', 'flexible_timeline'],
  dependencies: ['modify_existing'],
  approval: ['full'],
};

const round1 = (
  overrides: Record<string, string[]> = {},
  details: Record<string, string> = {},
): AnsweredQuestionnaire => ({ ...coreQuestionnaire, answers: { ...GOOD, ...overrides }, details });

const emptyReview: DiscoveryReview = {
  summary: 'The request is clear and consistent with the baseline.',
  requirements: [{ text: 'Show a daily reward calendar', type: 'functional', source: 'stated' }],
  findings: [],
  assumptions: [],
  gaps: [],
  contradictions: [],
  clarificationQuestions: [],
};

const report = (answered: AnsweredQuestionnaire[], review: Partial<DiscoveryReview> = {}) =>
  buildReport({
    config,
    round: answered.length,
    evaluation: evaluateAnswers(config, answered),
    review: { ...emptyReview, ...review },
  });

describe('discovery config', () => {
  it('loads the ten core questions in five areas', () => {
    expect(config.questions).toHaveLength(10);
    expect(new Set(config.questions.map((q) => q.section)).size).toBe(5);
  });

  it('rejects rules that reference unknown questions or options', () => {
    const broken = `
maxRounds: 2
maxClarifications: 3
maxFeatureQuestions: 2
sections: [{ id: feasibility, title: F }, { id: decision_readiness, title: D }]
questions:
  - { id: evidence, section: feasibility, text: Evidence?, kind: single, why: w, infoKind: confirmed, label: E,
      options: [{ value: a, label: A, evidence: strong }, { value: b, label: B, evidence: none }] }
  - { id: approval, section: decision_readiness, text: Approval?, kind: single, why: w, infoKind: confirmed, label: Ap,
      options: [{ value: full, label: Full, approval: full }, { value: none, label: None, approval: none }] }
rules:
  - { id: r1, severity: warning, when: [{ question: priority, anyOf: [critical] }], message: m }
  - { id: r2, severity: warning, when: [{ question: evidence, anyOf: [zzz] }], message: m }
`;
    expect(() => parseDiscoveryConfig(broken)).toThrow(
      /Rule r1: unknown question[\s\S]*Rule r2: evidence has no option/,
    );
  });

  it('sends the UI no server-only tags', () => {
    const evidence = toUiQuestion(config.questions.find((q) => q.id === 'evidence')!);
    expect(JSON.stringify(evidence)).not.toMatch(/"evidence":"|unknown|detailRequired/);
  });
});

describe('submission check', () => {
  it('accepts a valid submission and keeps details of chosen options only', () => {
    const { details, lines } = validateSubmission(coreQuestionnaire, {
      questionnaireId: 'q1',
      answers: { ...GOOD, success: ['kpi_target'] },
      details: { 'success:kpi_target': 'D7 +2 points', 'problem:other': 'ignored' },
    });
    expect(details).toEqual({ 'success:kpi_target': 'D7 +2 points' });
    expect(lines.find((l) => l.includes('define success'))).toContain('A specific KPI target (D7 +2 points)');
  });

  it.each([
    [{ outcome: ['dau', 'revenue', 'acquisition'] }, /at most 2/],
    [{ constraints: ['fixed_budget', 'flexible_budget'] }, /cannot both be chosen/],
    [{ dependencies: ['none', 'backend'] }, /cannot be combined/],
    [{ priority: ['high', 'low'] }, /Choose one/],
    [{ audience: ['martians'] }, /Unknown answer/],
    [{ approval: [] }, /Please answer/],
  ])('rejects %j', (overrides, message) => {
    expect(() =>
      validateSubmission(coreQuestionnaire, { questionnaireId: 'q1', answers: { ...GOOD, ...overrides } }),
    ).toThrow(message);
    expect(() =>
      validateSubmission(coreQuestionnaire, { questionnaireId: 'q1', answers: { ...GOOD, ...overrides } }),
    ).toThrow(InvalidSubmission);
  });
});

describe('discovery completeness', () => {
  it('passes a complete, consistent, evidence-backed discovery with high confidence', () => {
    const { report: r, clarifications } = report([round1()]);
    expect(r).toMatchObject({ result: 'complete', confidence: 'high', nextAction: { action: 'proceed' } });
    expect(r.coverage.every((c) => c.status === 'covered')).toBe(true);
    expect(clarifications).toEqual([]);
    expect(r.findings.find((f) => f.source === 'outcome')).toMatchObject({
      kind: 'client_assumption',
      text: expect.stringContaining('backed by: Game analytics'),
    });
  });

  it('records an outcome without evidence as an unvalidated hypothesis, not a fact', () => {
    const { report: r, assumptions } = report([round1({ evidence: ['no_evidence'] })]);
    expect(r.result).toBe('complete_with_assumptions');
    expect(r.confidence).toBe('medium');
    expect(r.findings.filter((f) => f.kind === 'confirmed').map((f) => f.source)).not.toContain('outcome');
    expect(r.findings.find((f) => f.source === 'outcome')?.text).toContain('unvalidated client hypothesis');
    expect(assumptions).toContainEqual(
      expect.objectContaining({
        kind: 'client_hypothesis',
        text: expect.stringContaining('Unvalidated business hypothesis: expected outcome'),
      }),
    );
  });

  it('turns "not yet determined" into missing information with a default, never a confirmed answer', () => {
    const { report: r, assumptions } = report([
      round1({ success: ['undefined'], constraints: ['undetermined'] }),
    ]);
    expect(r.result).toBe('complete_with_assumptions');
    expect(r.findings.filter((f) => f.kind === 'missing').map((f) => f.source)).toEqual([
      'success',
      'constraints',
    ]);
    expect(r.coverage.find((c) => c.area === 'scope')?.status).toBe('partial');
    expect(assumptions.filter((a) => a.kind === 'default')).toHaveLength(2);
  });

  it('treats a missing business justification as a critical gap', () => {
    const { report: r } = report([
      round1({ problem: ['undetermined'], outcome: ['undetermined'], evidence: ['no_evidence'] }),
    ]);
    expect(r.coverage.find((c) => c.area === 'business_justification')?.status).toBe('missing');
    expect(r.gaps.filter((g) => g.critical)).toHaveLength(2);
    expect(r.confidence).toBe('low');
    // No rule question exists for it, so without an agent question the client decides.
    expect(r.result).toBe('insufficient');
  });

  it('flags critical priority with a fixed budget and a flexible timeline, and asks before scheduling', () => {
    const answered = [round1({ priority: ['critical'], constraints: ['fixed_budget', 'flexible_timeline'] })];
    const { report: r, clarifications } = report(answered);
    expect(r.result).toBe('needs_clarification');
    expect(r.confidence).toBe('low');
    expect(r.contradictions).toContainEqual(
      expect.objectContaining({
        id: 'critical_but_flexible_timeline',
        severity: 'blocking',
        resolved: false,
      }),
    );
    expect(clarifications.map((q) => q.id)).toEqual(['clarify_critical_but_flexible_timeline']);
    expect(clarifications[0]!.options.at(-1)?.value).toBe(NOT_SURE);
    expect(r.nextAction.action).toBe('clarify');
  });

  it('resolves a contradiction with a definite clarification answer', () => {
    const first = round1({ priority: ['critical'], constraints: ['fixed_budget', 'flexible_timeline'] });
    const rule = config.rules.find((x) => x.id === 'critical_but_flexible_timeline')!;
    const second: AnsweredQuestionnaire = {
      id: 'q2',
      round: 2,
      questions: [clarificationQuestion(rule)],
      answers: { clarify_critical_but_flexible_timeline: ['firm_date'] },
      details: { 'clarify_critical_but_flexible_timeline:firm_date': 'Halloween update' },
    };
    const { report: r } = report([first, second]);
    expect(r.contradictions[0]).toMatchObject({ resolved: true });
    // The date from the clarification answers the open "which release or date?" of round 1.
    expect(r.gaps).toEqual([]);
    expect(r.findings.find((f) => f.source === 'priority')?.text).toContain('(Halloween update)');
    expect(r.result).toBe('complete');
    expect(r.findings).toContainEqual(
      expect.objectContaining({ kind: 'confirmed', text: expect.stringContaining('Halloween update') }),
    );
  });

  it('hands an unresolved contradiction to the client after the last round', () => {
    const first = round1({ priority: ['critical'], constraints: ['fixed_budget', 'flexible_timeline'] });
    const rule = config.rules.find((x) => x.id === 'critical_but_flexible_timeline')!;
    const second: AnsweredQuestionnaire = {
      id: 'q2',
      round: 2,
      questions: [clarificationQuestion(rule)],
      answers: { clarify_critical_but_flexible_timeline: [NOT_SURE] },
    };
    const { report: r, clarifications, assumptions } = report([first, second]);
    expect(r.result).toBe('insufficient');
    expect(r.nextAction.action).toBe('client_decision');
    expect(clarifications).toEqual([]);
    expect(assumptions).toContainEqual(expect.objectContaining({ kind: 'open_issue' }));
  });

  it('notes warnings without blocking, and adds the readiness note when the client cannot approve', () => {
    const { report: r } = report([
      round1({
        first_release_scope: ['core', 'integration'],
        dependencies: ['none'],
        approval: ['scope_only'],
      }),
    ]);
    expect(r.result).toBe('complete_with_assumptions');
    expect(r.contradictions).toEqual([
      expect.objectContaining({ id: 'integration_without_dependencies', severity: 'warning' }),
    ]);
    expect(r.readiness.canApprove).toBe('scope_only');
    expect(r.nextAction.text).toContain('budget and timeline need another approver');
  });

  it('merges agent findings: its blocking contradiction asks a clarification question', () => {
    const { report: r, clarifications } = report([round1()], {
      contradictions: [
        { text: 'The description says "skin only", but backend work is in scope.', severity: 'blocking' },
      ],
      clarificationQuestions: [
        {
          id: 'skin_or_backend',
          text: 'Is this a visual change only?',
          kind: 'single',
          options: [
            { value: 'visual', label: 'Visual only' },
            { value: 'backend', label: 'It needs server work too' },
          ],
          why: 'It decides the effort',
          gap: 'scope',
        },
      ],
      findings: [{ kind: 'ai_hypothesis', area: 'scope', text: 'Rewards reuse the wallet', source: 'ai' }],
    });
    expect(r.result).toBe('needs_clarification');
    expect(clarifications.map((q) => q.id)).toEqual(['clarify_ai_1_1']);
    expect(r.findings.at(-1)).toMatchObject({ kind: 'ai_hypothesis' });
  });
});
