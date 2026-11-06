import type { RunState } from '@ai-pm/shared';
import { PgBoss } from 'pg-boss';

export interface StageJob {
  runId: string;
  state: RunState;
}

/** Durable stage jobs. Retries are decided by the pipeline engine, so the queue itself never retries. */
export interface StageQueue {
  start(): Promise<void>;
  enqueue(job: StageJob, delaySeconds?: number): Promise<void>;
  work(handler: (job: StageJob) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

const QUEUE = 'pipeline-stage';

export function createPgBossQueue(connectionString: string, onError: (err: unknown) => void): StageQueue {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', onError);
  return {
    async start() {
      await boss.start();
      if (!(await boss.getQueue(QUEUE))) await boss.createQueue(QUEUE);
    },
    async enqueue(job, delaySeconds = 0) {
      await boss.send(QUEUE, job, { startAfter: delaySeconds, retryLimit: 0 });
    },
    async work(handler) {
      await boss.work<StageJob>(QUEUE, { batchSize: 1, localConcurrency: 2 }, async ([job]) => {
        if (job) await handler(job.data);
      });
    },
    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
}
