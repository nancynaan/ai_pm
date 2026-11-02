import { z } from 'zod';

/** `not_configured` means the credentials for that dependency are not in `.env` yet. */
export const checkStatusSchema = z.enum(['ok', 'error', 'not_configured']);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const healthCheckSchema = z.object({
  name: z.string(),
  label: z.string(),
  status: checkStatusSchema,
  detail: z.string(),
  latencyMs: z.number().int().nonnegative(),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const overallStatusSchema = z.enum(['ok', 'degraded', 'error']);
export type OverallStatus = z.infer<typeof overallStatusSchema>;

export const healthReportSchema = z.object({
  status: overallStatusSchema,
  version: z.string(),
  checkedAt: z.string(),
  checks: z.array(healthCheckSchema),
});
export type HealthReport = z.infer<typeof healthReportSchema>;

/** Any error makes the whole report an error; missing configuration only degrades it. */
export function overallStatus(checks: readonly Pick<HealthCheck, 'status'>[]): OverallStatus {
  if (checks.some((c) => c.status === 'error')) return 'error';
  if (checks.some((c) => c.status === 'not_configured')) return 'degraded';
  return 'ok';
}
