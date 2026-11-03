import { z } from 'zod';

/** Where a pipeline run is. Active states have a stage job; waiting states wait for the client. */
export const runStateSchema = z.enum([
  'intake',
  'awaiting_answers',
  'eliciting',
  'analyzing',
  'estimating',
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
  { state: 'eliciting', label: 'Questions' },
  { state: 'analyzing', label: 'Analysis' },
  { state: 'estimating', label: 'Estimation' },
  { state: 'documenting', label: 'Documents' },
  { state: 'presenting', label: 'Presentation' },
  { state: 'backlog', label: 'Backlog' },
];

export const questionSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['single', 'multi']),
  options: z.array(z.object({ value: z.string(), label: z.string() })).min(2),
  /** Why the PM asks; shown under the question. */
  why: z.string().optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const NOT_SURE = 'not_sure';

export const questionnaireSchema = z.object({
  id: z.string(),
  round: z.number().int().positive(),
  questions: z.array(questionSchema).min(1),
});
export type Questionnaire = z.infer<typeof questionnaireSchema>;

export const createRunSchema = z.object({
  description: z.string().trim().min(10, 'Describe the feature in at least a sentence').max(5000),
});

export const answersSchema = z.object({
  questionnaireId: z.string(),
  /** Question id → selected option values. */
  answers: z.record(z.string(), z.array(z.string()).min(1)),
});
export type Answers = z.infer<typeof answersSchema>;

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
