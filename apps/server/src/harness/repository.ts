import {
  type Questionnaire,
  questionnaireSchema,
  type RunEvent,
  runEventSchema,
  type RunState,
  type RunSummary,
  type StoredRunEvent,
} from '@ai-pm/shared';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  decisions,
  featureRequests,
  llmCalls,
  pipelineRuns,
  projects,
  questionnaires,
  runEvents,
  stageExecutions,
} from '../db/schema.js';
import type { CallRecord } from '../agents/runner.js';

export interface RunRecord {
  id: string;
  state: RunState;
  failedState: RunState | null;
  error: string | null;
  title: string;
  description: string;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const runColumns = {
  id: pipelineRuns.id,
  state: pipelineRuns.state,
  failedState: pipelineRuns.failedState,
  error: pipelineRuns.error,
  title: featureRequests.title,
  description: featureRequests.description,
  projectId: featureRequests.projectId,
  createdAt: pipelineRuns.createdAt,
  updatedAt: pipelineRuns.updatedAt,
};

/** All database access of the harness. */
export function createRunRepository(db: Db) {
  // state and failedState are stored as text; only harness code writes them.
  const toRun = (row: Record<string, unknown>) => row as unknown as RunRecord;

  return {
    async createRun(input: { title: string; description: string }): Promise<RunRecord> {
      const [project] = await db.select({ id: projects.id }).from(projects).limit(1);
      return db.transaction(async (tx) => {
        const [request] = await tx
          .insert(featureRequests)
          .values({ ...input, projectId: project?.id ?? null })
          .returning();
        const [run] = await tx
          .insert(pipelineRuns)
          .values({ featureRequestId: request!.id, state: 'intake' })
          .returning();
        return {
          id: run!.id,
          state: 'intake',
          failedState: null,
          error: null,
          title: request!.title,
          description: request!.description,
          projectId: request!.projectId,
          createdAt: run!.createdAt,
          updatedAt: run!.updatedAt,
        };
      });
    },

    async getRun(runId: string): Promise<RunRecord | null> {
      const [row] = await db
        .select(runColumns)
        .from(pipelineRuns)
        .innerJoin(featureRequests, eq(pipelineRuns.featureRequestId, featureRequests.id))
        .where(eq(pipelineRuns.id, runId))
        .limit(1);
      return row ? toRun(row) : null;
    },

    async listRuns(limit = 20): Promise<RunRecord[]> {
      const rows = await db
        .select(runColumns)
        .from(pipelineRuns)
        .innerJoin(featureRequests, eq(pipelineRuns.featureRequestId, featureRequests.id))
        .orderBy(desc(pipelineRuns.createdAt))
        .limit(limit);
      return rows.map(toRun);
    },

    async runIdsInStates(states: readonly RunState[]): Promise<{ id: string; state: RunState }[]> {
      const rows = await db
        .select({ id: pipelineRuns.id, state: pipelineRuns.state })
        .from(pipelineRuns)
        .where(inArray(pipelineRuns.state, [...states]));
      return rows as { id: string; state: RunState }[];
    },

    async setState(
      runId: string,
      state: RunState,
      extra: { failedState?: RunState | null; error?: string | null } = {},
    ) {
      const finished = state === 'completed' || state === 'declined';
      await db
        .update(pipelineRuns)
        .set({
          state,
          failedState: extra.failedState ?? null,
          error: extra.error ?? null,
          updatedAt: new Date(),
          ...(finished ? { finishedAt: new Date() } : {}),
        })
        .where(eq(pipelineRuns.id, runId));
    },

    async addEvent(runId: string, event: RunEvent): Promise<StoredRunEvent> {
      const { type, ...payload } = event;
      const [row] = await db.insert(runEvents).values({ runId, type, payload }).returning();
      return { id: row!.id, createdAt: row!.createdAt.toISOString(), event };
    },

    async listEvents(runId: string, afterId = 0): Promise<StoredRunEvent[]> {
      const rows = await db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.id, afterId)))
        .orderBy(asc(runEvents.id));
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        event: runEventSchema.parse({ type: r.type, ...r.payload }),
      }));
    },

    async startExecution(runId: string, stage: RunState): Promise<{ id: string; attempt: number }> {
      const [counted] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(stageExecutions)
        .where(and(eq(stageExecutions.runId, runId), eq(stageExecutions.stage, stage)));
      const attempt = (counted?.n ?? 0) + 1;
      const [row] = await db
        .insert(stageExecutions)
        .values({ runId, stage, attempt, status: 'running' })
        .returning();
      return { id: row!.id, attempt };
    },

    /** Attempts that ended in failure; pauses and interruptions do not count against the retry limit. */
    async failedAttempts(runId: string, stage: RunState): Promise<number> {
      const [counted] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(stageExecutions)
        .where(
          and(
            eq(stageExecutions.runId, runId),
            eq(stageExecutions.stage, stage),
            eq(stageExecutions.status, 'failed'),
          ),
        );
      return counted?.n ?? 0;
    },

    /** A manual retry starts the stage's retry budget afresh. */
    async resetFailures(runId: string, stage: RunState) {
      await db
        .update(stageExecutions)
        .set({ status: 'failed_before_retry' })
        .where(
          and(
            eq(stageExecutions.runId, runId),
            eq(stageExecutions.stage, stage),
            eq(stageExecutions.status, 'failed'),
          ),
        );
    },

    async finishExecution(
      id: string,
      status: 'succeeded' | 'failed' | 'paused',
      result: { output?: unknown; error?: string },
    ) {
      await db
        .update(stageExecutions)
        .set({ status, output: result.output ?? null, error: result.error ?? null, finishedAt: new Date() })
        .where(eq(stageExecutions.id, id));
    },

    /** After a crash, executions still marked running were cut off. */
    async markInterrupted() {
      await db
        .update(stageExecutions)
        .set({ status: 'interrupted', finishedAt: new Date() })
        .where(and(eq(stageExecutions.status, 'running'), isNull(stageExecutions.finishedAt)));
    },

    async saveQuestionnaire(
      runId: string,
      round: number,
      questions: Questionnaire['questions'],
    ): Promise<Questionnaire> {
      const [row] = await db.insert(questionnaires).values({ runId, round, questions }).returning();
      return { id: row!.id, round, questions };
    },

    async pendingQuestionnaire(runId: string): Promise<Questionnaire | null> {
      const [row] = await db
        .select()
        .from(questionnaires)
        .where(and(eq(questionnaires.runId, runId), isNull(questionnaires.answeredAt)))
        .orderBy(desc(questionnaires.round))
        .limit(1);
      return row
        ? questionnaireSchema.parse({ id: row.id, round: row.round, questions: row.questions })
        : null;
    },

    async answeredQuestionnaires(runId: string) {
      const rows = await db
        .select()
        .from(questionnaires)
        .where(eq(questionnaires.runId, runId))
        .orderBy(asc(questionnaires.round));
      return rows
        .filter((r) => r.answers)
        .map((r) => ({
          ...questionnaireSchema.parse({ id: r.id, round: r.round, questions: r.questions }),
          answers: r.answers ?? {},
        }));
    },

    async saveAnswers(questionnaireId: string, answers: Record<string, string[]>) {
      await db
        .update(questionnaires)
        .set({ answers, answeredAt: new Date() })
        .where(eq(questionnaires.id, questionnaireId));
    },

    /** Output of the stage's latest successful attempt. */
    async latestStageOutput(runId: string, stage: RunState): Promise<unknown> {
      const [row] = await db
        .select({ output: stageExecutions.output })
        .from(stageExecutions)
        .where(
          and(
            eq(stageExecutions.runId, runId),
            eq(stageExecutions.stage, stage),
            eq(stageExecutions.status, 'succeeded'),
          ),
        )
        .orderBy(desc(stageExecutions.startedAt))
        .limit(1);
      return row?.output ?? null;
    },

    async latestDecision(runId: string): Promise<{ decision: string; comment: string | null } | null> {
      const [row] = await db
        .select({ decision: decisions.decision, comment: decisions.comment })
        .from(decisions)
        .where(eq(decisions.runId, runId))
        .orderBy(desc(decisions.decidedAt))
        .limit(1);
      return row ?? null;
    },

    async saveDecision(runId: string, decision: string, comment: string | undefined) {
      await db.insert(decisions).values({ runId, decision, comment: comment ?? null });
    },

    async baselineDigest(projectId: string | null): Promise<string | null> {
      if (!projectId) return null;
      const [row] = await db
        .select({ digest: projects.baselineDigest })
        .from(projects)
        .where(eq(projects.id, projectId));
      return row?.digest ?? null;
    },

    async recordCall(runId: string | null, stageExecutionId: string | null, call: CallRecord) {
      await db.insert(llmCalls).values({ runId, stageExecutionId, ...call });
    },

    async summary(run: RunRecord): Promise<RunSummary> {
      return {
        id: run.id,
        title: run.title,
        state: run.state,
        failedState: run.failedState,
        error: run.error,
        pendingQuestionnaire:
          run.state === 'awaiting_answers' ? await this.pendingQuestionnaire(run.id) : null,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
      };
    },
  };
}

export type RunRepository = ReturnType<typeof createRunRepository>;
