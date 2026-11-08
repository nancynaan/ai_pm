import {
  answersSchema,
  type Backlog,
  DOCUMENT_LABEL,
  DOCUMENT_TYPES,
  type DocumentSet,
  type Presentation,
  documentTypeSchema,
  createRunSchema,
  decisionSchema,
  discoveryConfirmationSchema,
  type StoredRunEvent,
} from '@ai-pm/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AnalysisRepository } from '../pipeline-engine/analysis-repository.js';
import type { BacklogRepository } from '../pipeline-engine/backlog/repository.js';
import { needsRoadmapProposal } from '../pipeline-engine/calculators/baseline.js';
import type { DocumentRepository } from '../pipeline-engine/documents/repository.js';
import type { PresentationRepository } from '../pipeline-engine/presentation/repository.js';
import { PPTX_TYPE } from '../pipeline-engine/stages/presenting.js';
import { deckFileName, deckToPptx } from '../render/pptx.js';
import type { EventBus } from '../pipeline-engine/events.js';
import { type PipelineEngine, RunActionError } from '../pipeline-engine/engine.js';
import type { RunRepository } from '../pipeline-engine/repository.js';

export interface RunRouteDeps {
  pipelineEngine: PipelineEngine;
  repo: RunRepository;
  bus: EventBus;
  /** Feature assessments for the Analysis tab. */
  assessments?: Pick<AnalysisRepository, 'assessmentOf' | 'listAssessments'>;
  /** The PM documents (stage 04) and the current Confluence write mode. */
  documents?: { repo: Pick<DocumentRepository, 'setOf' | 'documentsOf'>; mode: 'dry-run' | 'live' };
  /** The client deck (stage 05). */
  presentations?: Pick<PresentationRepository, 'get'>;
  /** The approved feature's Epic and stories in Jira (stage 06). */
  backlog?: Pick<BacklogRepository, 'backlogOf'>;
}

