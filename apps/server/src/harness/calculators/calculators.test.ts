import type { AssessedRisk, Forecast } from '@ai-pm/shared';
import { describe, expect, it } from 'vitest';
import { loadAssessmentConfig } from '../assessment-config.js';
import { parseDate, parseMoney, sprintEnd, sprintStart } from './calendar.js';
import { disciplinePace, releaseDelay, resourceDemand } from './capacity.js';
import { monteCarlo, percentile, pert, pertTotal } from './estimation.js';
import {
  assessRisks,
  breakEvenFactor,
  jobSize,
  labourCost,
  valueScenario,
  type ValueContext,
} from './finance.js';
import { betaPert, seededRng, seedFrom } from './random.js';
import { decideVerdict, type VerdictInput } from './verdict.js';

const config = loadAssessmentConfig();

describe('random', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seedFrom('run-1')).toBe(seedFrom('run-1'));
    expect(seedFrom('run-1')).not.toBe(seedFrom('run-2'));
  });

  it('draws beta-PERT values inside the range, centred near the PERT mean', () => {
    const rng = seededRng(7);
    const draws = Array.from({ length: 20_000 }, () => betaPert(2, 5, 14, rng));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...draws)).toBeLessThanOrEqual(14);
    const mean = draws.reduce((s, d) => s + d, 0) / draws.length;
    expect(mean).toBeCloseTo(pert({ optimistic: 2, mostLikely: 5, pessimistic: 14 }).mean, 1);
    expect(betaPert(3, 3, 3, rng)).toBe(3);
  });
});

describe('estimation', () => {
  it('computes PERT per item and for a sum of items', () => {
    expect(pert({ optimistic: 3, mostLikely: 5, pessimistic: 13 })).toEqual({ mean: 6, sd: 10 / 6 });
    const total = pertTotal([
      { optimistic: 3, mostLikely: 5, pessimistic: 13 },
      { optimistic: 1, mostLikely: 2, pessimistic: 3 },
    ]);
    expect(total.mean).toBe(8);
    expect(total.sd).toBeCloseTo(Math.sqrt((10 / 6) ** 2 + (2 / 6) ** 2), 10);
  });

  it('takes nearest-rank percentiles', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect([percentile(sorted, 50), percentile(sorted, 85), percentile(sorted, 95)]).toEqual([5, 9, 10]);
  });

  it('forecasts sprints with a seeded Monte Carlo: same seed, same answer', () => {
    const input = {
      items: [
        { optimistic: 5, mostLikely: 8, pessimistic: 13 },
        { optimistic: 3, mostLikely: 5, pessimistic: 8 },
        { optimistic: 8, mostLikely: 13, pessimistic: 21 },
      ],
      velocities: [28, 32, 30, 26, 34, 31],
      capacityShare: 0.5,
      trials: 5_000,
      maxSprints: 40,
    };
    const a = monteCarlo({ ...input, rng: seededRng(1) });
    const b = monteCarlo({ ...input, rng: seededRng(1) });
    expect(a.sprints).toEqual(b.sprints);
    // ~27 points at ~15 points per sprint: two sprints usually, three at the tail.
    expect(percentile(a.sprints, 50)).toBe(2);
    expect(percentile(a.sprints, 95)).toBeLessThanOrEqual(3);
    expect(a.histogram.reduce((s, h) => s + h.share, 0)).toBeCloseTo(1, 10);
    expect(() => monteCarlo({ ...input, velocities: [], rng: seededRng(1) })).toThrow(/velocity/);
  });

  it('never forecasts faster than the busiest discipline can work', () => {
    const items = [{ optimistic: 20, mostLikely: 20, pessimistic: 20, group: 'backend' }];
    const base = { items, velocities: [30], capacityShare: 0.5, trials: 200, maxSprints: 40 };
    // Team pace: 20 points at 15 per sprint = 2 sprints; the backend alone at 3.33 per sprint needs 6.
    expect(percentile(monteCarlo({ ...base, rng: seededRng(3) }).sprints, 50)).toBe(2);
    const bounded = monteCarlo({ ...base, rng: seededRng(3), groupPace: { backend: 15 / 4.5 } });
    expect(bounded.sprints.every((n) => n === 6)).toBe(true);
  });
});

