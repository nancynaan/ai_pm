import { type Answers, type Decision, NOT_SURE, type RunEvent, type RunState } from '@ai-pm/shared';
import type pg from 'pg';
import { UsageLimitReached } from '../agents/runner.js';
import type { EventBus } from './events.js';
import type { StageQueue, StageJob } from './queue.js';
import type { RunRecord, RunRepository } from './repository.js';
import { ACTIVE_STATES, assertTransition, isActive, stateAfterDecision } from './states.js';

export interface StageContext {
  run: RunRecord;
  repo: RunRepository;
  baselineDigest: string | null;
  emit: (event: RunEvent) => Promise<void>;
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

export interface OrchestratorOptions {
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
export function createOrchestrator(opts: OrchestratorOptions) {
  const { repo, bus, queue, pool, handlers, log } = opts;
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryDelaySeconds = opts.retryDelaySeconds ?? 10;
  const limitPauseSeconds = opts.limitPauseSeconds ?? 15 * 60;

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
      const emit = async (event: RunEvent) => void (await bus.publish(run.id, event));
      await emit({ type: 'stage', stage, status: 'started' });
      log.info({ runId: run.id, stage, attempt: execution.attempt }, 'stage started');

      try {
        const baselineDigest = await repo.baselineDigest(run.projectId);
        const outcome = await handler({ run, repo, baselineDigest, emit });
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
    // Another worker holds the run; it will move the run on itself.
    if (!result.locked) log.info({ runId: job.runId, state: job.state }, 'run busy, job skipped');
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
        const lines: string[] = [];
        for (const question of questionnaire.questions) {
          const values = submission.answers[question.id];
          if (!values?.length) throw new RunActionError(`Please answer: ${question.text}`, 400);
          if (question.kind === 'single' && values.length !== 1) {
            throw new RunActionError(`Choose one answer for: ${question.text}`, 400);
          }
          const labels = values.map((value) => {
            const option = question.options.find((o) => o.value === value);
            if (!option) throw new RunActionError(`Unknown answer "${value}" for: ${question.text}`, 400);
            return option.label;
          });
          lines.push(`- ${question.text} **${labels.join(', ')}**`);
        }
        const notSure = Object.values(submission.answers).filter((v) => v.includes(NOT_SURE)).length;
        await repo.saveAnswers(questionnaire.id, submission.answers);
        await bus.publish(run.id, {
          type: 'message',
          role: 'client',
          text: `My answers:\n${lines.join('\n')}${notSure ? `\n\n(${notSure} × "not sure")` : ''}`,
        });
        await moveTo(run, 'eliciting');
      });
    },

    async decide(runId: string, { decision, comment }: Decision) {
      return act(runId, async (run) => {
        if (run.state !== 'awaiting_decision')
          throw new RunActionError(`The run is ${run.state}, not waiting for a decision`, 409);
        await repo.saveDecision(run.id, decision, comment);
        const label = { approve: 'Approve', changes: 'Request changes', decline: 'Decline' }[decision];
        await bus.publish(run.id, {
          type: 'message',
          role: 'client',
          text: comment ? `${label}: ${comment}` : label,
        });
        await moveTo(run, stateAfterDecision(decision));
      });
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

export type Orchestrator = ReturnType<typeof createOrchestrator>;
