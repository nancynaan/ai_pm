import type { Answers, Decision, DiscoveryConfirmation, RunEvent, RunState } from '@ai-pm/shared';
import type pg from 'pg';
import { UsageLimitReached } from '../agents/runner.js';
import { InvalidSubmission, validateSubmission } from './discovery.js';
import type { EventBus } from './events.js';
import type { StageQueue, StageJob } from './queue.js';
import type { Publishing } from './publishing.js';
import type { RunRecord, RunRepository } from './repository.js';
import { ACTIVE_STATES, assertTransition, isActive, stateAfterDecision } from './stages.js';

export interface StageContext {
  run: RunRecord;
  /** The stage attempt; Claude calls are recorded against it. */
  executionId: string;
  repo: RunRepository;
  baselineDigest: string | null;
  /** `key` marks a step's block: emitting it again rewrites the earlier one in place. */
  emit: (event: RunEvent, key?: string) => Promise<void>;
}

export interface StageOutcome {
  next: RunState;
  output?: unknown;
}

export type StageHandler = (ctx: StageContext) => Promise<StageOutcome>;
export type StageHandlers = Partial<Record<RunState, StageHandler>>;

/** Raised by client actions; the API maps them to 404, 409 and 400. */
export class RunActionError extends Error {
  override name = 'RunActionError';
  constructor(
    message: string,
    readonly status: 404 | 409 | 400,
  ) {
    super(message);
  }
}

export interface PipelineEngineOptions {
  repo: RunRepository;
  bus: EventBus;
  queue: StageQueue;
  /** Used for per-run advisory locks, so a run never executes two stages at once. */
  pool: pg.Pool;
  handlers: StageHandlers;
  log: { info(obj: object, msg: string): void; error(obj: object, msg: string): void };
  maxAttempts?: number;
  retryDelaySeconds?: number;
  /** Fallback pause when Claude's usage limit gives no reset time. */
  limitPauseSeconds?: number;
  /**
   * After the client's decision is saved: records it outside the pipeline (Decision Log in
   * Confluence, closing a declined Epic). Its message goes to the chat; a failure only logs.
   */
  onDecision?: (run: RunRecord, decision: Decision['decision']) => Promise<string | null>;
  /**
   * The client's optional "Publish to Confluence" actions (documents, then the deck); they run
   * outside the stage flow and never move the run. Absent: publishing is refused.
   */
  publishing?: Pick<Publishing, 'documents' | 'presentation'>;
  /**
   * Where the run's documents stand. Generating is offered once; Approve needs them published
   * (the client may skip them earlier, but not approve without them).
   */
  documentsStatus?: (runId: string) => Promise<{ generated: boolean; published: boolean }>;
}

const titleOf = (description: string) => {
  const firstLine = description.split(/\r?\n/)[0]!.trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
};

/**
 * Runs the pipeline. Each active state is one durable job; the job worker executes the stage's
 * handler, records the attempt, and moves the run on. Client actions (answers, decision, retry)
 * move runs out of waiting states. Every change is published as a run event.
 */