describe('calendar', () => {
  it('lays out two-week sprints from the kickoff', () => {
    expect(sprintStart('2026-01-12', 1)).toBe('2026-01-12');
    expect(sprintStart('2026-01-12', 23)).toBe('2026-11-16');
    expect(sprintEnd('2026-01-12', 23)).toBe('2026-11-29');
  });

  it.each([
    ['Summer event, 1 July 2027', '2027-07-01'],
    ['July 1st, 2027', '2027-07-01'],
    ['15 March 2027', '2027-03-15'],
    ['by 2027-02-15', '2027-02-15'],
    ['October 2027', '2027-10-31'],
    ['Halloween update', null],
  ])('reads the date in "%s"', (text, date) => expect(parseDate(text)).toBe(date));

  it.each([
    ['$50,000', 50_000],
    ['about 120k', 120_000],
    ['USD 250 000', 250_000],
    ['1.2m', 1_200_000],
    ['tight', null],
  ])('reads the amount in "%s"', (text, amount) => expect(parseMoney(text)).toBe(amount));
});

describe('capacity', () => {
  const roles = [
    { role: 'Gameplay developer', fte: 2 },
    { role: 'Backend developer', fte: 1 },
    { role: 'UI/UX & 2D artist', fte: 1 },
    { role: 'QA engineer (shared)', fte: 0.5 },
    { role: 'Product Owner', fte: 1 },
  ];

  const items = [
    { discipline: 'backend' as const, mean: 20 },
    { discipline: 'gameplay' as const, mean: 10 },
    { discipline: 'ui_art' as const, mean: 10 },
  ];

  it('marks the discipline that sets the pace and its own duration', () => {
    // Half the points on 1 of 4.5 developer FTE: 20 points at 0.5 FTE × 6.67 points = 6 sprints.
    const demand = resourceDemand(items, roles, 0.5, 30);
    expect(demand.find((d) => d.discipline === 'backend')).toMatchObject({
      pointsShare: 0.5,
      demandFte: 1.13,
      availableFte: 0.5,
      sprintsNeeded: 6,
      bottleneck: true,
    });
    expect(demand.find((d) => d.discipline === 'gameplay')?.bottleneck).toBe(false);
    expect(disciplinePace(roles, 0.5, 30)).toMatchObject({ gameplay: 30 / 4.5, backend: 15 / 4.5 });
  });

  it('computes how much the current release slips while the feature takes capacity', () => {
    // 60 points left at 30 per sprint: 2 sprints alone; at half speed for 2 sprints, then full: 3.
    expect(releaseDelay(60, 30, 0.5, 2)).toEqual({ without: 2, with: 3, delay: 1 });
    expect(releaseDelay(0, 30, 0.5, 2)).toEqual({ without: 0, with: 0, delay: 0 });
  });
});

describe('budget and risk', () => {
  it('charges the capacity share of every role per sprint', () => {
    const cost = labourCost(
      [
        { role: 'Gameplay developer', fte: 2, rate: 80 },
        { role: 'Backend developer', fte: 1, rate: 85 },
      ],
      80,
      0.5,
      { p50: 3, p85: 4 },
    );
    expect(cost.byRole[0]).toMatchObject({ p50: 19_200, p85: 25_600 });
    expect(cost.p85).toBe(25_600 + 13_600);
  });

  it('scores risks, prices them and orders them by score', () => {
    const base = {
      cause: 'c',
      event: 'e',
      effect: 'f',
      category: 'Technical',
      strategy: 'Mitigate',
      response: 'r',
      owner: 'o',
      trigger: 't',
      existingRiskId: null,
      source: 'analysis' as const,
    };
    const risks = assessRisks(
      [
        {
          ...base,
          title: 'small',
          probability: 2,
          impact: 2,
          costImpact: { extraPoints: 5, delaySprints: 0, directCostUsd: 0 },
        },
        {
          ...base,
          title: 'big',
          probability: 4,
          impact: 5,
          costImpact: { extraPoints: 0, delaySprints: 1, directCostUsd: 2_000 },
        },
      ],
      { config: config.risk, costPerPointUsd: 1_250, featureCostPerSprintUsd: 19_300 },
    );
    expect(risks.map((r) => [r.title, r.score, r.level])).toEqual([
      ['big', 20, 'critical'],
      ['small', 4, 'low'],
    ]);
    expect(risks[0]).toMatchObject({ id: 'F-R2', costImpactUsd: 21_300, emvUsd: 14_910 });
    expect(risks[1]).toMatchObject({ costImpactUsd: 6_250, emvUsd: 1_875 });
  });

  it('maps story points to a Fibonacci job size', () => {
    expect([
      jobSize(8, config.wsjf.jobSize),
      jobSize(40, config.wsjf.jobSize),
      jobSize(500, config.wsjf.jobSize),
    ]).toEqual([1, 5, 20]);
  });
});

