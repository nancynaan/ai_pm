import { z } from 'zod';
import { verdictSchema } from './assessment.js';

/**
 * The client presentation (BPMN 05): three slides for a decision, not a copy of the documents.
 * Every number is filled in by the pipeline engine; the presenter agent only writes headings and
 * short labels. Delivery and budget are ranges, never story points, and always marked preliminary.
 */

const text = z.string();

export const deckSchema = z.object({
  runId: text,
  /** "1.0", then "1.1", … when the deck is regenerated for a changed assessment. */
  version: text,
  feature: text,
  createdAt: text,
  /** "Feature Proposal · <feature> · Version 1.0" */
  label: text,
  /** On every slide: a preliminary AI assessment is not a delivery commitment. */
  disclaimer: text,
  opportunity: z.object({
    heading: text,
    objective: text,
    targetKpi: z.object({ name: text, baseline: text, clientTarget: text.nullable() }),
    impact: z.object({ base: text, range: text }),
    audience: text,
    value: z.object({ base: text, range: text, payback: text }),
    /** Shown when an effect rests on a hypothesis (for example retention without evidence). */
    caution: text.nullable(),
    chart: z.object({
      kpi: text,
      bars: z.array(z.object({ label: text, value: z.number(), display: text })),
    }),
  }),
  solution: z.object({
    heading: text,
    flow: z.array(text),
    capabilities: z.array(z.object({ title: text, detail: text })),
    counts: z.array(z.object({ label: text, value: z.number() })),
    boundary: text,
  }),
  feasibility: z.object({
    heading: text,
    delivery: z.object({ range: text, detail: text }),
    budget: z.object({ range: text, detail: text }),
    risks: z.object({ items: z.array(z.object({ title: text, level: text })), note: text.nullable() }),
    dependencies: z.array(text),
    verdict: z.object({ decision: verdictSchema.shape.decision, label: text, sentence: text }),
  }),
});
export type Deck = z.infer<typeof deckSchema>;

export const presentationSchema = z.object({
  deck: deckSchema,
  /** The PPTX attached to the Feature Brief in Confluence, once the client published it. */
  attachment: z.object({ status: text, url: text.nullable(), fileName: text }).nullable(),
  /** "Publish to Confluence" is active: the documents are published and the deck is not yet. */
  canPublish: z.boolean(),
  /** Why it is greyed out (documents not published, already published); a hint. */
  lockedReason: text.nullable(),
});
export type Presentation = z.infer<typeof presentationSchema>;
