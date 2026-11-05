import { z } from 'zod';

/**
 * The feature assessment (BPMN 03): estimates, release forecast, resources, budget, risks, value
 * and the verdict. Every number is computed by the harness; agents supply only judgements.
 * Shown on the Analysis tab; Phases 5–7 turn it into documents, slides and the backlog.
 */

const percentiles = z.object({ p50: z.number(), p85: z.number(), p95: z.number() });
const datePercentiles = z.object({ p50: z.string(), p85: z.string(), p95: z.string() });

export const DISCIPLINES = ['gameplay', 'backend', 'ui_art', 'qa', 'other'] as const;
export const disciplineSchema = z.enum(DISCIPLINES);
export type Discipline = z.infer<typeof disciplineSchema>;

export const estimateItemSchema = z.object({
  ref: z.string(),
  activity: z.string(),
  title: z.string(),
  type: z.enum(['story', 'spike', 'enabler', 'nfr']),
  release: z.enum(['mvp', 'later']),
  discipline: disciplineSchema,
  requirementCodes: z.array(z.string()),
  optimistic: z.number(),
  mostLikely: z.number(),
  pessimistic: z.number(),
  /** PERT: (O + 4M + P) / 6 and (P − O) / 6. */
  mean: z.number(),
  sd: z.number(),
  referenceStory: z.string().nullable(),
  rationale: z.string(),
});
export type EstimateItem = z.infer<typeof estimateItemSchema>;

export const forecastSchema = z.object({
  /** Total story points of the slice. */
  points: percentiles,
  sprints: percentiles,
  /** End of the sprint in which the work is done, ISO dates. */
  dates: datePercentiles,
  /** Share of trials finishing in exactly n sprints. */
  histogram: z.array(z.object({ sprints: z.number(), share: z.number() })),
  /** null when there is no hard deadline. */
  meetsDeadline: z.object({ p50: z.boolean(), p85: z.boolean() }).nullable(),
});
export type Forecast = z.infer<typeof forecastSchema>;

export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const assessedRiskSchema = z.object({
  id: z.string(),
  title: z.string(),
  cause: z.string(),
  event: z.string(),
  effect: z.string(),
  category: z.string(),
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  score: z.number(),
  level: riskLevelSchema,
  strategy: z.string(),
  response: z.string(),
  owner: z.string(),
  trigger: z.string(),
  /** What the risk costs if it happens, and probability × cost. */
  costImpactUsd: z.number(),
  emvUsd: z.number(),
  /** The Risk Register entry it updates, e.g. R-02. */
  existingRiskId: z.string().nullable(),
  source: z.enum(['analysis', 'discovery', 'dependency', 'assumption']),
});
export type AssessedRisk = z.infer<typeof assessedRiskSchema>;

export const valueScenarioSchema = z.object({
  name: z.enum(['pessimistic', 'base', 'optimistic']),
  /** Share of players the feature reaches. */
  reach: z.number(),
  kpiChanges: z.array(
    z.object({ kpi: z.string(), change: z.number(), unit: z.string(), capped: z.boolean() }),
  ),
  dauChangePct: z.number(),
  arpdauChangePct: z.number(),
  /** Extra revenue per month at full effect. */
  monthlyRevenueUsd: z.number(),
  benefitUsd: z.number(),
  roi: z.number(),
  npvUsd: z.number(),
  /** Months after release until the cumulative cash flow turns positive; null = not in the horizon. */
  paybackMonth: z.number().nullable(),
  /** Cumulative cash flow per month, month 0 = the investment. */
  cumulative: z.array(z.number()),
  rationale: z.string(),
});
export type ValueScenario = z.infer<typeof valueScenarioSchema>;

export const verdictSchema = z.object({
  decision: z.enum(['go', 'go_with_conditions', 'no_go']),
  label: z.string(),
  preliminary: z.boolean(),
  /** Why the rules decided this way. */
  reasons: z.array(z.string()),
  /** What must happen for a Go (with conditions) to hold. */
  conditions: z.array(z.string()),
});
export type Verdict = z.infer<typeof verdictSchema>;

