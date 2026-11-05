import type { AssessedRisk, ValueScenario } from '@ai-pm/shared';
import type { AssessmentConfig, ValueKpi } from '../assessment-config.js';
import { KPI_UNIT } from '../assessment-config.js';
import { addMonths } from './calendar.js';

/** Budget, risk exposure and the value model. Pure functions; amounts in USD. */

const DAYS_PER_MONTH = 30.4;
export const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

// ---- labour ---------------------------------------------------------------------------------

export interface Role {
  role: string;
  fte: number;
  rate: number;
}

/** The feature's share of every role, for a number of sprints. */
export function labourCost(
  roles: Role[],
  hoursPerSprint: number,
  capacityShare: number,
  sprints: { p50: number; p85: number },
) {
  const byRole = roles.map((r) => {
    const perSprint = r.fte * r.rate * hoursPerSprint * capacityShare;
    return {
      role: r.role,
      fte: r.fte,
      rate: r.rate,
      p50: round(perSprint * sprints.p50),
      p85: round(perSprint * sprints.p85),
    };
  });
  return {
    byRole,
    p50: byRole.reduce((s, r) => s + r.p50, 0),
    p85: byRole.reduce((s, r) => s + r.p85, 0),
  };
}

// ---- risk -----------------------------------------------------------------------------------

export interface RiskInput {
  title: string;
  cause: string;
  event: string;
  effect: string;
  category: string;
  probability: number;
  impact: number;
  strategy: string;
  response: string;
  owner: string;
  trigger: string;
  costImpact: { extraPoints: number; delaySprints: number; directCostUsd: number };
  existingRiskId: string | null;
  source: AssessedRisk['source'];
}

export function riskLevel(score: number, levels: AssessmentConfig['risk']['levels']): AssessedRisk['level'] {
  return score >= levels.critical
    ? 'critical'
    : score >= levels.high
      ? 'high'
      : score >= levels.medium
        ? 'medium'
        : 'low';
}

/**
 * Score = P × I; cost if it happens = extra points × cost per point + delay × the feature's cost
 * per sprint + direct cost; EMV = likelihood × cost. Sorted by score, then EMV.
 */
export function assessRisks(
  risks: RiskInput[],
  opts: { config: AssessmentConfig['risk']; costPerPointUsd: number; featureCostPerSprintUsd: number },
): AssessedRisk[] {
  return risks
    .map((r, i) => {
      const score = r.probability * r.impact;
      const cost =
        Math.max(0, r.costImpact.extraPoints) * opts.costPerPointUsd +
        Math.max(0, r.costImpact.delaySprints) * opts.featureCostPerSprintUsd +
        Math.max(0, r.costImpact.directCostUsd);
      const likelihood = opts.config.probability[r.probability as 1 | 2 | 3 | 4 | 5];
      return {
        title: r.title,
        cause: r.cause,
        event: r.event,
        effect: r.effect,
        category: r.category,
        probability: r.probability,
        impact: r.impact,
        strategy: r.strategy,
        response: r.response,
        owner: r.owner,
        trigger: r.trigger,
        existingRiskId: r.existingRiskId,
        source: r.source,
        id: `F-R${i + 1}`,
        score,
        level: riskLevel(score, opts.config.levels),
        costImpactUsd: round(cost),
        emvUsd: round(cost * likelihood),
      };
    })
    .sort((a, b) => b.score - a.score || b.emvUsd - a.emvUsd);
}

// ---- value ----------------------------------------------------------------------------------

export interface ScenarioInput {
  name: ValueScenario['name'];
  reach: number;
  kpiChanges: { kpi: ValueKpi; change: number }[];
  rationale: string;
}

export interface ValueContext {
  config: AssessmentConfig['value'];
  dauBaseline: number;
  dauTarget: number;
  arpdau: number;
  launchDate: string;
  /** First month with benefit (ISO date, first of the month). */
  benefitStart: string;
  /** Up-front cost (labour, one-off non-labour, contingency) at month 0. */
  investmentUsd: number;
  monthlyRunCostUsd: number;
  annualDiscountRate: number;
}

const monthlyRate = (annual: number) => (1 + annual) ** (1 / 12) - 1;