const docParams = z.object({ id: z.uuid(), type: documentTypeSchema });

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
  // The pipeline engine is looked up per request: it is created after the routes are registered.
  const { repo, bus } = deps;
  app.post('/api/runs', async (request, reply) =>
    handle(reply, async () => {
      const { description } = createRunSchema.parse(request.body);
      const run = await deps.pipelineEngine.createRun(description);
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

  app.get('/api/assessments', async () => (deps.assessments ? deps.assessments.listAssessments() : []));

  app.get('/api/runs/:id/assessment', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      const assessment = await deps.assessments?.assessmentOf(id);
      if (!assessment) throw new RunActionError('This run has no assessment yet', 404);
      return assessment;
    }),
  );

  /** The Documents card: one row per document, with its Confluence link once published. */
  app.get('/api/runs/:id/documents', async (request, reply) =>
    handle(reply, async (): Promise<DocumentSet> => {
      const { id } = idParams.parse(request.params);
      const run = await repo.getRun(id);
      if (!run) throw new RunActionError('Run not found', 404);
      const [set, rows, assessment] = await Promise.all([
        deps.documents?.repo.setOf(id) ?? null,
        deps.documents?.repo.documentsOf(id) ?? [],
        deps.assessments?.assessmentOf(id) ?? null,
      ]);
      const roadmapNeeded = assessment ? needsRoadmapProposal(assessment.roadmapImpact) : true;
      return {
        runId: id,
        faNumber: set?.faNumber ?? null,
        mode: deps.documents?.mode ?? 'dry-run',
        publishedAt: set?.publishedAt?.toISOString() ?? null,
        canPublish: run.state === 'awaiting_documents' || run.state === 'awaiting_decision',
        // After the decision the documents are final; the backlog stage keeps them in step.
        lockedReason:
          run.state === 'completed' || run.state === 'backlog'
            ? "You can't publish again: the feature is already approved, and its documents were published successfully."
            : run.state === 'declined'
              ? "You can't publish again: the feature was declined, and its documents record that decision."
              : null,
        running: run.state === 'documenting',
        documents: DOCUMENT_TYPES.map((type) => {
          const row = rows.find((r) => r.type === type);
          if (row)
            return {
              type,
              title: row.title,
              status: row.status,
              url: row.url,
              version: row.confluenceVersion,
              note: row.note,
              preview: row.markdown.length > 0,
            };
          const notNeeded = type === 'roadmap_proposal' && !roadmapNeeded;
          return {
            type,
            title: DOCUMENT_LABEL[type],
            status: notNeeded ? 'not_needed' : 'pending',
            url: null,
            version: null,
            note: notNeeded ? 'The feature does not change roadmap commitments' : null,
            preview: false,
          };
        }),
      };
    }),
  );

  app.get('/api/runs/:id/documents/:type', async (request, reply) =>
    handle(reply, async () => {
      const { id, type } = docParams.parse(request.params);
      const row = (await deps.documents?.repo.documentsOf(id))?.find((r) => r.type === type);
      if (!row?.markdown) throw new RunActionError('This document has not been generated yet', 404);
      return { type, title: row.title, markdown: row.markdown };
    }),
  );

  app.post('/api/runs/:id/documents', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.pipelineEngine.publishDocuments(id);
      return { ok: true };
    }),
  );

  /** The Backlog tab: the Epic and its stories, once an approved feature's backlog is written. */
  app.get('/api/runs/:id/backlog', async (request, reply) =>
    handle(reply, async (): Promise<Backlog> => {
      const { id } = idParams.parse(request.params);
      // Written only after the client approved, so a backlog means an approved feature.
      const backlog = await deps.backlog?.backlogOf(id);
      if (!backlog?.epic) throw new RunActionError('This feature has no backlog in Jira yet', 404);
      return backlog;
    }),
  );

  /** The Run log on the System status page: stage attempts and Claude calls (numbers only). */
  app.get('/api/runs/:id/log', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      if (!(await repo.getRun(id))) throw new RunActionError('Run not found', 404);
      return repo.runLog(id);
    }),
  );

  /** The slide viewer: the deck and where its PPTX is attached. */
  app.get('/api/runs/:id/presentation', async (request, reply) =>
    handle(reply, async (): Promise<Presentation> => {
      const { id } = idParams.parse(request.params);
      const stored = await deps.presentations?.get(id);
      if (!stored) throw new RunActionError('This run has no presentation yet', 404);
      const set = await deps.documents?.repo.setOf(id);
      return {
        deck: stored.deck,
        attachment: stored.attachmentStatus
          ? {
              status: stored.attachmentStatus,
              url: stored.attachmentUrl,
              fileName: deckFileName(stored.deck, set?.faNumber ?? null),
            }
          : null,
      };
    }),
  );

  app.get('/api/runs/:id/presentation.pptx', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      const stored = await deps.presentations?.get(id);
      if (!stored) throw new RunActionError('This run has no presentation yet', 404);
      const set = await deps.documents?.repo.setOf(id);
      const file = await deckToPptx(stored.deck);
      return reply
        .header('Content-Type', PPTX_TYPE)
        .header(
          'Content-Disposition',
          `attachment; filename="${deckFileName(stored.deck, set?.faNumber ?? null)}"`,
        )
        .send(file);
    }),
  );

  app.post('/api/runs/:id/answers', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.pipelineEngine.submitAnswers(id, answersSchema.parse(request.body));
      return { ok: true };
    }),
  );

  app.post('/api/runs/:id/discovery-decision', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.pipelineEngine.confirmDiscovery(id, discoveryConfirmationSchema.parse(request.body));
      return { ok: true };
    }),
  );

  app.post('/api/runs/:id/decision', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.pipelineEngine.decide(id, decisionSchema.parse(request.body));
      return { ok: true };
    }),
  );

  app.post('/api/runs/:id/retry', async (request, reply) =>
    handle(reply, async () => {
      const { id } = idParams.parse(request.params);
      await deps.pipelineEngine.retry(id);
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
      // A replaced block keeps its old id; send it anyway so the chat updates it in place.
      if (event.id <= sentUpTo && !event.replaced) return;
      res.write(`id: ${event.id}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`);
      sentUpTo = Math.max(sentUpTo, event.id);
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
