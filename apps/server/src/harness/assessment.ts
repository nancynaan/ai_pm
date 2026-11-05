import type { Assessment, DiscoveryReport, Forecast } from '@ai-pm/shared';
import type { EstimationResult, RiskAssessment, ValueAssessment } from '../agents/schemas.js';
import type { SeedData } from '../baseline/seed-data.js';
import type { StoredAnalysis } from './analysis-repository.js';
import type { AssessmentConfig } from './assessment-config.js';
import { addMonths, sprintEnd, sprintStart } from './calculators/calendar.js';
import { disciplinePace, releaseDelay, resourceDemand } from './calculators/capacity.js';
import { monteCarlo, percentile, pert, pertTotal } from './calculators/estimation.js';
import {
  assessRisks,
  breakEvenFactor,
  jobSize,
  labourCost,
  round,
  type ScenarioInput,
  type ValueContext,
  valueScenario,
} from './calculators/finance.js';
import { seededRng } from './calculators/random.js';
import { decideVerdict } from './calculators/verdict.js';
import type { Evidence } from './discovery.js';

/**
 * Builds the assessment from the planning facts and the agents' judgements. Pure: the stage
 * gathers the inputs and calls the agents; every number is computed here.
 */

export interface PlanningFacts {
  project: SeedData['project'];
  team: SeedData['team'];
  kpis: SeedData['kpis'];
  roadmap: SeedData['roadmap'];
  backlog: SeedData['backlog'];
}

export interface Deadline {
  date: string | null;
  text: string | null;
  hard: boolean;
  source: Assessment['inputs']['deadline']['source'];
}

export interface AssessmentInput {
  runId: string;
  title: string;
  now: Date;
  seed: number;
  config: AssessmentConfig;
  facts: PlanningFacts;
  analysis: StoredAnalysis;
  report: DiscoveryReport | null;
  evidence: Evidence;
  /** The client accepted open discovery issues. */
  acceptedOpenIssues: boolean;
  deadline: Deadline;
  budgetLimit: { amountUsd: number | null; text: string | null };
  estimation: EstimationResult;
  risks: RiskAssessment;
  value: ValueAssessment;
}

const KPI_LABEL: Record<string, string> = {
  dau: 'DAU',
  d1_retention: 'D1 retention',
  d7_retention: 'D7 retention',
  d30_retention: 'D30 retention',
  session_minutes: 'session length',
  payer_conversion: 'payer conversion',
  rewarded_views_per_dau: 'rewarded views per DAU',
  arpdau: 'ARPDAU',
};
const UNIT_TEXT: Record<string, string> = { pts: ' points', min: ' min', '%': ' %' };

