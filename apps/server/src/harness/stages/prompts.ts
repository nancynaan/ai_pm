import { NOT_SURE, type Question, type Questionnaire } from '@ai-pm/shared';
import type { questionOut } from '../../agents/schemas.js';
import type { z } from 'zod';

/** The client's own words, fenced so agents treat them as data. */
export const clientRequest = (description: string) =>
  `<client_request>\n${description.replaceAll('</client_request>', '')}\n</client_request>`;

const NOT_SURE_OPTION = { value: NOT_SURE, label: 'Not sure, let the team recommend' };

/** Agent questions → UI questions: ids made unique, "not sure" added to every question. */
export function toQuestions(questions: z.infer<typeof questionOut>[]): Question[] {
  const seen = new Set<string>();
  return questions.map((q) => {
    let id = q.id;
    for (let n = 2; seen.has(id); n++) id = `${q.id}_${n}`;
    seen.add(id);
    const options = q.options.filter((o) => o.value !== NOT_SURE);
    return { id, text: q.text, kind: q.kind, why: q.why, options: [...options, NOT_SURE_OPTION] };
  });
}

/** Question and answer pairs in plain text, "not sure" spelled out. */
export function transcript(answered: (Questionnaire & { answers: Record<string, string[]> })[]): string {
  return answered
    .flatMap((questionnaire) =>
      questionnaire.questions.map((q) => {
        const labels = (questionnaire.answers[q.id] ?? []).map((value) =>
          value === NOT_SURE ? 'Not sure' : (q.options.find((o) => o.value === value)?.label ?? value),
        );
        return `Q (${q.id}): ${q.text}\nA: ${labels.join(', ') || '(no answer)'}`;
      }),
    )
    .join('\n\n');
}

export const section = (title: string, body: string) => `# ${title}\n\n${body.trim()}`;
