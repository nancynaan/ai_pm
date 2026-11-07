import type { Questionnaire, RunEvent, RunState, StoredRunEvent } from '@ai-pm/shared';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { UsageLimitReached } from '../agents/runner.js';
import type { EventBus } from './events.js';
import { createPipelineEngine, RunActionError, type StageHandlers } from './engine.js';
import type { StageJob, StageQueue } from './queue.js';
import type { RunRecord, RunRepository } from './repository.js';
import { placeholderStages } from './stages/placeholder.js';
import { canTransition, stateAfterDecision } from './stages.js';

describe('state machine', () => {
  it('allows the BPMN path and rejects shortcuts', () => {
    expect(canTransition('intake', 'awaiting_answers')).toBe(true);
    expect(canTransition('eliciting', 'awaiting_answers')).toBe(true); // clarification round
    expect(canTransition('eliciting', 'awaiting_confirmation')).toBe(true); // still blocked after the last round
    expect(canTransition('awaiting_confirmation', 'estimating')).toBe(false);
    expect(canTransition('presenting', 'backlog')).toBe(true); // auto-approve
    expect(canTransition('intake', 'backlog')).toBe(false);
    expect(canTransition('analyzing', 'failed')).toBe(true);
    expect(canTransition('completed', 'failed')).toBe(false);
    expect(canTransition('failed', 'estimating')).toBe(true); // retry resumes
  });

  it('maps decisions to states', () => {
    expect(stateAfterDecision('approve')).toBe('backlog');
    expect(stateAfterDecision('decline')).toBe('declined');
  });
});

/** In-memory stand-ins for Postgres, the advisory lock and pg-boss. */
function setupEngine(
  handlers: StageHandlers,
  options: {
    lockFree?: () => boolean;
    onDecision?: (run: RunRecord, decision: 'approve' | 'decline') => Promise<string | null>;
  } = {},
) {
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
    latestStageOutput: async () => null,
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

  const pipelineEngine = createPipelineEngine({
    repo,
    bus,
    queue,
    pool,
    handlers,
    log,
    retryDelaySeconds: 5,
    ...(options.onDecision ? { onDecision: options.onDecision } : {}),
  });
  /** Runs queued jobs like the worker would, until none are left. */
  async function drain() {
    for (let job = jobs.shift(); job; job = jobs.shift()) await pipelineEngine.executeStage(job.job);
  }
  return { pipelineEngine, runs, events, jobs, executions, drain };
}

