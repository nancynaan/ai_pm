import {
  answersSchema,
  createRunSchema,
  decisionSchema,
  discoveryConfirmationSchema,
  type StoredRunEvent,
} from '@ai-pm/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { EventBus } from '../harness/events.js';
import { type Orchestrator, RunActionError } from '../harness/orchestrator.js';
import type { RunRepository } from '../harness/repository.js';

export interface RunRouteDeps {
  orchestrator: Orchestrator;
  repo: RunRepository;
  bus: EventBus;
}

const idParams = z.object({ id: z.uuid() });

async function handle<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RunActionError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: z.prettifyError(err) });
    throw err;
  }
}

export function registerRunRoutes(app: FastifyInstance, deps: RunRouteDeps) {
  // The orchestrator is looked up per request: it is created after the routes are registered.
  const { repo, bus } = deps;
  app.post('/api/runs', async (request, reply) =>
    handle(reply, async () => {
      const { description } = createRunSchema.parse(request.body);
      const run = await deps.orchestrator.createRun(description);
      return reply.code(201).send({ runId: run.id });
    }),
  );

  app.get('/api/runs', async () => {
    const runs = await repo.listRuns();
    return Promise.all(runs.map((run) => repo.summary(run)));
  });

  app.get('/api/runs/:id', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      const run = await repo.getRun(id);
      if (!run) throw new RunActionError('Run not found', 404);
      return repo.summary(run);
    }),
  );

  app.post('/api/runs/:id/answers', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.orchestrator.submitAnswers(id, answersSchema.parse(request.body));
      return { ok: true };
    }),
  );

  app.post('/api/runs/:id/discovery-decision', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.orchestrator.confirmDiscovery(id, discoveryConfirmationSchema.parse(request.body));
      return { ok: true };
    }),
  );

  app.post('/api/runs/:id/decision', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.orchestrator.decide(id, decisionSchema.parse(request.body));
      return { ok: true };
    }),
  );

  app.post('/api/runs/:id/retry', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.orchestrator.retry(id);
      return { ok: true };
    }),
  );

  /**
   * Server-sent events: the run's history first (after Last-Event-ID, which browsers send on
   * reconnect), then live events. Subscribing before reading the history means nothing is missed.
   */
  app.get('/api/runs/:id/events', async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid run id' });
    const { id } = parsed.data;
    if (!(await repo.getRun(id))) return reply.code(404).send({ error: 'Run not found' });

    const lastEventId = Number(request.headers['last-event-id']) || 0;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let sentUpTo = lastEventId;
    let replaying = true;
    const buffered: StoredRunEvent[] = [];
    const send = (event: StoredRunEvent) => {
      if (event.id <= sentUpTo) return;
      res.write(`id: ${event.id}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`);
      sentUpTo = event.id;
    };
    const unsubscribe = bus.subscribe(id, (event) => (replaying ? buffered.push(event) : send(event)));
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    for (const event of await repo.listEvents(id, lastEventId)) send(event);
    replaying = false;
    for (const event of buffered) send(event);
  });
}
