import { fileURLToPath } from 'node:url';
import type { RunState, StoredRunEvent } from '@ai-pm/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Cassette, createCassette } from '../agents/cassette.js';
import { buildPages } from '../baseline/pages.js';
import { loadSeedData } from '../baseline/seed-data.js';
import { renderPage } from '../baseline/seed.js';
import { loadBaseline } from '../baseline/store.js';
import type { AppConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { answersFor, loadEvalFeatures } from '../evals/features.js';
import { investProblems, uncoveredRequirements } from '../evals/graders.js';
import { createPipeline, createRepositories } from '../pipeline.js';
import type { BacklogDraft } from '../agents/schemas.js';
import type { StageJob, StageQueue } from '../pipeline-engine/queue.js';
import { drizzleSyncLog } from '../sync/sync-log.js';
import { dockerClaude } from './docker-claude.js';
import { fakeAtlassian } from './fake-atlassian.js';

/**
 * The whole pipeline in dry-run, as the app runs it: real stages, real Postgres, the client from
 * evals/features.yaml, Claude answers replayed from a cassette and a fake read-only Atlassian
 * site. One run is approved (ends in `completed` with an Epic and stories planned), a second run
 * of the same feature is declined. Nothing is written to Atlassian and no Claude call is made.
 *
 *   E2E_DATABASE_URL=postgres://user:pass@localhost:5432/postgres npm test -w apps/server -- e2e
 *   E2E_RECORD=1 … records the missing Claude answers through the running app container
 *   (docker compose up -d app), which is signed in to Claude.
 *
 * Without E2E_DATABASE_URL the suite is skipped (CI sets it with a Postgres service).
 */

const ADMIN_URL = process.env.E2E_DATABASE_URL;
const RECORD = process.env.E2E_RECORD === '1';
const FEATURE = 'rewarded-menu-chest';
const CASSETTE = fileURLToPath(new URL(`../../../../evals/cassettes/${FEATURE}.json`, import.meta.url));
// Replay takes seconds; recording makes ~10 real calls.
const RUN_TIMEOUT = RECORD ? 60 * 60_000 : 120_000;

const config: AppConfig = {
  env: 'test',
  logLevel: 'error',
  port: 0,
  baseUrl: 'http://localhost:3000',
  databaseUrl: '',
  claude: { cliPath: process.env.CLAUDE_CLI_PATH ?? 'claude', model: 'claude-opus-5-5' },
  atlassian: {
    siteUrl: 'https://example.atlassian.net',
    jiraProjectKey: 'AIPM',
    confluenceSpaceKey: 'AIPMconf',
    writeMode: 'dry-run',
  },
  pipeline: { clientGateAutoApprove: false, placeholderDelayMs: 0 },
};

/** Stage jobs in process: the engine still decides retries and locks. */
function memoryQueue(): StageQueue & { idle(): boolean } {
  let handler: ((job: StageJob) => Promise<void>) | undefined;
  const pending = new Set<NodeJS.Timeout>();
  let running = 0;
  return {
    async start() {},
    async enqueue(job, delaySeconds = 0) {
      const timer = setTimeout(() => {
        pending.delete(timer);
        running++;
        void handler?.(job).finally(() => running--);
      }, delaySeconds * 1000);
      pending.add(timer);
    },
    async work(h) {
      handler = h;
    },
    async stop() {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    },
    idle: () => pending.size === 0 && running === 0,
  };
}

const WAITING: RunState[] = [
  'awaiting_answers',
  'awaiting_confirmation',
  'awaiting_documents',
  'awaiting_decision',
  'completed',
  'declined',
  'failed',
];

describe.skipIf(!ADMIN_URL)('pipeline end to end (dry-run, replayed Claude)', () => {
  const feature = loadEvalFeatures().find((f) => f.id === FEATURE)!;
  const seed = loadSeedData();
  const site = fakeAtlassian(seed);
  const dbName = `aipm_e2e_${process.pid}_${Date.now()}`;
  let admin: pg.Client;
  let db: ReturnType<typeof createDb>;
  let cassette: Cassette;
  let queue: ReturnType<typeof memoryQueue>;
  let repos: ReturnType<typeof createRepositories>;
  let engine: ReturnType<typeof createPipeline>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    db = createDb(url.toString());
    // Dropping the test database at the end ends any connection still open (57P01); expected.
    db.pool.on('error', (err: Error & { code?: string }) => {
      if (err.code !== '57P01') throw err;
    });
    await runMigrations(db.db);
    await loadBaseline({
      db: db.db,
      config,
      gateway: site.gateway,
      store: drizzleSyncLog(db.db),
      seed,
      pages: buildPages(seed, { issueKeys: new Map() }).map(renderPage),
    });

    cassette = createCassette({ file: CASSETTE, mode: RECORD ? 'record' : 'replay' });
    queue = memoryQueue();
    repos = createRepositories(db.db);
    const offline = {
      print: () => Promise.reject(new Error('Claude is offline in the e2e test; record with E2E_RECORD=1')),
    };
    engine = createPipeline({
      config,
      db: db.db,
      pool: db.pool,
      repos,
      gateway: site.gateway,
      claude: RECORD ? dockerClaude() : offline,
      cassette,
      queue,
      log: { info: () => undefined, error: (obj, msg) => console.error(msg, obj) },
    });
    await engine.start();
  }, 60_000);

  afterAll(async () => {
    cassette?.save();
    await engine?.stop();
    await queue?.stop();
    await db?.pool.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  /** Waits until the run stops at a state the client (or the end) must act on. */
  async function settle(runId: string): Promise<RunState> {
    for (;;) {
      const run = await repos.repo.getRun(runId);
      if (run && WAITING.includes(run.state) && queue.idle()) return run.state;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Plays the client until the decision gate, then decides. */
  async function playClient(decision: 'approve' | 'decline') {
    const run = await engine.createRun(feature.description);
    const answered = new Set<string>();
    for (;;) {
      const state = await settle(run.id);
      const summary = await repos.repo.summary((await repos.repo.getRun(run.id))!);
      if (state === 'failed') throw new Error(`run failed: ${summary.error ?? 'no error'}`);
      if (state === 'awaiting_answers' && summary.pendingQuestionnaire) {
        const q = summary.pendingQuestionnaire;
        if (answered.has(q.id)) throw new Error('the same questionnaire came back');
        answered.add(q.id);
        await engine.submitAnswers(run.id, answersFor(q, feature));
      } else if (state === 'awaiting_confirmation') {
        await engine.confirmDiscovery(run.id, { proceed: true });
      } else if (state === 'awaiting_documents') {
        await engine.publishDocuments(run.id);
      } else if (state === 'awaiting_decision') {
        await engine.decide(run.id, { decision });
        return { runId: run.id, state: await settle(run.id) };
      } else {
        throw new Error(`unexpected state ${state}`);
      }
    }
  }

  const blocks = async (runId: string) => {
    const events: StoredRunEvent[] = await repos.repo.listEvents(runId, 0);
    const keyed = events.filter((e) => e.key);
    return { events, keys: keyed.map((e) => e.key!) };
  };

  it(
    'approves: assessment, documents, deck and an AI-draft backlog, all planned in dry-run',
    async () => {
      const { runId, state } = await playClient('approve');
      expect(state).toBe('completed');

      const assessment = await repos.analysis.assessmentOf(runId);
      expect(assessment?.verdict.decision).toBe('go');
      expect(assessment?.preliminary).toBe(false);

      // Documents: rendered and validated by the stage (figures match the database); dry-run only.
      const documents = await repos.documents.documentsOf(runId);
      expect(documents.filter((d) => d.markdown.length > 0).length).toBeGreaterThanOrEqual(5);
      for (const d of documents) expect(d.status).not.toMatch(/^(created|updated)$/);

      // The deck: exactly three slides, no story points client-facing.
      const deck = await repos.presentations.get(runId);
      expect(Object.keys(deck!.deck)).toEqual(
        expect.arrayContaining(['opportunity', 'solution', 'feasibility']),
      );
      expect(JSON.stringify(deck?.deck)).not.toMatch(/story points|\bSP\b/i);

      // Backlog: an Epic and one story per story-map item, every in-scope requirement covered.
      const backlog = (await repos.backlog.backlogOf(runId))!;
      expect(backlog.mode).toBe('dry-run');
      expect(backlog.epic).not.toBeNull();
      expect(backlog.stories).toHaveLength(assessment!.storyMap.items.length);
      const analysis = await repos.analysis.analysisOf(runId);
      expect(uncoveredRequirements(analysis!.requirements, backlog.stories)).toEqual([]);
      const set = await repos.backlog.setOf(runId);
      expect(investProblems(set!.draft as BacklogDraft, backlog.stories)).toEqual([]);

      // The chat: exactly one block per step, ending with the backlog card and the closing message.
      const { events, keys } = await blocks(runId);
      expect(new Set(keys).size).toBe(keys.length);
      expect(events.filter((e) => e.event.type === 'backlog_ready')).toHaveLength(1);
      expect(keys).toContain('backlog.closing');

      // Dry-run: the fake site refused nothing because nothing tried to write.
      expect(site.writes).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  it(
    'declines: the run closes without a backlog',
    async () => {
      cassette.rewind(); // the same client again, answered from the same recording
      const { runId, state } = await playClient('decline');
      expect(state).toBe('declined');
      expect(await repos.backlog.backlogOf(runId)).toBeNull();
      // The Decision Log is written after the click, outside the run lock: wait for its message.
      let closing: StoredRunEvent | undefined;
      for (let i = 0; i < 200 && !closing; i++) {
        closing = (await blocks(runId)).events.find((e) => e.key === 'decision.recorded');
        if (!closing) await new Promise((r) => setTimeout(r, 50));
      }
      expect(JSON.stringify(closing?.event)).toMatch(/conversation is now closed/);
      expect(site.writes).toEqual([]);
    },
    RUN_TIMEOUT,
  );
});
