import { type AnsweredQuestionnaire, NOT_SURE, type Question } from '@ai-pm/shared';
import type { questionOut } from '../../agents/schemas.js';
import type { z } from 'zod';

/** The client's own words, fenced so agents treat them as data. */
export const clientRequest = (description: string) =>
  `<client_request>\n${description.replaceAll('</client_request>', '')}\n</client_request>`;

const NOT_SURE_OPTION = { value: NOT_SURE, label: 'Not sure, let the team recommend' };

/**
 * Agent questions → UI questions: ids prefixed (so they never collide with the discovery
 * questions), made unique, and "not sure" added to every question.
 */
export function toQuestions(
  questions: z.infer<typeof questionOut>[],
  { prefix = '', section }: { prefix?: string; section?: string } = {},
): Question[] {
  const seen = new Set<string>();
  return questions.map((q) => {
    const base = `${prefix}${q.id}`;
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}_${n}`;
    seen.add(id);
    const options = q.options.filter((o) => o.value !== NOT_SURE);
    return {
      id,
      text: q.text,
      kind: q.kind,
      why: q.why,
      ...(section ? { section } : {}),
      options: [...options, NOT_SURE_OPTION],
    };
  });
}

/** Question and answer pairs in plain text, with details, "not sure" spelled out, and comments. */
export function transcript(answered: AnsweredQuestionnaire[]): string {
  return answered
    .flatMap((questionnaire) => [
      ...questionnaire.questions.map((q) => {
        const labels = (questionnaire.answers[q.id] ?? []).map((value) => {
          if (value === NOT_SURE) return 'Not sure';
          const label = q.options.find((o) => o.value === value)?.label ?? value;
          const detail = questionnaire.details?.[`${q.id}:${value}`];
          return detail ? `${label} (${detail})` : label;
        });
        return `Q (${q.id}): ${q.text}\nA: ${labels.join('; ') || '(no answer)'}`;
      }),
      ...(questionnaire.comment
        ? [`Additional comments (round ${questionnaire.round}): ${questionnaire.comment}`]
        : []),
    ])
    .join('\n\n');
}

export const section = (title: string, body: string) => `# ${title}\n\n${body.trim()}`;
