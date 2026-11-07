import { z } from 'zod';
import { documentStatusSchema } from './documents.js';

/** What a backlog item is in Jira terms; enablers, NFR items and spikes are stories with a label. */
export const backlogItemTypeSchema = z.enum(['epic', 'story', 'enabler', 'nfr', 'spike']);
export type BacklogItemType = z.infer<typeof backlogItemTypeSchema>;

export const JIRA_PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'] as const;

export const backlogItemSchema = z.object({
  /** EPIC, or the story-map ref (S-1, S-2 …). */
  localId: z.string(),
  type: backlogItemTypeSchema,
  summary: z.string(),
  /** Proposed by rules, pending the Product Owner's review. */
  priority: z.string().nullable(),
  /** PERT expected story points (AI estimate); the team's Story Points stay empty. */
  aiEstimate: z.number().nullable(),
  requirementCodes: z.array(z.string()),
  blockedBy: z.array(z.string()),
  jiraKey: z.string().nullable(),
  url: z.string().nullable(),
  status: documentStatusSchema,
  note: z.string().nullable(),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;

/** GET /api/runs/:id/backlog: the Epic and stories of an approved feature, as written to Jira. */
export const backlogSchema = z.object({
  runId: z.string(),
  mode: z.enum(['dry-run', 'live']),
  epic: backlogItemSchema.nullable(),
  stories: z.array(backlogItemSchema),
  /** The feature's block on the Initial Product Backlog page. */
  confluenceUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export type Backlog = z.infer<typeof backlogSchema>;