export function createPipelineEngine(opts: PipelineEngineOptions) {
  const { repo, bus, queue, pool, handlers, log } = opts;
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryDelaySeconds = opts.retryDelaySeconds ?? 10;
  const limitPauseSeconds = opts.limitPauseSeconds ?? 15 * 60;
  const busyRetrySeconds = 2;

  /** Session-level advisory lock: released automatically if the process dies. */
  async function withRunLock<T>(
    runId: string,
    fn: () => Promise<T>,
  ): Promise<{ locked: boolean; value?: T }> {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)) as locked',
        [runId],
      );
      if (!rows[0]?.locked) return { locked: false };
      try {
        return { locked: true, value: await fn() };
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [runId]);
      }
    } finally {
      client.release();
    }
  }

  async function moveTo(run: RunRecord, next: RunState, extra?: { failedState?: RunState; error?: string }) {
    assertTransition(run.state, next);
    await repo.setState(run.id, next, extra);
    await bus.publish(run.id, { type: 'state', state: next });
    if (isActive(next)) await queue.enqueue({ runId: run.id, state: next });
  }

  async function executeStage(job: StageJob) {
    const result = await withRunLock(job.runId, async () => {
      const run = await repo.getRun(job.runId);
      // A duplicate or stale job (the run already moved on) is a no-op.
      if (!run || run.state !== job.state || !isActive(run.state)) return;
      const handler = handlers[run.state];
      if (!handler) throw new Error(`No stage handler for ${run.state}`);

      const stage = run.state;
      const execution = await repo.startExecution(run.id, stage);
      const emit = async (event: RunEvent, key?: string) => void (await bus.publish(run.id, event, key));
      await emit({ type: 'stage', stage, status: 'started' });
      log.info({ runId: run.id, stage, attempt: execution.attempt }, 'stage started');

      try {
        const baselineDigest = await repo.baselineDigest(run.projectId);
        const outcome = await handler({ run, executionId: execution.id, repo, baselineDigest, emit });
        assertTransition(stage, outcome.next);
        await repo.finishExecution(execution.id, 'succeeded', { output: outcome.output });
        await emit({ type: 'stage', stage, status: 'completed' });
        await moveTo(run, outcome.next);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof UsageLimitReached) {
          const seconds = err.resumeAt
            ? Math.max(60, Math.ceil((err.resumeAt.getTime() - Date.now()) / 1000) + 30)
            : limitPauseSeconds;
          await repo.finishExecution(execution.id, 'paused', { error: message });
          const resume = new Date(Date.now() + seconds * 1000).toISOString();
          await emit({
            type: 'stage',
            stage,
            status: 'paused',
            detail: `Claude usage limit reached; continuing at ${resume}`,
          });
          await queue.enqueue({ runId: run.id, state: stage }, seconds);
          return;
        }
        log.error({ runId: run.id, stage, err: message }, 'stage failed');
        await repo.finishExecution(execution.id, 'failed', { error: message });
        const failures = await repo.failedAttempts(run.id, stage);
        if (failures < maxAttempts) {
          const delay = retryDelaySeconds * failures;
          await emit({
            type: 'stage',
            stage,
            status: 'retrying',
            detail: `${message} (attempt ${failures + 1} of ${maxAttempts} in ${delay} s)`,
          });
          await queue.enqueue({ runId: run.id, state: stage }, delay);
        } else {
          await emit({ type: 'stage', stage, status: 'failed', detail: message });
          await moveTo(run, 'failed', { failedState: stage, error: message });
        }
      }
    });
    // The lock is held: by another worker on this stage, or by the action or stage that just
    // enqueued this job and has not released the lock yet. Try again shortly; once the run has
    // moved on, the job is stale and does nothing. (Skipping it could leave the run stuck.)
    if (!result.locked) {
      log.info({ runId: job.runId, state: job.state }, 'run busy, job retried shortly');
      await queue.enqueue(job, busyRetrySeconds);
    }
  }

  /** Client actions run under the same lock, so a double click cannot apply twice. */
  async function act<T>(runId: string, fn: (run: RunRecord) => Promise<T>): Promise<T> {
    const result = await withRunLock(runId, async () => {
      const run = await repo.getRun(runId);
      if (!run) throw new RunActionError('Run not found', 404);
      return fn(run);
    });
    if (!result.locked) throw new RunActionError('The run is busy; try again in a moment', 409);
    return result.value as T;
  }

  return {
    executeStage,

    /** Recovers after a restart: cut-off attempts are marked, and every active run gets its job again. */
    async start() {
      await queue.start();
      await repo.markInterrupted();
      const active = await repo.runIdsInStates(ACTIVE_STATES);
      for (const run of active) await queue.enqueue({ runId: run.id, state: run.state });
      await queue.work(executeStage);
      log.info({ resumed: active.length }, 'pipeline worker started');
    },

    async stop() {
      await queue.stop();
    },

    async createRun(description: string): Promise<RunRecord> {
      const run = await repo.createRun({ title: titleOf(description), description });
      await bus.publish(run.id, { type: 'message', role: 'client', text: description });
      await bus.publish(run.id, { type: 'state', state: 'intake' });
      await queue.enqueue({ runId: run.id, state: 'intake' });
      return run;
    },

    async submitAnswers(runId: string, submission: Answers) {
      return act(runId, async (run) => {
        if (run.state !== 'awaiting_answers')
          throw new RunActionError(`The run is ${run.state}, not waiting for answers`, 409);
        const questionnaire = await repo.pendingQuestionnaire(run.id);
        if (!questionnaire || questionnaire.id !== submission.questionnaireId) {
          throw new RunActionError('This questionnaire is no longer open', 409);
        }
        let checked: ReturnType<typeof validateSubmission>;
        try {
          checked = validateSubmission(questionnaire, submission);
        } catch (err) {
          if (err instanceof InvalidSubmission) throw new RunActionError(err.message, 400);
          throw err;
        }
        const comment = questionnaire.allowComment ? submission.comment?.trim() || null : null;
        await repo.saveAnswers(questionnaire.id, checked.answers, { details: checked.details, comment });
        await bus.publish(run.id, {
          type: 'message',
          role: 'client',
          text: `My answers:\n${checked.lines.join('\n')}${comment ? `\n\nAdditional comments: ${comment}` : ''}`,
        });
        await moveTo(run, 'eliciting');
      });
    },

    /** After the last clarification round: go on with a preliminary assessment, or stop. */
    async confirmDiscovery(runId: string, { proceed, comment }: DiscoveryConfirmation) {
      return act(runId, async (run) => {
        if (run.state !== 'awaiting_confirmation')
          throw new RunActionError(`The run is ${run.state}, not waiting for a discovery decision`, 409);
        await repo.saveDecision(run.id, proceed ? 'proceed' : 'stop', comment, 'discovery');
        const label = proceed
          ? 'Continue with a preliminary assessment based on the documented assumptions'
          : 'Stop here; I will come back with more information';
        await bus.publish(run.id, {
          type: 'message',
          role: 'client',
          text: comment ? `${label}. ${comment}` : label,
        });
        await moveTo(run, proceed ? 'analyzing' : 'declined');
      });
    },

    async decide(runId: string, { decision, comment }: Decision) {
      const decided = await act(runId, async (run) => {
        if (run.state !== 'awaiting_decision')
          throw new RunActionError(`The run is ${run.state}, not waiting for a decision`, 409);
        // Approve needs the documents in Confluence; the client is told what is missing.
        const docs = decision === 'approve' ? await opts.documentsStatus?.(run.id) : undefined;
        if (docs && !docs.published) {
          const text = docs.generated
            ? 'Please publish the documents to Confluence before you approve the feature: press Publish to Confluence on the Documents card (also on the Documents tab). Approve unlocks once they are published.'
            : 'Please generate and publish the documents before you approve the feature: press Generate documents, then Publish to Confluence on the Documents card (also on the Documents tab). Approve unlocks once they are published.';
          await bus.publish(run.id, { type: 'message', role: 'ai', text }, 'decision.blocked');
          throw new RunActionError(text, 409);
        }
        await repo.saveDecision(run.id, decision, comment);
        const label = { approve: 'Approve', decline: 'Decline' }[decision];
        await bus.publish(
          run.id,
          { type: 'message', role: 'client', text: comment ? `${label}: ${comment}` : label },
          'decision.response',
        );
        await moveTo(run, stateAfterDecision(decision));
        return run;
      });
      // Outside the run lock: a slow Confluence write never blocks the client's click.
      if (opts.onDecision) {
        void opts
          .onDecision(decided, decision)
          .then((text) =>
            text ? bus.publish(runId, { type: 'message', role: 'ai', text }, 'decision.recorded') : undefined,
          )
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            log.error({ runId, err: message }, 'recording the decision failed');
            return bus.publish(
              runId,
              {
                type: 'message',
                role: 'ai',
                text: `The decision is saved, but I could not record it in Confluence: ${message}`,
              },
              'decision.recorded',
            );
          });
      }
    },

    /**
     * The client's "Generate documents" button after the assessment. The documents stage runs
     * as a normal job, then the run goes on to the presentation; publishing is separate.
     */
    async generateDocuments(runId: string) {
      return act(runId, async (run) => {
        // At the documents step, or later at the decision when the client skipped them (Approve
        // needs them). Generated once: there is no re-generation.
        const late = run.state === 'awaiting_decision';
        if (run.state !== 'awaiting_documents' && !late)
          throw new RunActionError(`The run is ${run.state}; the documents can be generated at the documents step or before the decision`, 409);
        if ((await opts.documentsStatus?.(run.id))?.generated)
          throw new RunActionError('The documents are already generated', 409);
        // A late request goes to the end of the chat, and the Documents card moves under it.
        await bus.publish(
          run.id,
          { type: 'message', role: 'client', text: 'Generate the documents' },
          late ? 'documents.request.late' : 'documents.request',
        );
        await repo.resetFailures(run.id, 'documenting');
        await moveTo(run, 'documenting');
      });
    },

    /**
     * "Skip for now", for any verdict: straight to the presentation. Approve still needs the
     * documents generated and published later.
     */
    async skipDocuments(runId: string) {
      return act(runId, async (run) => {
        if (run.state !== 'awaiting_documents')
          throw new RunActionError(`The run is ${run.state}, not waiting for the documents`, 409);
        await bus.publish(
          run.id,
          { type: 'message', role: 'client', text: 'Skip the documents for now' },
          'documents.request',
        );
        await moveTo(run, 'presenting');
      });
    },

    /** The Documents card's "Publish to Confluence": once, at any time after generating. */
    async publishDocuments(runId: string) {
      const run = await repo.getRun(runId);
      if (!run) throw new RunActionError('Run not found', 404);
      if (!opts.publishing) throw new RunActionError('Publishing to Confluence is not configured', 409);
      const outcome = await opts.publishing.documents(run);
      await bus.publish(
        runId,
        { type: 'documents', published: outcome.published, mode: outcome.mode },
        'documents.status',
      );
      await bus.publish(runId, { type: 'message', role: 'ai', text: outcome.text }, 'documents.published');
    },

    /** The Proposal card's "Publish to Confluence": once, after the documents are published. */
    async publishPresentation(runId: string) {
      const run = await repo.getRun(runId);
      if (!run) throw new RunActionError('Run not found', 404);
      if (!opts.publishing) throw new RunActionError('Publishing to Confluence is not configured', 409);
      const outcome = await opts.publishing.presentation(run);
      // The cards reload on a documents event; the Proposal card shows the link.
      await bus.publish(
        runId,
        { type: 'documents', published: outcome.published, mode: outcome.mode },
        'presentation.status',
      );
      await bus.publish(runId, { type: 'message', role: 'ai', text: outcome.text }, 'presentation.published');
    },

    async retry(runId: string) {
      return act(runId, async (run) => {
        if (run.state !== 'failed' || !run.failedState)
          throw new RunActionError('Only a failed run can be retried', 409);
        await repo.resetFailures(run.id, run.failedState);
        await moveTo(run, run.failedState);
      });
    },
  };
}

export type PipelineEngine = ReturnType<typeof createPipelineEngine>;