describe('pipeline engine', () => {
  it('walks a run from intake to completed with the placeholder stages', async () => {
    // The documents stage is real from Phase 5; a stub stands in for it here.
    const h = setupEngine({
      ...placeholderStages({ delayMs: 0, autoApprove: false }),
      documenting: async () => ({ next: 'presenting' }),
    });
    const run = await h.pipelineEngine.createRun('Ghost race against a friend\nmore details');
    expect(run.title).toBe('Ghost race against a friend');

    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('awaiting_answers');
    const questionnaire = (
      h.events.find((e) => e.type === 'questionnaire') as { questionnaire: Questionnaire }
    ).questionnaire;

    await expect(
      h.pipelineEngine.submitAnswers(run.id, {
        questionnaireId: questionnaire.id,
        answers: { goal: ['retention'] },
      }),
    ).rejects.toThrow(RunActionError);
    await h.pipelineEngine.submitAnswers(run.id, {
      questionnaireId: questionnaire.id,
      answers: { goal: ['retention'], deadline: ['flexible'], platforms: ['ios', 'android'] },
    });
    await h.drain();
    // The run waits for the client's "publish documents" button.
    expect(h.runs.get(run.id)!.state).toBe('awaiting_documents');
    await h.pipelineEngine.publishDocuments(run.id);
    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('awaiting_decision');

    await h.pipelineEngine.decide(run.id, { decision: 'approve' });
    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('completed');
    expect(h.events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state)).toEqual([
      'intake',
      'awaiting_answers',
      'eliciting',
      'analyzing',
      'estimating',
      'awaiting_documents',
      'documenting',
      'presenting',
      'awaiting_decision',
      'backlog',
      'completed',
    ]);
  });

  it('moves each decision to the right state and records it through the decision hook', async () => {
    const recorded: string[] = [];
    const h = setupEngine(
      {},
      {
        onDecision: async (_run, decision) => {
          recorded.push(decision);
          return decision === 'decline' ? null : `Recorded: ${decision}`;
        },
      },
    );
    const expected = { approve: 'backlog', decline: 'declined' } as const;
    for (const decision of ['approve', 'decline'] as const) {
      const run = await h.pipelineEngine.createRun(`A feature to ${decision}`);
      h.runs.get(run.id)!.state = 'awaiting_decision';
      await h.pipelineEngine.decide(run.id, { decision });
      expect(h.runs.get(run.id)!.state).toBe(expected[decision]);
      await expect(h.pipelineEngine.decide(run.id, { decision })).rejects.toThrow(
        /not waiting for a decision/,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 0)); // the hook runs after the action
    expect(recorded).toEqual(['approve', 'decline']);
    const texts = h.events.flatMap((e) => (e.type === 'message' && e.role === 'ai' ? [e.text] : []));
    expect(texts).toEqual(['Recorded: approve']);
  });

  it('goes straight to the backlog with auto-approve on', async () => {
    const h = setupEngine({
      ...placeholderStages({ delayMs: 0, autoApprove: true }),
      documenting: async () => ({ next: 'presenting' }),
    });
    const run = await h.pipelineEngine.createRun('Auto-approved feature');
    h.runs.get(run.id)!.state = 'awaiting_documents';
    await h.pipelineEngine.publishDocuments(run.id);
    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('completed');
  });

  it('publishes documents only after the assessment and until the decision, and re-publishes from the decision', async () => {
    const h = setupEngine({ documenting: async () => ({ next: 'awaiting_decision' }) });
    const run = await h.pipelineEngine.createRun('A feature with documents');
    await expect(h.pipelineEngine.publishDocuments(run.id)).rejects.toThrow(/documents can be published/);
    h.runs.get(run.id)!.state = 'awaiting_decision';
    await h.pipelineEngine.publishDocuments(run.id);
    expect(h.runs.get(run.id)!.state).toBe('documenting');
    await h.drain();
    expect(h.runs.get(run.id)!.state).toBe('awaiting_decision');
    expect(canTransition('estimating', 'documenting')).toBe(false); // only the client's button leads in
    expect(canTransition('awaiting_documents', 'documenting')).toBe(true);
    expect(canTransition('documenting', 'awaiting_decision')).toBe(true);
  });

  it('lets the client continue with a preliminary assessment, or stop, after an incomplete discovery', async () => {
    const h = setupEngine({});
    const go = await h.pipelineEngine.createRun('A feature with open points');
    const stop = await h.pipelineEngine.createRun('Another feature with open points');
    await expect(h.pipelineEngine.confirmDiscovery(go.id, { proceed: true })).rejects.toThrow(/not waiting/);
    h.runs.get(go.id)!.state = 'awaiting_confirmation';
    h.runs.get(stop.id)!.state = 'awaiting_confirmation';

    await h.pipelineEngine.confirmDiscovery(go.id, { proceed: true, comment: 'Budget owner agrees' });
    await h.pipelineEngine.confirmDiscovery(stop.id, { proceed: false });
    expect(h.runs.get(go.id)!.state).toBe('analyzing');
    expect(h.runs.get(stop.id)!.state).toBe('declined');
    expect(h.jobs.at(-1)?.job).toEqual({ runId: go.id, state: 'analyzing' });
    expect(h.events).toContainEqual(
      expect.objectContaining({ role: 'client', text: expect.stringContaining('Budget owner agrees') }),
    );
  });

  it('retries a failing stage with backoff, then fails the run; a manual retry starts afresh', async () => {
    let calls = 0;
    const h = setupEngine({
      intake: async () => {
        calls++;
        throw new Error('Jira is down');
      },
    });
    const run = await h.pipelineEngine.createRun('A feature that will fail');
    await h.pipelineEngine.executeStage(h.jobs.shift()!.job);
    expect(h.jobs[0]).toMatchObject({ delay: 5 });
    await h.drain();
    expect(calls).toBe(3);
    expect(h.runs.get(run.id)).toMatchObject({
      state: 'failed',
      failedState: 'intake',
      error: 'Jira is down',
    });

    await h.pipelineEngine.retry(run.id);
    expect(h.runs.get(run.id)!.state).toBe('intake');
    expect(h.jobs).toHaveLength(1);
  });

  it('pauses on a usage limit and resumes later without counting a failure', async () => {
    const h = setupEngine({
      intake: async () => {
        throw new UsageLimitReached('Claude AI usage limit reached', null);
      },
    });
    const run = await h.pipelineEngine.createRun('A feature during a busy hour');
    await h.pipelineEngine.executeStage(h.jobs.shift()!.job);

    expect(h.runs.get(run.id)!.state).toBe('intake');
    expect(h.jobs).toEqual([{ job: { runId: run.id, state: 'intake' }, delay: 900 }]);
    expect(h.executions.map((e) => e.status)).toEqual(['paused']);
  });

  it('ignores stale jobs and jobs for a run another worker holds', async () => {
    let free = true;
    const h = setupEngine(placeholderStages({ delayMs: 0, autoApprove: true }), { lockFree: () => free });
    const run = await h.pipelineEngine.createRun('Duplicate jobs');
    await h.pipelineEngine.executeStage({ runId: run.id, state: 'analyzing' }); // stale
    expect(h.executions).toHaveLength(0);

    free = false;
    await h.pipelineEngine.executeStage({ runId: run.id, state: 'intake' }); // locked elsewhere
    expect(h.executions).toHaveLength(0);
    await expect(h.pipelineEngine.retry(run.id)).rejects.toMatchObject({ status: 409 });
  });
});
