import { bigserial, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** A managed project: one Jira project plus one Confluence space. */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  jiraProjectKey: text('jira_project_key').notNull(),
  confluenceSpaceKey: text('confluence_space_key').notNull(),
  /** Cadence, rates, capacity share and other per-project settings. */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  /** Compact, deterministic summary of the baseline that agents get in their prompts. */
  baselineDigest: text('baseline_digest'),
  baselineSyncedAt: timestamp('baseline_synced_at', { withTimezone: true }),
  ...timestamps,
});

/** The project's baseline documents (Business Case, Charter, …) as last read from Confluence. */
export const baselineArtifacts = pgTable(
  'baseline_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    /** Null while Atlassian writes are in dry-run mode. */
    confluencePageId: text('confluence_page_id'),
    confluenceVersion: integer('confluence_version'),
    contentStorage: text('content_storage').notNull(),
    /** Plain text of the page, for prompts. */
    contentText: text('content_text').notNull(),
    /** Structured data behind the page (KPIs, rates, risks, …), used by the calculators. */
    data: jsonb('data').$type<unknown>(),
    checksum: text('checksum').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('baseline_artifacts_project_type').on(t.projectId, t.type)],
);

/**
 * One row per Jira/Confluence entity the pipeline owns. The idempotency key maps our own id
 * (e.g. `seed:issue:ST-01`) to the external one, so re-runs update instead of duplicating.
 */
export const syncLog = pgTable('sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  system: text('system').notNull(),
  entityType: text('entity_type').notNull(),
  externalId: text('external_id'),
  externalKey: text('external_key'),
  externalVersion: integer('external_version'),
  /** Hash of the last payload we wrote; unchanged payloads are not written again. */
  payloadHash: text('payload_hash'),
  lastAction: text('last_action').notNull(),
  ...timestamps,
});

/** A feature idea as the client described it. */
export const featureRequests = pgTable('feature_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Null when no baseline has been seeded yet. */
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One pass of the pipeline over a feature request. `state` is the RunState from @ai-pm/shared. */
export const pipelineRuns = pgTable('pipeline_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  featureRequestId: uuid('feature_request_id')
    .notNull()
    .references(() => featureRequests.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  /** The stage that failed; a retry resumes there. */
  failedState: text('failed_state'),
  error: text('error'),
  ...timestamps,
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/** Every attempt at a stage, with its output. Retries and pauses add rows. */
export const stageExecutions = pgTable('stage_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  attempt: integer('attempt').notNull(),
  /** running | succeeded | failed | paused | interrupted */
  status: text('status').notNull(),
  output: jsonb('output').$type<unknown>(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/** Each Claude call: tokens, duration and outcome. */
export const llmCalls = pgTable('llm_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  stageExecutionId: uuid('stage_execution_id').references(() => stageExecutions.id, { onDelete: 'set null' }),
  agent: text('agent').notNull(),
  model: text('model').notNull(),
  promptHash: text('prompt_hash').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  durationMs: integer('duration_ms'),
  /** ok | invalid_output | limit_reached | error */
  status: text('status').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** The run's event stream (chat messages, stage progress, questionnaires); replayed on reload. */
export const runEvents = pgTable('run_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const questionnaires = pgTable(
  'questionnaires',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    questions: jsonb('questions').$type<unknown[]>().notNull(),
    /** Question id → selected option values; null until the client answers. */
    answers: jsonb('answers').$type<Record<string, string[]>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [unique('questionnaires_run_round').on(t.runId, t.round)],
);

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  /** approve | changes | decline */
  decision: text('decision').notNull(),
  comment: text('comment'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});
