import { z } from 'zod';

/**
 * The PM documents of a feature assessment (BPMN 04). The client generates them with a button on
 * the Documents card (or skips them for now) and publishes them to Confluence with a second
 * button, once; Approve needs them published. Three pages per feature (four with a roadmap
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
 * Where a document stands: `generated` (written, not published), then what happened on the
 * publish. `would_*` are dry-run results (nothing was written); `not_needed` is a roadmap
 * proposal for a feature that leaves the roadmap as it is.
 */
export const documentStatusSchema = z.enum([
  'pending',
  'generated',
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
  /** When the documents were published (or checked in dry-run); they are published once. */
  publishedAt: z.string().nullable(),
  /** The documents are written (generated) and can be previewed. */
  generated: z.boolean(),
  /** "Generate documents" is active: not generated yet, and the run waits at the documents step or the decision. */
  canGenerate: z.boolean(),
  /** "Skip for now" is offered (any verdict) at the documents step; Approve still needs them published. */
  canSkip: z.boolean(),
  /** "Publish to Confluence" is active: generated, not published yet, no step writing now. */
  canPublish: z.boolean(),
  /** Why "Publish to Confluence" is greyed out (not generated yet, a step is running); a hint. */
  lockedReason: z.string().nullable(),
  /** The documents are being generated now. */
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
