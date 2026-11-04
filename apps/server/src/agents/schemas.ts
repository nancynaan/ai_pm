import { z } from 'zod';

/**
 * Output schemas of the agents, referenced by name from agents/*.agent.md (`output:`). Limits that
 * matter to the process (at most 8 questions, known levels and categories) live here, so the
 * runner's repair loop enforces them.
 */

const requirementType = z.enum(['functional', 'non_functional']);

const option = z.object({
  value: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .describe('snake_case value'),
  label: z.string().min(1),
});

export const questionOut = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .describe('Question-bank id, or custom_1 / custom_2'),
  text: z.string().min(5),
  kind: z.enum(['single', 'multi']),
  options: z.array(option).min(2).max(6).describe('Without the "not sure" option; it is added automatically'),
  why: z.string().min(5).describe('One short sentence on why the PM asks'),
  gap: z.string().describe('The gap topic this question closes'),
});

const gap = z.object({
  topic: z.string().min(2),
  description: z.string().min(5),
  critical: z.boolean().describe('True if the estimate or the value case cannot be made without it'),
});

export const ElicitationResult = z.object({
  summary: z.string().min(20).describe("The client's idea restated in two or three plain sentences"),
  epicSummary: z.string().min(5).max(80).describe('Title for the Jira Epic'),
  candidateRequirements: z
    .array(
      z.object({ text: z.string().min(5), type: requirementType, source: z.enum(['stated', 'inferred']) }),
    )
    .min(1),
  gaps: z.array(gap),
  questions: z.array(questionOut).min(1).max(8),
});
export type ElicitationResult = z.infer<typeof ElicitationResult>;

export const ElicitationReview = z.object({
  requirements: z
    .array(
      z.object({
        text: z.string().min(5),
        type: requirementType,
        source: z.enum(['stated', 'answer', 'inferred']),
      }),
    )
    .min(1),
  assumptions: z
    .array(z.object({ text: z.string().min(5), reason: z.string().min(3) }))
    .describe('Every "not sure" answer becomes an assumption with the default the team will use'),
  remainingGaps: z.array(gap),
  followUpQuestions: z.array(questionOut).max(3).describe('Only for critical gaps; empty otherwise'),
});
export type ElicitationReview = z.infer<typeof ElicitationReview>;

export const ISO_25010 = [
  'functional suitability',
  'performance efficiency',
  'compatibility',
  'interaction capability',
  'reliability',
  'security',
  'maintainability',
  'flexibility',
  'safety',
] as const;

export const RequirementsAnalysis = z.object({
  requirements: z
    .array(
      z.object({
        ref: z
          .string()
          .regex(/^(FR|NFR)-\d+$/)
          .describe('FR-1, FR-2 … for functional, NFR-1 … for non-functional'),
        type: requirementType,
        category: z
          .string()
          .min(3)
          .describe('ISO/IEC 25010 characteristic for NFRs; functional area for FRs'),
        title: z.string().min(3).max(120),
        description: z.string().min(10),
        moscow: z.enum(['must', 'should', 'could', 'wont']),
        inMvp: z.boolean(),
        source: z.enum(['stated', 'answer', 'inferred']),
      }),
    )
    .min(2),
  conflicts: z.array(
    z.object({
      requirementRef: z.string().nullable(),
      with: z.string().min(2).describe('Baseline document or backlog issue key'),
      kind: z.enum(['conflict', 'duplicate']),
      description: z.string().min(10),
      blocking: z.boolean(),
      resolutionOptions: z.array(z.string()).max(4),
    }),
  ),
  assumptions: z.array(z.object({ text: z.string().min(5), owner: z.string().nullable() })),
  constraints: z.array(
    z.object({
      type: z.enum(['time', 'budget', 'platform', 'technical', 'compliance', 'other']),
      text: z.string().min(5),
    }),
  ),
  mvpSummary: z.string().min(20).describe('What the MVP slice contains and what waits'),
});
export type RequirementsAnalysis = z.infer<typeof RequirementsAnalysis>;

export const ImpactAnalysis = z.object({
  componentImpacts: z
    .array(
      z.object({
        component: z.string().describe('Exact component name from the Architecture Overview'),
        level: z.enum(['none', 'low', 'medium', 'high']),
        rationale: z.string().min(10),
      }),
    )
    .min(1),
  dependencies: z.array(
    z.object({
      type: z.enum(['component', 'sdk', 'epic', 'team', 'external']),
      target: z.string().min(2),
      description: z.string().min(10),
      blocking: z.boolean(),
    }),
  ),
  performanceRisks: z.array(z.string().min(10)),
  spike: z.object({
    needed: z.boolean(),
    question: z.string().nullable().describe('What the spike must answer'),
    timeboxDays: z.number().int().min(1).max(10).nullable(),
  }),
});
export type ImpactAnalysis = z.infer<typeof ImpactAnalysis>;

export const AGENT_SCHEMAS: Record<string, z.ZodType> = {
  ElicitationResult,
  ElicitationReview,
  RequirementsAnalysis,
  ImpactAnalysis,
};