describe('value', () => {
  const ctx: ValueContext = {
    config: { ...config.value, rampMonths: 0, horizonMonths: 12 },
    dauBaseline: 12_000,
    dauTarget: 150_000,
    arpdau: 0.06,
    launchDate: '2027-02-15',
    benefitStart: '2027-03-01',
    investmentUsd: 50_000,
    monthlyRunCostUsd: 0,
    annualDiscountRate: 0.12,
  };

  it('turns KPI changes into revenue, ROI, NPV and payback', () => {
    // +1 point D7 for everyone = +2.5 % DAU = 150,000 × 0.06 × 30.4 × 0.025 per month.
    const s = valueScenario(
      { name: 'base', reach: 1, kpiChanges: [{ kpi: 'd7_retention', change: 1 }], rationale: 'r' },
      ctx,
    );
    expect(s.dauChangePct).toBe(2.5);
    expect(s.monthlyRevenueUsd).toBe(6_840);
    expect(s.benefitUsd).toBe(82_080);
    expect(s.roi).toBeCloseTo(0.642, 3);
    expect(s.paybackMonth).toBe(8);
    expect(s.cumulative[0]).toBe(-50_000);
    expect(s.npvUsd).toBeGreaterThan(25_000);
    expect(s.npvUsd).toBeLessThan(82_080 - 50_000);
  });

  it('caps implausible effects and uses the baseline DAU before the launch', () => {
    const s = valueScenario(
      { name: 'optimistic', reach: 1, kpiChanges: [{ kpi: 'd7_retention', change: 10 }], rationale: 'r' },
      { ...ctx, benefitStart: '2026-12-01' },
    );
    expect(s.kpiChanges[0]).toMatchObject({ change: 3, capped: true });
    // December and January at 12k DAU, then 150k.
    expect(s.cumulative[1]! - s.cumulative[0]!).toBeCloseTo(12_000 * 0.06 * 30.4 * 0.075, 0);
  });

  it('finds the share of the base effect that breaks even', () => {
    const base = {
      name: 'base' as const,
      reach: 1,
      kpiChanges: [{ kpi: 'd7_retention' as const, change: 1 }],
      rationale: 'r',
    };
    const k = breakEvenFactor(base, ctx)!;
    expect(k).toBeGreaterThan(0.6);
    expect(k).toBeLessThan(0.7);
    const atBreakEven = valueScenario({ ...base, kpiChanges: [{ kpi: 'd7_retention', change: k }] }, ctx);
    expect(Math.abs(atBreakEven.npvUsd)).toBeLessThan(2);
    expect(breakEvenFactor({ ...base, kpiChanges: [] }, ctx)).toBeNull();
  });
});