/** Revenue gain of one scenario per month of the horizon, before costs. */
function monthlyGains(s: ScenarioInput, ctx: ValueContext) {
  const { config } = ctx;
  const changes = s.kpiChanges.map((c) => {
    const cap = config.caps[c.kpi];
    const change = Math.max(-cap, Math.min(cap, c.change));
    return { kpi: c.kpi, change, unit: KPI_UNIT[c.kpi], capped: change !== c.change };
  });
  const reach = Math.max(0, Math.min(1, s.reach));
  const dauPct = changes.reduce((sum, c) => sum + c.change * config.elasticities[c.kpi].dauPct, 0) * reach;
  const arpdauPct =
    changes.reduce((sum, c) => sum + c.change * config.elasticities[c.kpi].arpdauPct, 0) * reach;
  const uplift = (1 + dauPct / 100) * (1 + arpdauPct / 100) - 1;
  const gains = Array.from({ length: config.horizonMonths }, (_, i) => {
    const month = addMonths(ctx.benefitStart, i);
    const dau =
      config.dauAfterLaunch === 'target' && month >= ctx.launchDate ? ctx.dauTarget : ctx.dauBaseline;
    const ramp = config.rampMonths ? Math.min(1, (i + 1) / config.rampMonths) : 1;
    return dau * ctx.arpdau * DAYS_PER_MONTH * uplift * ramp;
  });
  return { changes, dauPct, arpdauPct, gains };
}

function cashFlow(gains: number[], ctx: ValueContext) {
  const r = monthlyRate(ctx.annualDiscountRate);
  const flows = [-ctx.investmentUsd, ...gains.map((g) => g - ctx.monthlyRunCostUsd)];
  const npv = flows.reduce((s, f, i) => s + f / (1 + r) ** i, 0);
  const cumulative: number[] = [];
  flows.reduce((s, f) => {
    cumulative.push(round(s + f));
    return s + f;
  }, 0);
  const payback = cumulative.findIndex((c, i) => i > 0 && c >= 0);
  const totalCost = ctx.investmentUsd + ctx.monthlyRunCostUsd * gains.length;
  const benefit = gains.reduce((s, g) => s + g, 0);
  return {
    npv,
    cumulative,
    paybackMonth: payback > 0 ? payback : null,
    benefit,
    roi: totalCost ? (benefit - totalCost) / totalCost : 0,
  };
}

export function valueScenario(s: ScenarioInput, ctx: ValueContext): ValueScenario {
  const { changes, dauPct, arpdauPct, gains } = monthlyGains(s, ctx);
  const flow = cashFlow(gains, ctx);
  return {
    name: s.name,
    reach: s.reach,
    kpiChanges: changes,
    dauChangePct: round(dauPct, 2),
    arpdauChangePct: round(arpdauPct, 2),
    monthlyRevenueUsd: round(gains.at(-1) ?? 0),
    benefitUsd: round(flow.benefit),
    roi: round(flow.roi, 3),
    npvUsd: round(flow.npv),
    paybackMonth: flow.paybackMonth,
    cumulative: flow.cumulative,
    rationale: s.rationale,
  };
}

/**
 * The share of the base-case effect at which NPV is zero. Revenue is linear in the effect, so
 * k = (investment + PV of run costs) / PV of base gains. Null when the base case has no gain.
 */
export function breakEvenFactor(base: ScenarioInput, ctx: ValueContext): number | null {
  const { gains } = monthlyGains(base, ctx);
  const r = monthlyRate(ctx.annualDiscountRate);
  const pvGains = gains.reduce((s, g, i) => s + g / (1 + r) ** (i + 1), 0);
  const pvRun = gains.reduce((s, _g, i) => s + ctx.monthlyRunCostUsd / (1 + r) ** (i + 1), 0);
  return pvGains > 0 ? (ctx.investmentUsd + pvRun) / pvGains : null;
}

// ---- WSJF -----------------------------------------------------------------------------------

export function jobSize(points: number, buckets: AssessmentConfig['wsjf']['jobSize']): number {
  return (buckets.find((b) => points <= b.maxPoints) ?? buckets.at(-1)!).size;
}
