import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

/** Settings of the assessment stage, from config/feasibility-rules.yaml. */
export const FEASIBILITY_RULES_FILE = fileURLToPath(
  new URL('../../../../config/feasibility-rules.yaml', import.meta.url),
);

export const VALUE_KPIS = [
  'dau',
  'd1_retention',
  'd7_retention',
  'd30_retention',
  'session_minutes',
  'payer_conversion',
  'rewarded_views_per_dau',
  'arpdau',
] as const;
export type ValueKpi = (typeof VALUE_KPIS)[number];

/** How each KPI change is expressed. */
export const KPI_UNIT: Record<ValueKpi, string> = {
  dau: '%',
  d1_retention: 'pts',
  d7_retention: 'pts',
  d30_retention: 'pts',
  session_minutes: 'min',
  payer_conversion: '%',
  rewarded_views_per_dau: '%',
  arpdau: '%',
};

const perKpi = <T extends z.ZodType>(schema: T) =>
  z.object(Object.fromEntries(VALUE_KPIS.map((k) => [k, schema])) as Record<ValueKpi, T>);

const scale = z.object({ 1: z.number(), 2: z.number(), 3: z.number(), 4: z.number(), 5: z.number() });

const configSchema = z.strictObject({
  forecast: z.strictObject({
    trials: z.number().int().min(100).max(100_000),
    percentiles: z.tuple([z.literal(50), z.literal(85), z.literal(95)]),
    maxSprints: z.number().int().min(4).max(200),
  }),
  risk: z.strictObject({
    probability: scale,
    levels: z.strictObject({ medium: z.number(), high: z.number(), critical: z.number() }),
    contingencyCapShare: z.number().gt(0).max(1),
  }),
  value: z.strictObject({
    horizonMonths: z.number().int().min(3).max(60),
    rampMonths: z.number().int().min(0).max(12),
    dauAfterLaunch: z.enum(['target', 'baseline']),
    elasticities: perKpi(z.strictObject({ dauPct: z.number(), arpdauPct: z.number() })),
    caps: perKpi(z.number().positive()),
  }),
  wsjf: z.strictObject({
    jobSize: z.array(z.strictObject({ maxPoints: z.number(), size: z.number() })).min(1),
  }),
  verdict: z.strictObject({
    budgetNoGoFactor: z.number().min(1),
    minBaseRoi: z.number(),
    preliminaryWhenConfidence: z.array(z.enum(['low', 'medium', 'high'])),
  }),
});
export type AssessmentConfig = z.infer<typeof configSchema>;

export function loadAssessmentConfig(file = FEASIBILITY_RULES_FILE): AssessmentConfig {
  return configSchema.parse(parse(readFileSync(file, 'utf8')));
}