export function buildAssessment(input: AssessmentInput): Assessment {
  const { config, facts, estimation, analysis } = input;
  const { team, project, kpis } = facts;
  const weeks = team.sprint_length_weeks;
  const share = team.capacity_share_new_epic;
  const velocities = team.velocity.map((v) => v.completed);
  const averageVelocity = velocities.reduce((s, v) => s + v, 0) / velocities.length;
  const teamCostPerSprint = team.roles.reduce((s, r) => s + r.fte * r.rate * team.hours_per_sprint, 0);
  const featureCostPerSprint = teamCostPerSprint * share;
  const costPerPoint = teamCostPerSprint / averageVelocity;
  const startSprint = project.current_sprint + 1;

  // ---- story map and forecast ----
  const items = estimation.items.map((i) => ({ ...i, ...pert(i) }));
  const mvpItems = items.filter((i) => i.release === 'mvp');
  // Each discipline's own pace bounds the forecast (the busiest one can set the pace).
  const groupPace = disciplinePace(team.roles, share, averageVelocity);
  const forecastOf = (slice: typeof items, seedOffset: number): Forecast => {
    const run = monteCarlo({
      items: slice.length
        ? slice.map((i) => ({ ...i, group: i.discipline === 'other' ? undefined : i.discipline }))
        : [{ optimistic: 0, mostLikely: 0, pessimistic: 0 }],
      groupPace,
      velocities,
      capacityShare: share,
      trials: config.forecast.trials,
      maxSprints: config.forecast.maxSprints,
      rng: seededRng(input.seed + seedOffset),
    });
    const sprintsAt = (p: number) => percentile(run.sprints, p);
    const dateAt = (p: number) => sprintEnd(project.kickoff, startSprint + sprintsAt(p) - 1, weeks);
    const dates = { p50: dateAt(50), p85: dateAt(85), p95: dateAt(95) };
    return {
      points: {
        p50: round(percentile(run.points, 50), 1),
        p85: round(percentile(run.points, 85), 1),
        p95: round(percentile(run.points, 95), 1),
      },
      sprints: { p50: sprintsAt(50), p85: sprintsAt(85), p95: sprintsAt(95) },
      dates,
      histogram: run.histogram.map((h) => ({ sprints: h.sprints, share: round(h.share, 4) })),
      meetsDeadline:
        input.deadline.hard && input.deadline.date
          ? { p50: dates.p50 <= input.deadline.date, p85: dates.p85 <= input.deadline.date }
          : null,
    };
  };
  const forecast = { mvp: forecastOf(mvpItems, 1), full: forecastOf(items, 2) };

  // ---- resources and roadmap ----
  const resources = resourceDemand(items, team.roles, share, averageVelocity);
  const current = facts.roadmap.releases.find((r) => r.status === 'in progress') ?? null;
  const remainingPoints = current
    ? facts.backlog.stories
        .filter((s) => current.epics.includes(s.epic) && s.status !== 'done')
        .reduce((s, st) => s + st.points, 0)
    : 0;
  const delay = releaseDelay(remainingPoints, averageVelocity, share, forecast.full.sprints.p50);
  const finish = (n: number) => (n > 0 ? sprintEnd(project.kickoff, startSprint + n - 1, weeks) : null);
  const finishWith = finish(delay.with);
  const roadmapImpact = {
    release: current ? `${current.id} ${current.name}` : null,
    remainingPoints,
    finishWithout: finish(delay.without),
    finishWith,
    delaySprints: delay.delay,
    launchTarget: project.global_launch_target,
    launchAtRisk: !!finishWith && finishWith > project.global_launch_target && delay.delay > 0,
  };

  // ---- risks and budget ----
  const risks = assessRisks(input.risks.risks, {
    config: config.risk,
    costPerPointUsd: costPerPoint,
    featureCostPerSprintUsd: featureCostPerSprint,
  });
  const labour = labourCost(team.roles, team.hours_per_sprint, share, forecast.full.sprints);
  const emvTotal = risks.reduce((s, r) => s + r.emvUsd, 0);
  const contingencyCap = labour.p50 * config.risk.contingencyCapShare;
  const contingency = Math.min(emvTotal, contingencyCap);
  const horizon = config.value.horizonMonths;
  const nonLabour = estimation.nonLabour.map((n) => ({
    ...n,
    totalUsd: n.kind === 'monthly' ? n.amountUsd * horizon : n.amountUsd,
  }));
  const oneOff = nonLabour.filter((n) => n.kind === 'one_off').reduce((s, n) => s + n.amountUsd, 0);
  const monthly = nonLabour.filter((n) => n.kind === 'monthly').reduce((s, n) => s + n.amountUsd, 0);
  const nonLabourTotal = oneOff + monthly * horizon;
  const total = {
    p50: round(labour.p50 + nonLabourTotal + contingency),
    p85: round(labour.p85 + nonLabourTotal + contingency),
  };
  const remainingBudget = kpis.financials.approved_budget_usd - kpis.financials.spent_to_date_usd;
  const limit = input.budgetLimit.amountUsd
    ? { amountUsd: input.budgetLimit.amountUsd, source: 'client' as const, text: input.budgetLimit.text }
    : {
        amountUsd: remainingBudget,
        source: 'remaining_project_budget' as const,
        text: input.budgetLimit.text,
      };

  // ---- value ----
  const metric = (key: string) => kpis.metrics.find((m) => m.key === key);
  const benefitStart = addMonths(forecast.mvp.dates.p50, 1);
  const ctx: ValueContext = {
    config: config.value,
    dauBaseline: metric('dau')?.baseline ?? 0,
    dauTarget: metric('dau')?.target ?? 0,
    arpdau: metric('arpdau')?.baseline ?? 0,
    launchDate: project.global_launch_target,
    benefitStart,
    investmentUsd: labour.p50 + oneOff + contingency,
    monthlyRunCostUsd: monthly,
    annualDiscountRate: kpis.financials.discount_rate_annual,
  };
  const scenarioInputs: ScenarioInput[] = (['pessimistic', 'base', 'optimistic'] as const).map((name) => {
    const s = input.value.scenarios[name];
    // With no evidence the pessimistic case is "the hypothesis is wrong": no effect.
    const noEvidence = name === 'pessimistic' && input.evidence === 'none';
    return {
      name,
      reach: s.reach,
      kpiChanges: noEvidence ? [] : s.kpiChanges,
      rationale: noEvidence
        ? `No supporting evidence, so the pessimistic case assumes no effect. ${s.rationale}`
        : s.rationale,
    };
  });
  const scenarios = scenarioInputs.map((s) => valueScenario(s, ctx));
  const baseInput = scenarioInputs[1]!;
  const factor = breakEvenFactor(baseInput, ctx);
  const primary =
    baseInput.kpiChanges.find((c) => c.kpi === input.value.primaryKpi) ?? baseInput.kpiChanges[0];
  const primaryScenario = scenarios[1]!.kpiChanges.find((c) => c.kpi === primary?.kpi);
  const breakEvenText =
    factor === null
      ? 'The base case has no measurable effect, so the investment does not break even within the horizon.'
      : `Breaks even within ${horizon} months if the effect reaches ${Math.round(factor * 100)} % of the base case${
          primary && primaryScenario
            ? ` (${KPI_LABEL[primary.kpi] ?? primary.kpi} ${round(primaryScenario.change * factor, 2) >= 0 ? '+' : ''}${round(primaryScenario.change * factor, 2)}${UNIT_TEXT[primaryScenario.unit] ?? ''} instead of ${primaryScenario.change >= 0 ? '+' : ''}${primaryScenario.change}${UNIT_TEXT[primaryScenario.unit] ?? ''})`
            : ''
        }.`;

  // ---- WSJF ----
  const totals = {
    mvp: { ...pertTotal(mvpItems), items: mvpItems.length },
    full: { ...pertTotal(items), items: items.length },
  };
  const size = jobSize(totals.full.mean, config.wsjf.jobSize);
  const w = input.value.wsjf;

  // ---- preliminary and verdict ----
  const preliminaryReasons = [
    ...(input.report && config.verdict.preliminaryWhenConfidence.includes(input.report.confidence)
      ? [`discovery confidence is ${input.report.confidence}`]
      : []),
    ...(input.acceptedOpenIssues ? ['the client accepted open discovery issues'] : []),
    ...(input.deadline.source === 'ai_interpretation'
      ? [`the deadline "${input.deadline.text}" was read as ${input.deadline.date}`]
      : []),
  ];
  const preliminary = preliminaryReasons.length > 0;
  const verdict = decideVerdict({
    config: config.verdict,
    deadline: input.deadline,
    forecast,
    budget: { p85: total.p85, limit: limit.amountUsd, limitSource: limit.source },
    risks,
    scenarios,
    spike: analysis.spike,
    blockingConflicts: analysis.conflicts
      .filter((c) => c.blocking)
      .map((c) => (c.description.length > 220 ? `${c.description.slice(0, 217)}…` : c.description)),
    roadmap: roadmapImpact,
    preliminary: { value: preliminary, reasons: preliminaryReasons },
    readiness: input.report?.readiness ?? null,
    unvalidatedOutcome: input.evidence === 'none' || input.evidence === 'weak',
  });

  return {
    runId: input.runId,
    title: input.title,
    createdAt: input.now.toISOString(),
    preliminary,
    preliminaryReasons,
    inputs: {
      magnitude: analysis.magnitude,
      discoveryConfidence: input.report?.confidence ?? null,
      evidence: input.evidence,
      startSprint,
      startDate: sprintStart(project.kickoff, startSprint, weeks),
      capacityShare: share,
      averageVelocity: round(averageVelocity, 1),
      teamCostPerSprintUsd: round(teamCostPerSprint),
      costPerPointUsd: round(costPerPoint),
      deadline: input.deadline,
      budgetLimit: limit,
      trials: config.forecast.trials,
      seed: input.seed,
    },
    storyMap: {
      items: items.map((i) => ({ ...i, mean: round(i.mean, 2), sd: round(i.sd, 2) })),
      totals: {
        mvp: { mean: round(totals.mvp.mean, 1), sd: round(totals.mvp.sd, 1), items: totals.mvp.items },
        full: { mean: round(totals.full.mean, 1), sd: round(totals.full.sd, 1), items: totals.full.items },
      },
      assumptions: estimation.assumptions,
    },
    forecast,
    resources,
    roadmapImpact,
    budget: {
      byRole: labour.byRole,
      labour: { p50: labour.p50, p85: labour.p85 },
      nonLabour,
      nonLabourTotal: round(nonLabourTotal),
      emvTotal: round(emvTotal),
      contingency: round(contingency),
      contingencyCapped: emvTotal > contingencyCap,
      total,
      limitUsage: round(total.p85 / limit.amountUsd, 3),
    },
    risks,
    value: {
      primaryKpi: input.value.primaryKpi,
      drivers: input.value.drivers,
      horizonMonths: horizon,
      benefitStart,
      scenarios,
      breakEvenFactor: factor === null ? null : round(factor, 3),
      breakEvenText,
      validation: input.value.validation,
      assumptions: input.value.assumptions,
    },
    wsjf: {
      businessValue: w.businessValue,
      timeCriticality: w.timeCriticality,
      riskReduction: w.riskReduction,
      jobSize: size,
      score: round((w.businessValue + w.timeCriticality + w.riskReduction) / size, 2),
      rationale: w.rationale,
    },
    verdict,
  };
}
