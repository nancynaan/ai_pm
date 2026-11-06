import type { BaselineSummary } from '@ai-pm/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerBaselineRoutes } from './api/baseline.js';
import { registerHealthRoutes } from './api/health.js';
import { type RunRouteDeps, registerRunRoutes } from './api/runs.js';
import type { HealthProbe } from './health/probe.js';

export interface AppOptions {
  logger: FastifyServerOptions['logger'];
  probes: HealthProbe[];
  version: string;
  /** Reads the project baseline from the database. */
  baseline?: () => Promise<BaselineSummary>;
  /** The pipeline: the pipeline engine, run repository and event bus. */
  runs?: RunRouteDeps;
  /** Built web UI to serve; omitted in dev, where Vite serves the UI. */
  webDistDir?: string;
}

export async function buildApp({
  logger,
  probes,
  version,
  baseline,
  runs,
  webDistDir,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });

  registerHealthRoutes(app, { probes, version });
  if (baseline) registerBaselineRoutes(app, baseline);
  if (runs) registerRunRoutes(app, runs);

  if (webDistDir) {
    await app.register(fastifyStatic, { root: webDistDir, wildcard: false });
    // Client-side routes fall back to the SPA; unknown API paths stay 404.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