export const assessmentSchema = z.object({
  runId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  preliminary: z.boolean(),
  preliminaryReasons: z.array(z.string()),
  inputs: z.object({
    magnitude: z.string(),
    discoveryConfidence: z.string().nullable(),
    evidence: z.string(),
    startSprint: z.number(),
    startDate: z.string(),
    capacityShare: z.number(),
    averageVelocity: z.number(),
    teamCostPerSprintUsd: z.number(),
    costPerPointUsd: z.number(),
    deadline: z.object({
      date: z.string().nullable(),
      text: z.string().nullable(),
      hard: z.boolean(),
      source: z.enum(['answer', 'clarification', 'ai_interpretation', 'none']),
    }),
    budgetLimit: z.object({
      amountUsd: z.number(),
      source: z.enum(['client', 'remaining_project_budget']),
      text: z.string().nullable(),
    }),
    trials: z.number(),
    seed: z.number(),
  }),
  storyMap: z.object({
    items: z.array(estimateItemSchema),
    totals: z.object({
      mvp: z.object({ mean: z.number(), sd: z.number(), items: z.number() }),
      full: z.object({ mean: z.number(), sd: z.number(), items: z.number() }),
    }),
    assumptions: z.array(z.string()),
  }),
  forecast: z.object({ mvp: forecastSchema, full: forecastSchema }),
  resources: z.array(
    z.object({
      discipline: disciplineSchema,
      pointsShare: z.number(),
      /** FTE this discipline needs at the forecast pace, against the FTE the team has. */
      demandFte: z.number(),
      availableFte: z.number(),
      /** Sprints this discipline needs for its own share at its capacity; null if it has none. */
      sprintsNeeded: z.number().nullable(),
      /** Its own work takes longer than the P85 forecast. */
      bottleneck: z.boolean(),
    }),
  ),
  roadmapImpact: z.object({
    release: z.string().nullable(),
    remainingPoints: z.number(),
    finishWithout: z.string().nullable(),
    finishWith: z.string().nullable(),
    delaySprints: z.number(),
    launchTarget: z.string().nullable(),
    launchAtRisk: z.boolean(),
  }),
  budget: z.object({
    byRole: z.array(
      z.object({ role: z.string(), fte: z.number(), rate: z.number(), p50: z.number(), p85: z.number() }),
    ),
    labour: z.object({ p50: z.number(), p85: z.number() }),
    nonLabour: z.array(
      z.object({
        description: z.string(),
        kind: z.enum(['one_off', 'monthly']),
        amountUsd: z.number(),
        totalUsd: z.number(),
        basis: z.string(),
      }),
    ),
    nonLabourTotal: z.number(),
    /** Sum of the risks' expected monetary value. */
    emvTotal: z.number(),
    /** The contingency reserve: the EMV total, capped at a share of the labour cost. */
    contingency: z.number(),
    contingencyCapped: z.boolean(),
    total: z.object({ p50: z.number(), p85: z.number() }),
    /** Total at P85 as a share of the budget limit. */
    limitUsage: z.number(),
  }),
  risks: z.array(assessedRiskSchema),
  value: z.object({
    primaryKpi: z.string(),
    drivers: z.string(),
    horizonMonths: z.number(),
    benefitStart: z.string(),
    scenarios: z.array(valueScenarioSchema),
    /** The base-case effect must reach this share for the investment to break even. */
    breakEvenFactor: z.number().nullable(),
    breakEvenText: z.string(),
    validation: z.string(),
    assumptions: z.array(z.string()),
  }),
  wsjf: z.object({
    businessValue: z.number(),
    timeCriticality: z.number(),
    riskReduction: z.number(),
    jobSize: z.number(),
    score: z.number(),
    rationale: z.string(),
  }),
  verdict: verdictSchema,
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const assessmentSummarySchema = z.object({
  runId: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  decision: verdictSchema.shape.decision,
  label: z.string(),
  preliminary: z.boolean(),
  p85Date: z.string(),
  p85BudgetUsd: z.number(),
  baseNpvUsd: z.number(),
});
export type AssessmentSummary = z.infer<typeof assessmentSummarySchema>;
