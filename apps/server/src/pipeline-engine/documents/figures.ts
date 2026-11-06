import type { ValueScenario } from '@ai-pm/shared';
import { formatDate } from '../../baseline/facts.js';
import { formatInt, formatPercent, formatUsd } from '../../render/tables.js';
import { baselineImpact } from '../calculators/baseline.js';
import type { DocumentInputs } from './inputs.js';

/**
 * The figure registry: every value a document prints that comes from the pipeline DB, by key.
 * Templates and the writer's text reference them as {{figure:key}}; the writer never types a
 * number itself. Built fresh on every publish, so a document always matches the DB.
 */
export type Figures = Record<string, string>;

const points = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const sprints = (n: number) => `${formatInt(n)} sprint${n === 1 ? '' : 's'}`;
const signedPercent = (ratio: number) => `${ratio < 0 ? '−' : ''}${formatPercent(Math.abs(ratio))}`;
const money = (n: number) => `${n < 0 ? '−' : ''}${formatUsd(Math.abs(n))}`;
const date = (iso: string | null) => (iso ? formatDate(iso) : 'not set');

const MAGNITUDE: Record<string, string> = {
  cosmetic: 'UI / cosmetic change',
  feature_extension: 'Feature extension',
  core_engine: 'Core engine change',
};

function scenarioFigures(s: ValueScenario, horizon: number): Figures {
  const p = `value.${s.name}`;
  return {
    [`${p}.roi`]: signedPercent(s.roi),
    [`${p}.npv`]: money(s.npvUsd),
    [`${p}.benefit`]: money(s.benefitUsd),
    [`${p}.monthly_revenue`]: money(s.monthlyRevenueUsd),
    [`${p}.reach`]: formatPercent(s.reach),
    [`${p}.payback`]: s.paybackMonth ? `month ${s.paybackMonth}` : `not within ${horizon} months`,
  };
}

export function buildFigures(inputs: DocumentInputs): Figures {
  const a = inputs.assessment;
  const { mvp, full } = a.forecast;
  const f = inputs.baseline.financials;
  const impact = baselineImpact({
    approvedBudgetUsd: f.approved_budget_usd,
    spentToDateUsd: f.spent_to_date_usd,
    featureCostP85Usd: a.budget.total.p85,
  });
  const reqs = inputs.analysis.requirements;
  const high = a.risks.filter((r) => r.level === 'high' || r.level === 'critical').length;

  const figures: Figures = {
    fa: `FA-${inputs.faNumber}`,
    feature: inputs.featureName,
    epic: inputs.epicKey ?? 'not created yet',
    verdict: a.verdict.label,
    preliminary: a.preliminary ? 'preliminary' : 'not preliminary',
    magnitude: MAGNITUDE[inputs.analysis.magnitude] ?? inputs.analysis.magnitude,

    'requirements.count': formatInt(reqs.length),
    'requirements.functional': formatInt(reqs.filter((r) => r.type === 'functional').length),
    'requirements.non_functional': formatInt(reqs.filter((r) => r.type === 'non_functional').length),
    'requirements.mvp': formatInt(reqs.filter((r) => r.inMvp).length),

    'start.sprint': `Sprint ${a.inputs.startSprint}`,
    'start.date': date(a.inputs.startDate),
    'capacity.share': formatPercent(a.inputs.capacityShare),
    'velocity.average': points(a.inputs.averageVelocity),
    'team.cost_per_sprint': money(a.inputs.teamCostPerSprintUsd),
    'team.cost_per_point': money(a.inputs.costPerPointUsd),
    'forecast.trials': formatInt(a.inputs.trials),
    deadline: a.inputs.deadline.date
      ? `${date(a.inputs.deadline.date)}${a.inputs.deadline.hard ? ' (hard)' : ''}`
      : (a.inputs.deadline.text ?? 'none'),

    'scope.mvp.items': formatInt(a.storyMap.totals.mvp.items),
    'scope.mvp.points': points(a.storyMap.totals.mvp.mean),
    'scope.full.items': formatInt(a.storyMap.totals.full.items),
    'scope.full.points': points(a.storyMap.totals.full.mean),

    'budget.labour.p50': money(a.budget.labour.p50),
    'budget.labour.p85': money(a.budget.labour.p85),
    'budget.non_labour': money(a.budget.nonLabourTotal),
    'budget.emv': money(a.budget.emvTotal),
    'budget.contingency': money(a.budget.contingency),
    'budget.total.p50': money(a.budget.total.p50),
    'budget.total.p85': money(a.budget.total.p85),
    'budget.limit': money(a.inputs.budgetLimit.amountUsd),
    'budget.limit_name':
      a.inputs.budgetLimit.source === 'client' ? "the client's budget limit" : 'the remaining project budget',
    'budget.limit_usage': formatPercent(a.budget.limitUsage),

    'baseline.approved_budget': money(f.approved_budget_usd),
    'baseline.spent': money(f.spent_to_date_usd),
    'baseline.remaining': money(impact.remainingUsd),
    'baseline.remaining_after': money(impact.remainingAfterUsd),
    'baseline.share_of_remaining':
      impact.shareOfRemaining === null ? 'n/a' : formatPercent(impact.shareOfRemaining),

    'roadmap.release': a.roadmapImpact.release ?? 'none',
    'roadmap.finish_without': date(a.roadmapImpact.finishWithout),
    'roadmap.finish_with': date(a.roadmapImpact.finishWith),
    'roadmap.delay': sprints(a.roadmapImpact.delaySprints),
    'roadmap.launch_target': date(a.roadmapImpact.launchTarget),
    'roadmap.launch_at_risk': a.roadmapImpact.launchAtRisk ? 'at risk' : 'not at risk',

    'risks.count': formatInt(a.risks.length),
    'risks.high': formatInt(high),

    'value.primary_kpi': a.value.primaryKpi,
    'value.horizon': `${a.value.horizonMonths} months`,
    'value.benefit_start': date(a.value.benefitStart),
    'value.break_even': a.value.breakEvenFactor === null ? 'n/a' : formatPercent(a.value.breakEvenFactor),

    'wsjf.score': points(a.wsjf.score),
    'wsjf.business_value': String(a.wsjf.businessValue),
    'wsjf.time_criticality': String(a.wsjf.timeCriticality),
    'wsjf.risk_reduction': String(a.wsjf.riskReduction),
    'wsjf.job_size': String(a.wsjf.jobSize),
  };

  for (const [slice, fc] of [
    ['mvp', mvp],
    ['full', full],
  ] as const) {
    for (const p of ['p50', 'p85', 'p95'] as const) {
      figures[`forecast.${slice}.sprints.${p}`] = sprints(fc.sprints[p]);
      figures[`forecast.${slice}.date.${p}`] = date(fc.dates[p]);
    }
  }
  for (const s of a.value.scenarios) Object.assign(figures, scenarioFigures(s, a.value.horizonMonths));
  return figures;
}

/** {{figure:key}} placeholders in a text. */
export const FIGURE_PATTERN = /\{\{figure:([a-z0-9_.]+)\}\}/g;

export const figureKeys = (text: string) => [...text.matchAll(FIGURE_PATTERN)].map((m) => m[1]!);

/** Replaces every placeholder; unknown keys throw, because the validator should have caught them. */
export function fillFigures(text: string, figures: Figures): string {
  return text.replace(FIGURE_PATTERN, (placeholder, key: string) => {
    const value = figures[key];
    if (value === undefined) throw new Error(`Unknown figure ${placeholder}`);
    return value;
  });
}
