import { z } from 'zod';

/** Where a pipeline run is. Active states have a stage job; waiting states wait for the client. */
export const runStateSchema = z.enum([
  'intake',
  'awaiting_answers',
  'eliciting',
  'awaiting_confirmation',
  'analyzing',
  'estimating',
  /** The assessment is ready; the client decides when to publish the documents to Confluence. */
  'awaiting_documents',
  'documenting',
  'presenting',
  'awaiting_decision',
  'backlog',
  'completed',
  'declined',
  'failed',
]);
export type RunState = z.infer<typeof runStateSchema>;

/** The stages shown on the progress timeline, in order. */
export const STAGES: { state: RunState; label: string }[] = [
  { state: 'intake', label: 'Intake' },
  { state: 'eliciting', label: 'Discovery' },
  { state: 'analyzing', label: 'Analysis' },
  { state: 'estimating', label: 'Estimation' },
  { state: 'documenting', label: 'Documents' },
  { state: 'presenting', label: 'Presentation' },
  { state: 'backlog', label: 'Backlog' },
];

export const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  /** Selecting it clears every other option ("Not yet determined", "No known constraints"). */
  exclusive: z.boolean().optional(),
  /** Options that cannot be combined with this one (fixed vs flexible budget). */
  excludes: z.array(z.string()).optional(),
  /** When set, choosing the option shows a text field with this prompt ("Which KPI and target?"). */
  detail: z.string().optional(),
});
export type QuestionOption = z.infer<typeof optionSchema>;

export const questionSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['single', 'multi']),
  options: z.array(optionSchema).min(2),
  /** Multi-choice limit ("select up to two"); no limit when absent. */
  maxSelections: z.number().int().positive().optional(),
  /** Section id from the questionnaire's sections. */
  section: z.string().optional(),
  /** Why the PM asks; shown under the question. */
  why: z.string().optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const NOT_SURE = 'not_sure';

export const questionnaireSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
});

export const questionnaireSchema = z.object({
  id: z.string(),
  round: z.number().int().positive(),
  /** Headings the questions are grouped under, in order. */
  sections: z.array(questionnaireSectionSchema).optional(),
  questions: z.array(questionSchema).min(1),
  /** Show the optional "Additional comments" field. */
  allowComment: z.boolean().optional(),
});
export type Questionnaire = z.infer<typeof questionnaireSchema>;

export const createRunSchema = z.object({
  description: z.string().trim().min(10, 'Describe the feature in at least a sentence').max(5000),
});

export const answersSchema = z.object({
  questionnaireId: z.string(),
  /** Question id → selected option values. */
  answers: z.record(z.string(), z.array(z.string()).min(1)),
  /** Question id → text for options that ask for details ("Other", "a specific KPI target"). */
  details: z.record(z.string(), z.string().trim().max(1000)).optional(),
  /** Optional free text: anything else that helps the assessment. */
  comment: z.string().trim().max(3000).optional(),
});
export type Answers = z.infer<typeof answersSchema>;

/** A questionnaire with the client's submission. */
export type AnsweredQuestionnaire = Questionnaire & {
  answers: Record<string, string[]>;
  details?: Record<string, string>;
  comment?: string | null;
};

// ---- discovery completeness ----------------------------------------------------------------

export const DISCOVERY_AREAS = [
  'business_justification',
  'product_context',
  'scope',
  'feasibility',
  'decision_readiness',
] as const;
export const discoveryAreaSchema = z.enum(DISCOVERY_AREAS);
export type DiscoveryArea = z.infer<typeof discoveryAreaSchema>;

/**
 * How trustworthy a piece of information is: what the client confirmed, what the client believes
 * without evidence, what the AI inferred, and what is still missing.
 */
export const informationKindSchema = z.enum(['confirmed', 'client_assumption', 'ai_hypothesis', 'missing']);
export type InformationKind = z.infer<typeof informationKindSchema>;

