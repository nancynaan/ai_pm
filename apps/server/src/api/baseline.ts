import type { BaselineSummary } from '@ai-pm/shared';
import type { FastifyInstance } from 'fastify';

export function registerBaselineRoutes(app: FastifyInstance, read: () => Promise<BaselineSummary>) {
  app.get('/api/baseline', async () => read());
}
