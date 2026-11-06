import { assessmentSchema } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import type { StageContext } from '../engine.js';
import { estimation, risks, round1, setupEstimating as setup, value } from '../testing/fixtures.js';
import { clientConstraints, estimatingStage } from './estimating.js';

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

describe('estimating stage', () => {
  it('runs the three agents, computes the assessment, saves it and links it from the chat', async () => {
    const { ctx, services, events, prompts, saved } = setup([
      round1(
        { priority: ['critical'], constraints: ['fixed_deadline'] },
        { 'constraints:fixed_deadline': '1 July 2027' },
      ),
    ]);
    const outcome = await estimatingStage(services)(ctx);
    expect(outcome.next).toBe('awaiting_documents');

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
