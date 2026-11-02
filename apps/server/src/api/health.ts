import { type HealthReport, overallStatus } from '@ai-pm/shared';
import type { FastifyInstance } from 'fastify';
import { type HealthProbe, runProbe } from '../health/probe.js';

export interface HealthRouteOptions {
  probes: HealthProbe[];
  version: string;
  timeoutMs?: number;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  { probes, version, timeoutMs = 10_000 }: HealthRouteOptions,
) {
  // Liveness for the container healthcheck: the process is up, nothing external is called.
  app.get('/api/health/live', async () => ({ status: 'ok' }));

  app.get('/api/health', async (_request, reply) => {
    const checks = await Promise.all(probes.map((probe) => runProbe(probe, timeoutMs)));
    const report: HealthReport = {
      status: overallStatus(checks),
      version,
      checkedAt: new Date().toISOString(),
      checks,
    };
    return reply.code(report.status === 'error' ? 503 : 200).send(report);
  });
}
