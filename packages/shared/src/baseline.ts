import { z } from 'zod';

export const baselineArtifactSchema = z.object({
  type: z.string(),
  title: z.string(),
  /** Confluence page link; null while the seed has only run in dry-run. */
  url: z.string().nullable(),
  version: z.number().int().nullable(),
  syncedAt: z.string(),
});
export type BaselineArtifact = z.infer<typeof baselineArtifactSchema>;

export const baselineSummarySchema = z.object({
  project: z
    .object({
      key: z.string(),
      name: z.string(),
      syncedAt: z.string().nullable(),
    })
    .nullable(),
  artifacts: z.array(baselineArtifactSchema),
  digest: z.string().nullable(),
});
export type BaselineSummary = z.infer<typeof baselineSummarySchema>;
