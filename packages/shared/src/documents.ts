import { z } from 'zod';

/**
 * The PM documents of a feature assessment (BPMN 04), published to Confluence when the client
 * presses the button on the Documents card. Three pages per feature (four with a roadmap
 * proposal) plus this feature's block on the shared Risk Register and Assumption Log pages.
 */
export const DOCUMENT_TYPES = [
  'feature_brief',
  'requirements',
  'estimation',
  'risk_register',
  'assumption_log',
  'roadmap_proposal',
] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const DOCUMENT_LABEL: Record<DocumentType, string> = {
  feature_brief: 'Feature Brief',
  requirements: 'Requirements Specification',
  estimation: 'Estimation & Release Forecast',
  risk_register: 'Risk Register (update)',
  assumption_log: 'Assumption Log (update)',
  roadmap_proposal: 'Roadmap Update Proposal',
};

/**
 * What happened to a document on the last publish. `would_*` are dry-run results (nothing was
 * written); `not_needed` is a roadmap proposal for a feature that leaves the roadmap as it is.
 */
export const documentStatusSchema = z.enum([
  'pending',
  'created',
  'updated',
  'unchanged',
  'would_create',
  'would_update',
  'not_needed',
  'skipped',
]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentRowSchema = z.object({
  type: documentTypeSchema,
  title: z.string(),
  status: documentStatusSchema,
  /** The Confluence page; null in dry-run before the first live publish. */
  url: z.string().nullable(),
  version: z.number().int().nullable(),
  note: z.string().nullable(),
  /** A rendered preview exists (GET /api/runs/:id/documents/:type). */
  preview: z.boolean(),
});
export type DocumentRow = z.infer<typeof documentRowSchema>;

export const documentSetSchema = z.object({
  runId: z.string(),
  /** FA-<n>, assigned on the first publish. */
  faNumber: z.number().int().nullable(),
  mode: z.enum(['dry-run', 'live']),
  /** When the documents were last published (or checked in dry-run). */
  publishedAt: z.string().nullable(),
  /** The button is active: the run waits for documents or for the client's decision. */
  canPublish: z.boolean(),
  /** The documents step is running now. */
  running: z.boolean(),
  documents: z.array(documentRowSchema),
});
export type DocumentSet = z.infer<typeof documentSetSchema>;

export const documentPreviewSchema = z.object({
  type: documentTypeSchema,
  title: z.string(),
  markdown: z.string(),
});
export type DocumentPreview = z.infer<typeof documentPreviewSchema>;
