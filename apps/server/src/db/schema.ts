import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

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
