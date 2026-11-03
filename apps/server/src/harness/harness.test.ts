import type { Questionnaire, RunEvent, RunState, StoredRunEvent } from '@ai-pm/shared';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { UsageLimitReached } from '../agents/runner.js';
import type { EventBus } from './events.js';
import { createOrchestrator, RunActionError, type StageHandlers } from './orchestrator.js';
import type { StageJob, StageQueue } from './queue.js';
import type { RunRecord, RunRepository } from './repository.js';
import { placeholderStages } from './stages/placeholder.js';
import { canTransition, stateAfterDecision } from './states.js';

describe('state machine', () => {
  it('allows the BPMN path and rejects shortcuts', () => {
    expect(canTransition('intake', 'awaiting_answers')).toBe(true);
    expect(canTransition('eliciting', 'awaiting_answers')).toBe(true); // follow-up round
    expect(canTransition('presenting', 'backlog')).toBe(true); // auto-approve
    expect(canTransition('intake', 'backlog')).toBe(false);
    expect(canTransition('analyzing', 'failed')).toBe(true);
    expect(canTransition('completed', 'failed')).toBe(false);
    expect(canTransition('failed', 'estimating')).toBe(true); // retry resumes
  });

  it('maps decisions to states', () => {
    expect(stateAfterDecision('approve')).toBe('backlog');
    expect(stateAfterDecision('changes')).toBe('analyzing');
    expect(stateAfterDecision('decline')).toBe('declined');
  });
});

