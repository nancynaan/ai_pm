import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { discoveryAreaSchema, type Question } from '@ai-pm/shared';
import { parse } from 'yaml';
import { z } from 'zod';

/** The discovery questionnaire and its completeness rules, from config/discovery.yaml. */
export const DISCOVERY_CONFIG_FILE = fileURLToPath(
  new URL('../../../../config/discovery.yaml', import.meta.url),
);

const value = z.string().regex(/^[a-z0-9_]+$/);

// Strict: in a YAML flow mapping an unquoted comma splits a label into a stray key, which must fail.
const configOption = z.strictObject({
  value,
  label: z.string().min(1),
  exclusive: z.boolean().optional(),
  excludes: z.array(value).optional(),
  detail: z.string().optional(),
  detailRequired: z.boolean().optional(),
  unknown: z.boolean().optional(),
  evidence: z.enum(['strong', 'weak', 'none']).optional(),
  approval: z.enum(['full', 'scope_only', 'none']).optional(),
});
export type ConfigOption = z.infer<typeof configOption>;

const configQuestion = z.object({
  id: value,
  section: discoveryAreaSchema,
  text: z.string().min(5),
  kind: z.enum(['single', 'multi']),
  maxSelections: z.number().int().positive().optional(),
  why: z.string(),
  /** What a known answer is: a confirmed fact, or the client's own expectation (a hypothesis). */
  infoKind: z.enum(['confirmed', 'client_assumption']),
  /** Short name used in findings ("Expected outcome: …"). */
  label: z.string(),
  options: z.array(configOption).min(2),
  whenUnknown: z.object({ gap: z.string(), assumption: z.string() }).optional(),
});
export type ConfigQuestion = z.infer<typeof configQuestion>;

const condition = z
  .object({ question: value, anyOf: z.array(value).optional(), noneOf: z.array(value).optional() })
  .refine((c) => c.anyOf || c.noneOf, 'A condition needs anyOf or noneOf');

const rule = z
  .object({
    id: value,
    severity: z.enum(['blocking', 'warning']),
    when: z.array(condition).min(1),
    message: z.string(),
    clarify: z
      .object({
        text: z.string(),
        options: z
          .array(
            configOption
              .pick({ value: true, label: true, detail: true })
              // "question:option": the clarification's detail also answers that core detail.
              .extend({
                fillsDetail: z
                  .string()
                  .regex(/^[a-z0-9_]+:[a-z0-9_]+$/)
                  .optional(),
              }),
          )
          .min(2),
      })
      .optional(),
  })
  .refine((r) => r.severity === 'warning' || r.clarify, 'A blocking rule needs a clarification question');
export type DiscoveryRule = z.infer<typeof rule>;

/** Questions the harness reads by id. */
const REQUIRED_QUESTIONS = ['evidence', 'approval'];

const configSchema = z
  .object({
    maxRounds: z.number().int().min(1).max(4),
    maxClarifications: z.number().int().min(1).max(6),
    maxFeatureQuestions: z.number().int().min(0).max(4),
    sections: z
      .array(
        z.object({
          id: discoveryAreaSchema,
          title: z.string(),
          description: z.string().optional(),
          criticalWhenMissing: z.boolean().optional(),
        }),
      )
      .min(1),
    questions: z.array(configQuestion).min(1),
    rules: z.array(rule),
  })
  .superRefine((config, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const byId = new Map(config.questions.map((q) => [q.id, q]));
    if (byId.size !== config.questions.length) issue('Question ids must be unique');
    for (const id of REQUIRED_QUESTIONS) if (!byId.has(id)) issue(`Question "${id}" is required`);
    for (const q of config.questions) {
      const values = new Set(q.options.map((o) => o.value));
      if (values.size !== q.options.length) issue(`${q.id}: option values must be unique`);
      for (const o of q.options)
        for (const x of o.excludes ?? [])
          if (!values.has(x)) issue(`${q.id}.${o.value} excludes unknown "${x}"`);
      if (q.options.some((o) => o.unknown) && !q.whenUnknown) issue(`${q.id}: needs whenUnknown`);
      if (q.kind === 'single' && q.maxSelections) issue(`${q.id}: single choice takes no maxSelections`);
    }
    for (const id of config.sections.map((s) => s.id))
      if (!config.questions.some((q) => q.section === id)) issue(`Section ${id} has no questions`);
    for (const r of config.rules) {
      for (const c of r.when) {
        const q = byId.get(c.question);
        if (!q) {
          issue(`Rule ${r.id}: unknown question "${c.question}"`);
          continue;
        }
        for (const v of [...(c.anyOf ?? []), ...(c.noneOf ?? [])])
          if (!q.options.some((o) => o.value === v))
            issue(`Rule ${r.id}: ${c.question} has no option "${v}"`);
      }
      for (const o of r.clarify?.options ?? []) {
        if (!o.fillsDetail) continue;
        const [qid, value] = o.fillsDetail.split(':');
        if (!byId.get(qid!)?.options.some((x) => x.value === value && x.detail))
          issue(`Rule ${r.id}: fillsDetail "${o.fillsDetail}" names no option with a detail`);
      }
    }
  });
export type DiscoveryConfig = z.infer<typeof configSchema>;

export function parseDiscoveryConfig(yaml: string): DiscoveryConfig {
  return configSchema.parse(parse(yaml));
}

export function loadDiscoveryConfig(file = DISCOVERY_CONFIG_FILE): DiscoveryConfig {
  return parseDiscoveryConfig(readFileSync(file, 'utf8'));
}

/** The client sees labels, exclusivity and detail prompts; evidence and approval tags stay on the server. */
export function toUiQuestion(q: ConfigQuestion): Question {
  return {
    id: q.id,
    text: q.text,
    kind: q.kind,
    section: q.section,
    why: q.why,
    ...(q.maxSelections ? { maxSelections: q.maxSelections } : {}),
    options: q.options.map((o) => ({
      value: o.value,
      label: o.label,
      ...(o.exclusive ? { exclusive: true } : {}),
      ...(o.excludes ? { excludes: o.excludes } : {}),
      ...(o.detail ? { detail: o.detail } : {}),
    })),
  };
}
