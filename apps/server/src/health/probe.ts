import type { CheckStatus, HealthCheck } from '@ai-pm/shared';

export interface ProbeResult {
  status: CheckStatus;
  detail: string;
}

export interface HealthProbe {
  name: string;
  label: string;
  run: () => Promise<ProbeResult>;
}

export const ok = (detail: string): ProbeResult => ({ status: 'ok', detail });
export const notConfigured = (detail: string): ProbeResult => ({ status: 'not_configured', detail });
export const failed = (detail: string): ProbeResult => ({ status: 'error', detail });

/** Runs one probe; a thrown error or a timeout becomes an `error` result instead of failing the report. */
export async function runProbe(probe: HealthProbe, timeoutMs: number): Promise<HealthCheck> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  let result: ProbeResult;
  try {
    result = await Promise.race([probe.run(), timeout]);
  } catch (err) {
    result = failed(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
  return {
    name: probe.name,
    label: probe.label,
    ...result,
    latencyMs: Math.round(performance.now() - started),
  };
}
