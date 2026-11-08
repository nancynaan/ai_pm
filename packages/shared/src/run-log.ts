import { z } from 'zod';

/**
 * A run's log for the System status page: each stage attempt with its duration and outcome, and
 * the Claude calls made in it (tokens, duration, repairs, usage-limit pauses). Read from
 * `stage_executions` and `llm_calls`; no prompt or answer text, only the numbers.
 */
export const runLogCallSchema = z.object({
  agent: z.string(),
  /** ok | invalid_output (a repair followed) | limit_reached | error */
  status: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
});

export const runLogStageSchema = z.object({
  stage: z.string(),
  attempt: z.number().int(),
  /** running | succeeded | failed | paused | interrupted */
  status: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  calls: z.array(runLogCallSchema),
});

export const runLogSchema = z.object({
  runId: z.string(),
  stages: z.array(runLogStageSchema),
  totals: z.object({
    calls: z.number().int(),
    repairs: z.number().int(),
    limitPauses: z.number().int(),
    errors: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    /** Time spent in Claude calls. */
    callMs: z.number().int(),
  }),
});
export type RunLog = z.infer<typeof runLogSchema>;
export type RunLogStage = z.infer<typeof runLogStageSchema>;
