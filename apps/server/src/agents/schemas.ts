import { z } from 'zod';

/**
 * Output schemas of the agents, referenced by name from agents/*.agent.md (`output:`). Limits that
 * matter to the process (at most 2 feature questions, known levels and categories) live here, so
 * the runner's repair loop enforces them.
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
  gaps: z.array(gap).describe('Feature-specific gaps the fixed discovery questionnaire does not cover'),
  featureQuestions: z
    .array(questionOut)
    .max(2)
    .describe('0–2 feature-specific questions; never repeat a topic of the discovery questionnaire'),
});
export type ElicitationResult = z.infer<typeof ElicitationResult>;

const area = z.enum([
  'business_justification',
  'product_context',
  'scope',
  'feasibility',
  'decision_readiness',
]);

export const DiscoveryReview = z.object({
  summary: z
    .string()
    .min(20)
    .describe('Overall result of the questionnaire in two or three plain sentences for the client'),
  requirements: z
    .array(
      z.object({
        text: z.string().min(5),
        type: requirementType,
        source: z.enum(['stated', 'answer', 'inferred']),
      }),
    )
    .min(1),
  findings: z
    .array(
      z.object({
        kind: z.enum(['confirmed', 'client_assumption', 'ai_hypothesis', 'missing']),
        area,
        text: z.string().min(5),
        source: z.enum(['description', 'comment', 'feature_question', 'clarification', 'ai']),
      }),
    )
    .max(15)
    .describe(
      'Information the rules cannot classify: from the description, comments, feature questions, clarifications, and your own inferences (ai_hypothesis)',
    ),
  assumptions: z
    .array(
      z.object({
        text: z.string().min(5),
        reason: z.string().min(3),
        kind: z.enum(['client_hypothesis', 'ai_hypothesis', 'default']),
      }),
    )
    .describe('Defaults for "not sure" answers, client beliefs without evidence, and your inferences'),
  gaps: z
    .array(z.object({ area, text: z.string().min(5), critical: z.boolean() }))
    .describe('Gaps the rules did not report. Critical only if the assessment is impossible without it.'),
  contradictions: z
    .array(z.object({ text: z.string().min(10), severity: z.enum(['blocking', 'warning']) }))
    .describe('Contradictions the rules did not report, e.g. between the description and the answers'),
  clarificationQuestions: z
    .array(questionOut)
    .max(3)
    .describe('Only for your own blocking contradictions and critical gaps; empty otherwise'),
});
export type DiscoveryReview = z.infer<typeof DiscoveryReview>;

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

// ---- assessment (stage 03) -----------------------------------------------------------------

const FIBONACCI = [0, 1, 2, 3, 5, 8, 13, 20, 40] as const;
const points = z
  .number()
  .int()
  .refine((n) => (FIBONACCI as readonly number[]).includes(n), 'Use the scale 0, 1, 2, 3, 5, 8, 13, 20, 40');

export const EstimationResult = z.object({
  items: z
    .array(
      z
        .object({
          ref: z
            .string()
            .regex(/^S-\d+$/)
            .describe('S-1, S-2 …'),
          activity: z.string().min(2).describe('Story-map backbone activity this item belongs to'),
          title: z.string().min(3).max(120),
          type: z.enum(['story', 'spike', 'enabler', 'nfr']),
          release: z.enum(['mvp', 'later']),
          discipline: z
            .enum(['gameplay', 'backend', 'ui_art', 'qa', 'other'])
            .describe(
              'Who mainly does it: gameplay = all Unity client code incl. UI implementation; ui_art = design and art by the UI/UX & 2D artist only',
            ),
          requirementCodes: z.array(z.string()).describe('REQ-FR-### / REQ-NFR-### codes it implements'),
          optimistic: points,
          mostLikely: points,
          pessimistic: points,
          referenceStory: z
            .string()
            .nullable()
            .describe('Key of the done reference story it was sized against'),
          rationale: z.string().min(10),
        })
        .refine((i) => i.optimistic <= i.mostLikely && i.mostLikely <= i.pessimistic, {
          message: 'optimistic ≤ mostLikely ≤ pessimistic',
        }),
    )
    .min(2)
    .max(40),
  nonLabour: z
    .array(
      z.object({
        description: z.string().min(3),
        kind: z.enum(['one_off', 'monthly']),
        amountUsd: z.number().nonnegative(),
        basis: z.string().min(5).describe('Where the amount comes from'),
      }),
    )
    .describe('Costs outside the team: outsourced assets, licences, server costs'),
  deadline: z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), basis: z.string().min(5) })
    .nullable()
    .describe('Only when asked: your reading of a deadline the client named without an explicit date'),
  assumptions: z.array(z.string().min(5)),
});
export type EstimationResult = z.infer<typeof EstimationResult>;

const scale = z.number().int().min(1).max(5);

export const RiskAssessment = z.object({
  risks: z
    .array(
      z.object({
        title: z.string().min(3).max(100),
        cause: z.string().min(5),
        event: z.string().min(5),
        effect: z.string().min(5),
        category: z.enum(['Product', 'Technical', 'Schedule', 'Commercial', 'Compliance', 'Organizational']),
        probability: scale,
        impact: scale,
        strategy: z.enum(['Avoid', 'Mitigate', 'Transfer', 'Accept']),
        response: z.string().min(5),
        owner: z.string().min(2).describe('A person from the Stakeholder Register'),
        trigger: z.string().min(5).describe('The early-warning sign'),
        costImpact: z.object({
          extraPoints: z.number().int().nonnegative().describe('Extra story points if it happens'),
          delaySprints: z.number().nonnegative().describe('Extra sprints if it happens'),
          directCostUsd: z.number().nonnegative().describe('Other cost if it happens'),
        }),
        existingRiskId: z.string().nullable().describe('R-xx of the Risk Register entry it updates'),
        source: z.enum(['analysis', 'discovery', 'dependency', 'assumption']),
      }),
    )
    .min(1)
    .max(15),
});
export type RiskAssessment = z.infer<typeof RiskAssessment>;

const kpi = z.enum([
  'dau',
  'd1_retention',
  'd7_retention',
  'd30_retention',
  'session_minutes',
  'payer_conversion',
  'rewarded_views_per_dau',
  'arpdau',
]);
const scenario = z.object({
  reach: z.number().min(0).max(1).describe('Share of players the feature reaches'),
  kpiChanges: z
    .array(
      z.object({
        kpi,
        change: z
          .number()
          .describe(
            'Retention in percentage points; session_minutes in minutes; everything else in % (relative)',
          ),
      }),
    )
    .max(4),
  rationale: z.string().min(10),
});
const wsjfScale = z
  .number()
  .int()
  .refine((n) => [1, 2, 3, 5, 8, 13, 20].includes(n), 'Use 1, 2, 3, 5, 8, 13 or 20');

export const ValueAssessment = z.object({
  primaryKpi: kpi,
  drivers: z.string().min(20).describe('How the feature creates value, in two or three sentences'),
  scenarios: z.object({ pessimistic: scenario, base: scenario, optimistic: scenario }),
  wsjf: z.object({
    businessValue: wsjfScale,
    timeCriticality: wsjfScale,
    riskReduction: wsjfScale,
    rationale: z.string().min(10),
  }),
  validation: z
    .string()
    .min(10)
    .describe('How to validate the value hypothesis cheaply before or during the build'),
  assumptions: z.array(z.string().min(5)),
});
export type ValueAssessment = z.infer<typeof ValueAssessment>;

// ---- pm-writer (BPMN 04) --------------------------------------------------------------------

const prose = (what: string, max = 1500) =>
  z
    .string()
    .min(40)
    .max(max)
    .describe(`${what}. Markdown paragraphs or "- " lists, no headings; numbers only as {{figure:key}}`);

const reqCodes = z.array(z.string().regex(/^REQ-(FR|NFR)-\d{3}$/)).min(1);

/** The writer's text for all documents of a feature, in one call; code renders tables and figures. */
export const DocumentDraft = z.object({
  brief: z.object({
    problem: prose('The problem or opportunity, in the client’s terms and with its evidence'),
    objectives: prose('What the feature should achieve and how success is judged'),
    expectedValue: prose('The expected value: scenarios, payback and what the value rests on'),
    scope: prose('Scope boundaries: what the first release includes, what comes later, what is out'),
    impact: prose('Effect on the project baseline: budget, current release, launch target, components'),
    recommendation: prose('The recommendation that follows from the verdict, and the decision needed'),
  }),
  requirements: z.object({
    userFlows: z
      .array(
        z.object({
          name: z.string().min(3).max(80),
          steps: z.array(z.string().min(3).max(300)).min(2).max(12),
          requirementCodes: reqCodes,
        }),
      )
      .min(1)
      .max(6)
      .describe('The main user flows, step by step from the player’s view'),
    businessRules: z
      .array(z.object({ rule: z.string().min(10).max(400), requirementCodes: reqCodes }))
      .max(20)
      .describe('Rules the system enforces (limits, eligibility, timing, rewards)'),
    acceptanceCriteria: z
      .array(
        z.object({
          requirementCode: z.string().regex(/^REQ-(FR|NFR)-\d{3}$/),
          criteria: z.array(z.string().min(10).max(400)).min(1).max(6),
        }),
      )
      .min(1)
      .describe('Testable criteria per requirement; every MVP requirement needs at least one'),
  }),
  estimation: z.object({
    sequencing: prose('The order of the work: spike first, MVP before later scope, blocking dependencies'),
    confidence: prose('How confident the forecast is, and the assumptions it rests on'),
  }),
  roadmap: prose('What the feature changes on the roadmap and what the Product Owner should decide')
    .nullable()
    .describe('Text for the roadmap proposal; null when the prompt says no proposal is needed'),
});
export type DocumentDraft = z.infer<typeof DocumentDraft>;