export const discoveryResultSchema = z.enum([
  /** Everything needed is known and consistent. */
  'complete',
  /** No blocking issue; open points are recorded as assumptions. */
  'complete_with_assumptions',
  /** Blocking gaps or contradictions; the client gets clarification questions. */
  'needs_clarification',
  /** Still blocked after the last clarification round; the client decides whether to go on. */
  'insufficient',
]);
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;

export const discoveryReportSchema = z.object({
  round: z.number().int().positive(),
  result: discoveryResultSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  confidenceReason: z.string(),
  summary: z.string(),
  coverage: z.array(
    z.object({
      area: discoveryAreaSchema,
      status: z.enum(['covered', 'partial', 'missing']),
      note: z.string(),
    }),
  ),
  findings: z.array(
    z.object({
      kind: informationKindSchema,
      area: discoveryAreaSchema,
      text: z.string(),
      /** Question id, "description", "comment" or "ai". */
      source: z.string(),
    }),
  ),
  gaps: z.array(z.object({ area: discoveryAreaSchema, text: z.string(), critical: z.boolean() })),
  contradictions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      severity: z.enum(['blocking', 'warning']),
      resolved: z.boolean(),
    }),
  ),
  /** Who can approve what; the decision gate later needs the right person. */
  readiness: z.object({ canApprove: z.enum(['full', 'scope_only', 'none']), note: z.string() }),
  nextAction: z.object({
    action: z.enum(['proceed', 'proceed_with_assumptions', 'clarify', 'client_decision']),
    text: z.string(),
  }),
});
export type DiscoveryReport = z.infer<typeof discoveryReportSchema>;

export const discoveryConfirmationSchema = z.object({
  /** true: go on with a preliminary assessment; false: stop the request. */
  proceed: z.boolean(),
  comment: z.string().trim().max(2000).optional(),
});
export type DiscoveryConfirmation = z.infer<typeof discoveryConfirmationSchema>;

export const decisionSchema = z.object({
  decision: z.enum(['approve', 'changes', 'decline']),
  comment: z.string().trim().max(2000).optional(),
});
export type Decision = z.infer<typeof decisionSchema>;

/** Events streamed to the UI over SSE and kept in the database, so a reload replays the chat. */
export const runEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), role: z.enum(['client', 'ai']), text: z.string() }),
  z.object({
    type: z.literal('stage'),
    stage: runStateSchema,
    status: z.enum(['started', 'completed', 'retrying', 'paused', 'failed']),
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal('questionnaire'), questionnaire: questionnaireSchema }),
  z.object({ type: z.literal('discovery_report'), report: discoveryReportSchema }),
  /** The assessment is on the Analysis tab; the chat only links to it. */
  z.object({
    type: z.literal('assessment_ready'),
    decision: z.enum(['go', 'go_with_conditions', 'no_go']),
    label: z.string(),
    highlights: z.array(z.string()),
  }),
  /** The documents were generated and published (or, in dry-run, checked); the card reloads them. */
  z.object({
    type: z.literal('documents'),
    published: z.number().int(),
    mode: z.enum(['dry-run', 'live']),
  }),
  /** The three-slide deck is ready; the card links to the slide viewer and the PPTX. */
  z.object({ type: z.literal('presentation_ready'), version: z.string(), label: z.string() }),
  z.object({
    type: z.literal('decision_requested'),
    verdict: z.string(),
    highlights: z.array(z.string()),
  }),
  z.object({ type: z.literal('state'), state: runStateSchema }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;

export const storedRunEventSchema = z.object({
  id: z.number().int(),
  createdAt: z.string(),
  event: runEventSchema,
  /** The event rewrote an earlier one with the same id (a step's block, updated in place). */
  replaced: z.boolean().optional(),
  /** The step this event belongs to (e.g. documents.request); absent for ordinary events. */
  key: z.string().optional(),
});
export type StoredRunEvent = z.infer<typeof storedRunEventSchema>;

export const runSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  state: runStateSchema,
  /** Stage that failed, so the UI can offer a retry. */
  failedState: runStateSchema.nullable(),
  error: z.string().nullable(),
  pendingQuestionnaire: questionnaireSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;