describe('verdict', () => {
  const forecast = (p50: string, p85: string, meets: { p50: boolean; p85: boolean } | null): Forecast => ({
    points: { p50: 30, p85: 36, p95: 40 },
    sprints: { p50: 2, p85: 3, p95: 3 },
    dates: { p50, p85, p95: p85 },
    histogram: [],
    meetsDeadline: meets,
  });
  const scenario = (name: 'pessimistic' | 'base' | 'optimistic', roi: number) => ({
    name,
    reach: 1,
    kpiChanges: [],
    dauChangePct: 0,
    arpdauChangePct: 0,
    monthlyRevenueUsd: 0,
    benefitUsd: 0,
    roi,
    npvUsd: roi * 1000,
    paybackMonth: null,
    cumulative: [],
    rationale: '',
  });
  const risk = (level: AssessedRisk['level'], strategy: string): AssessedRisk => ({
    id: 'F-R1',
    title: 'Cheating',
    cause: '',
    event: '',
    effect: '',
    category: 'Technical',
    probability: 4,
    impact: 5,
    score: 20,
    level,
    strategy,
    response: '',
    owner: '',
    trigger: '',
    costImpactUsd: 0,
    emvUsd: 0,
    existingRiskId: null,
    source: 'analysis',
  });
  const clean: VerdictInput = {
    config: config.verdict,
    deadline: { date: null, hard: false },
    forecast: {
      mvp: forecast('2026-12-13', '2026-12-27', null),
      full: forecast('2027-01-10', '2027-01-24', null),
    },
    budget: { p85: 60_000, limit: 485_400, limitSource: 'remaining_project_budget' },
    risks: [],
    scenarios: [scenario('pessimistic', -0.5), scenario('base', 0.4), scenario('optimistic', 1.2)],
    spike: { needed: false },
    blockingConflicts: [],
    roadmap: { delaySprints: 0, launchAtRisk: false, release: 'R2' },
    preliminary: { value: false, reasons: [] },
    readiness: { canApprove: 'full', note: '' },
    unvalidatedOutcome: false,
  };

  it('says Go when nothing needs a condition except the team re-estimate', () => {
    expect(decideVerdict(clean)).toMatchObject({ decision: 'go', label: 'Go', preliminary: false });
  });

  it('says Go with conditions for an MVP-only deadline, an over-limit budget and high risks', () => {
    const v = decideVerdict({
      ...clean,
      deadline: { date: '2027-01-01', hard: true },
      forecast: {
        mvp: forecast('2026-12-13', '2026-12-27', { p50: true, p85: true }),
        full: forecast('2027-01-10', '2027-01-24', { p50: false, p85: false }),
      },
      budget: { p85: 110_000, limit: 100_000, limitSource: 'client' },
      risks: [risk('high', 'Mitigate')],
    });
    expect(v.decision).toBe('go_with_conditions');
    expect(v.conditions.join('\n')).toMatch(/Ship the MVP slice by 2027-01-01/);
    expect(v.conditions.join('\n')).toMatch(/Approve \$10,000 above the budget limit/);
    expect(v.conditions.join('\n')).toMatch(/F-R1 \(Cheating\)/);
  });

  it.each([
    [
      'the MVP misses a hard deadline',
      {
        deadline: { date: '2026-12-01', hard: true },
        forecast: {
          mvp: forecast('2026-12-13', '2026-12-27', { p50: false, p85: false }),
          full: forecast('2027-01-10', '2027-01-24', { p50: false, p85: false }),
        },
      },
    ],
    [
      'the budget is far over the limit',
      { budget: { p85: 130_000, limit: 100_000, limitSource: 'client' as const } },
    ],
    ['a critical risk is accepted unmitigated', { risks: [risk('critical', 'Accept')] }],
    [
      'even the optimistic case loses money',
      { scenarios: [scenario('base', -0.6), scenario('optimistic', -0.1)] },
    ],
  ])('says No-Go when %s', (_case, change) => {
    expect(decideVerdict({ ...clean, ...change }).decision).toBe('no_go');
  });

  it('marks the verdict preliminary when discovery was incomplete', () => {
    const v = decideVerdict({
      ...clean,
      preliminary: { value: true, reasons: ['discovery confidence is low'] },
    });
    expect(v).toMatchObject({
      decision: 'go_with_conditions',
      label: 'Go with conditions (preliminary)',
      preliminary: true,
    });
  });
});
