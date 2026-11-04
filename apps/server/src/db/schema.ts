import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

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
  /** The draft Epic created at intake (null in dry-run). */
  epicKey: text('epic_key'),
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
    /** Section headings the questions are grouped under. */
    sections: jsonb('sections').$type<unknown[]>(),
    allowComment: boolean('allow_comment').notNull().default(false),
    /** Question id → selected option values; null until the client answers. */
    answers: jsonb('answers').$type<Record<string, string[]>>(),
    /** "questionId:optionValue" → the client's text for options that ask for details. */
    details: jsonb('details').$type<Record<string, string>>(),
    /** Optional free-text comment sent with the answers. */
    comment: text('comment'),
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
  /** assessment (approve | changes | decline) or discovery (proceed | stop) */
  gate: text('gate').notNull().default('assessment'),
  decision: text('decision').notNull(),
  comment: text('comment'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Requirements from the analysis stage, with stable codes (REQ-FR-001, REQ-NFR-001). */
export const requirements = pgTable('requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  /** functional | non_functional */
  type: text('type').notNull(),
  /** ISO/IEC 25010 characteristic for NFRs, functional area for FRs. */
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  /** must | should | could | wont */
  moscow: text('moscow').notNull(),
  inMvp: boolean('in_mvp').notNull(),
  /** stated | answer | inferred */
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const requirementConflicts = pgTable('requirement_conflicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  requirementCode: text('requirement_code'),
  /** What it conflicts with or duplicates: a baseline document, a backlog issue key, … */
  withRef: text('with_ref').notNull(),
  /** conflict | duplicate */
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  blocking: boolean('blocking').notNull(),
  resolutionOptions: jsonb('resolution_options').$type<string[]>().notNull().default([]),
});

export const assumptions = pgTable('assumptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  /** elicitation (discovery) | analysis */
  source: text('source').notNull(),
  /** client_hypothesis | ai_hypothesis | default | open_issue | assumption */
  kind: text('kind').notNull().default('assumption'),
  owner: text('owner'),
  status: text('status').notNull().default('open'),
});

export const constraints = pgTable('constraints', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  /** time | budget | platform | technical | compliance | other */
  type: text('type').notNull(),
  text: text('text').notNull(),
});

export const componentImpacts = pgTable('component_impacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  component: text('component').notNull(),
  /** none | low | medium | high */
  level: text('level').notNull(),
  rationale: text('rationale').notNull(),
});

export const dependencies = pgTable('dependencies', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  /** component | sdk | epic | team | external */
  type: text('type').notNull(),
  target: text('target').notNull(),
  description: text('description').notNull(),
  blocking: boolean('blocking').notNull(),
});

/** One row per run: the analysis verdicts that later stages read. */
export const featureAnalyses = pgTable('feature_analyses', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  /** cosmetic | feature_extension | core_engine */
  magnitude: text('magnitude').notNull(),
  magnitudeReason: text('magnitude_reason').notNull(),
  mvpSummary: text('mvp_summary').notNull(),
  spike: jsonb('spike').$type<{ needed: boolean; question?: string; timeboxDays?: number }>().notNull(),
  performanceRisks: jsonb('performance_risks').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
