import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** A managed project: one Jira project plus one Confluence space. Pipeline tables arrive in Phase 1–2. */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  jiraProjectKey: text('jira_project_key').notNull(),
  confluenceSpaceKey: text('confluence_space_key').notNull(),
  /** Cadence, rates, capacity share and other per-project settings. */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});