// ---- presenter (BPMN 05) ----------------------------------------------------------------------

const short = (max: number, what: string) => z.string().min(3).max(max).describe(what);

/** The wording of the three client slides; code fills in every number, range and chart. */
export const DeckDraft = z.object({
  opportunity: z.object({
    heading: short(90, 'Conclusion-style heading: why this matters for the business, no numbers'),
    objective: short(120, 'The primary business objective in one line'),
    audience: short(80, 'Who benefits, in plain words'),
  }),
  solution: z.object({
    heading: short(90, 'Conclusion-style heading: what the player gets'),
    flow: z.array(short(40, 'One step of the player flow, a few words')).min(3).max(5),
    capabilities: z
      .array(
        z.object({
          title: short(40, 'A core capability, a few words'),
          detail: short(90, 'One short line on what it does'),
          requirementCodes: z.array(z.string().regex(/^REQ-(FR|NFR)-\d{3}$/)).min(1),
        }),
      )
      .length(4),
    boundary: short(120, 'The one scope boundary that matters most: what is not in this release'),
  }),
  feasibility: z.object({
    heading: short(90, 'Conclusion-style heading on feasibility, consistent with the verdict'),
    dependencies: z
      .array(short(50, 'A key dependency: a system, integration or team, in a few words'))
      .max(3)
      .describe('Up to 3, blocking ones first; empty when there are none'),
    recommendation: short(
      260,
      'The suggested verdict in one or two sentences, consistent with the rules’ verdict and its conditions',
    ),
  }),
});
export type DeckDraft = z.infer<typeof DeckDraft>;

export const AGENT_SCHEMAS: Record<string, z.ZodType> = {
  DocumentDraft,
  DeckDraft,
  EstimationResult,
  RiskAssessment,
  ValueAssessment,
  ElicitationResult,
  DiscoveryReview,
  RequirementsAnalysis,
  ImpactAnalysis,
};
