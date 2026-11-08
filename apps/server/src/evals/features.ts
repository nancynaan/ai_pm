import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Answers, discoveryResultSchema, NOT_SURE, type Questionnaire } from '@ai-pm/shared';
import { parse } from 'yaml';
import { z } from 'zod';

/** The sample feature requests and their client answer profiles, from evals/features.yaml. */
export const FEATURES_FILE = fileURLToPath(new URL('../../../../evals/features.yaml', import.meta.url));

const featuresSchema = z.object({
  features: z.array(
    z.object({
      id: z.string(),
      expected: z.enum(['cosmetic', 'feature_extension', 'core_engine']),
      discovery: z.array(discoveryResultSchema).min(1),
      description: z.string(),
      answers: z.record(z.string(), z.array(z.string()).min(1)),
      details: z.record(z.string(), z.string()).optional(),
      /** Expectations for the assessment stage (Phase 4). */
      assessment: z
        .object({
          decision: z.array(z.enum(['go', 'go_with_conditions', 'no_go'])).optional(),
          preliminary: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
});
export type EvalFeature = z.infer<typeof featuresSchema>['features'][number];

export function loadEvalFeatures(file = FEATURES_FILE): EvalFeature[] {
  return featuresSchema.parse(parse(readFileSync(file, 'utf8'))).features;
}

/** `--only a,b` or `--only=a,b` from the command line; null means all. */
export function onlyArg(args: string[]): Set<string> | null {
  const flag = args.indexOf('--only');
  const only =
    args.find((a) => a.startsWith('--only='))?.slice(7) ?? (flag >= 0 ? args[flag + 1] : undefined);
  return only ? new Set(only.split(',')) : null;
}

/**
 * The client's answers to one questionnaire, like the eval's client: core questions from the
 * feature's profile, feature-specific and clarification questions with their first definite option.
 */
export function answersFor(q: Questionnaire, feature: EvalFeature): Answers {
  const answers = Object.fromEntries(
    q.questions.map((question) => [
      question.id,
      feature.answers[question.id] ?? [question.options.find((o) => o.value !== NOT_SURE)!.value],
    ]),
  );
  const ids = new Set(q.questions.map((x) => x.id));
  const details = Object.fromEntries(
    Object.entries(feature.details ?? {}).filter(([key]) => ids.has(key.split(':')[0]!)),
  );
  return { questionnaireId: q.id, answers, details };
}