/** In-memory stand-ins for Postgres, the advisory lock and pg-boss. */
function harness(handlers: StageHandlers, options: { lockFree?: () => boolean } = {}) {
  const runs = new Map<string, RunRecord>();
  const executions: { runId: string; stage: RunState; status: string }[] = [];
  const questionnaires: (Questionnaire & { runId: string; answers?: Record<string, string[]> })[] = [];
  const events: RunEvent[] = [];
  const jobs: { job: StageJob; delay: number }[] = [];
  let seq = 0;

  const repo = {
    async createRun({ title, description }: { title: string; description: string }) {
      const run: RunRecord = {
        id: `run-${++seq}`,
        state: 'intake',
        failedState: null,
        error: null,
        title,
        description,
        projectId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      runs.set(run.id, run);
      return run;
    },
    getRun: async (id: string) => (runs.has(id) ? { ...runs.get(id)! } : null),
    runIdsInStates: async (states: RunState[]) =>
      [...runs.values()].filter((r) => states.includes(r.state)).map((r) => ({ id: r.id, state: r.state })),
    async setState(id: string, state: RunState, extra: { failedState?: RunState; error?: string } = {}) {
      Object.assign(runs.get(id)!, {
        state,
        failedState: extra.failedState ?? null,
        error: extra.error ?? null,
      });
    },
    async startExecution(runId: string, stage: RunState) {
      executions.push({ runId, stage, status: 'running' });
      return {
        id: String(executions.length - 1),
        attempt: executions.filter((e) => e.stage === stage).length,
      };
    },
    async finishExecution(id: string, status: string) {
      executions[Number(id)]!.status = status;
    },
    failedAttempts: async (runId: string, stage: RunState) =>
      executions.filter((e) => e.runId === runId && e.stage === stage && e.status === 'failed').length,
    async resetFailures(runId: string, stage: RunState) {
      for (const e of executions)
        if (e.runId === runId && e.stage === stage && e.status === 'failed') e.status = 'reset';
    },
    markInterrupted: async () => undefined,
    baselineDigest: async () => null,
    async saveQuestionnaire(runId: string, round: number, questions: Questionnaire['questions']) {
      const q = { id: `q-${++seq}`, round, questions, runId };
      questionnaires.push(q);
      return q;
    },
    pendingQuestionnaire: async (runId: string) =>
      questionnaires.find((q) => q.runId === runId && !q.answers) ?? null,
    answeredQuestionnaires: async (runId: string) =>
      questionnaires
        .filter((q) => q.runId === runId && q.answers)
        .map((q) => ({ ...q, answers: q.answers! })),
    async saveAnswers(id: string, answers: Record<string, string[]>) {
      questionnaires.find((q) => q.id === id)!.answers = answers;
    },
    saveDecision: async () => undefined,
  } as unknown as RunRepository;

  const bus = {
    async publish(_runId: string, event: RunEvent) {
      events.push(event);
      return { id: events.length, createdAt: '', event } satisfies StoredRunEvent;
    },
    subscribe: () => () => undefined,
  } as unknown as EventBus;

  const queue: StageQueue = {
    start: async () => undefined,
    enqueue: async (job, delay = 0) => void jobs.push({ job, delay }),
    work: async () => undefined,
    stop: async () => undefined,
  };

  const client = {
    query: async (sql: string) => ({
      rows: [{ locked: sql.includes('try') ? (options.lockFree?.() ?? true) : true }],
    }),
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  const log = { info: () => undefined, error: () => undefined };

  const orchestrator = createOrchestrator({ repo, bus, queue, pool, handlers, log, retryDelaySeconds: 5 });
  /** Runs queued jobs like the worker would, until none are left. */
  async function drain() {
    for (let job = jobs.shift(); job; job = jobs.shift()) await orchestrator.executeStage(job.job);
  }
  return { orchestrator, runs, events, jobs, executions, drain };
}

describe('orchestrator', () => {
  it('walks a run from intake to completed with the placeholder stages', async () => {
    const h = harness(placeholderStages({ delayMs: 0, autoApprove: false }));
    const run = await h.orchestrator.createRun('Ghost race against a friend\nmore details');
    expect(run.title).toBe('Ghost race against a friend');

    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('awaiting_answers');
    const questionnaire = (
      h.events.find((e) => e.type === 'questionnaire') as { questionnaire: Questionnaire }
    ).questionnaire;

    await expect(
      h.orchestrator.submitAnswers(run.id, {
        questionnaireId: questionnaire.id,
        answers: { goal: ['retention'] },
      }),
    ).rejects.toThrow(RunActionError);
    await h.orchestrator.submitAnswers(run.id, {
      questionnaireId: questionnaire.id,
      answers: { goal: ['retention'], deadline: ['flexible'], platforms: ['ios', 'android'] },
    });
    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('awaiting_decision');

    await h.orchestrator.decide(run.id, { decision: 'approve' });
    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('completed');
    expect(h.events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state)).toEqual([
      'intake',
      'awaiting_answers',
      'eliciting',
      'analyzing',
      'estimating',
      'documenting',
      'presenting',
      'awaiting_decision',
      'backlog',
      'completed',
    ]);
  });

  it('retries a failing stage with backoff, then fails the run; a manual retry starts afresh', async () => {
    let calls = 0;
    const h = harness({
      intake: async () => {
        calls++;
        throw new Error('Jira is down');
      },
    });
    const run = await h.orchestrator.createRun('A feature that will fail');
    await h.orchestrator.executeStage(h.jobs.shift()!.job);
    expect(h.jobs[0]).toMatchObject({ delay: 5 });
    await h.drain();
    expect(calls).toBe(3);
    expect(h.runs.get(run.id)).toMatchObject({
      state: 'failed',
      failedState: 'intake',
      error: 'Jira is down',
    });

    await h.orchestrator.retry(run.id);
    expect(h.runs.get(run.id)!.state).toBe('intake');
    expect(h.jobs).toHaveLength(1);
  });

  it('pauses on a usage limit and resumes later without counting a failure', async () => {
    const h = harness({
      intake: async () => {
        throw new UsageLimitReached('Claude AI usage limit reached', null);
      },
    });
    const run = await h.orchestrator.createRun('A feature during a busy hour');
    await h.orchestrator.executeStage(h.jobs.shift()!.job);

    expect(h.runs.get(run.id)!.state).toBe('intake');
    expect(h.jobs).toEqual([{ job: { runId: run.id, state: 'intake' }, delay: 900 }]);
    expect(h.executions.map((e) => e.status)).toEqual(['paused']);
  });

  it('ignores stale jobs and jobs for a run another worker holds', async () => {
    let free = true;
    const h = harness(placeholderStages({ delayMs: 0, autoApprove: true }), { lockFree: () => free });
    const run = await h.orchestrator.createRun('Duplicate jobs');
    await h.orchestrator.executeStage({ runId: run.id, state: 'analyzing' }); // stale
    expect(h.executions).toHaveLength(0);

    free = false;
    await h.orchestrator.executeStage({ runId: run.id, state: 'intake' }); // locked elsewhere
    expect(h.executions).toHaveLength(0);
    await expect(h.orchestrator.retry(run.id)).rejects.toMatchObject({ status: 409 });
  });
});
