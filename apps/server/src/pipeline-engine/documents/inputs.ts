import type { AnsweredQuestionnaire, Assessment, DiscoveryReport } from '@ai-pm/shared';
import type { SeedData } from '../../baseline/seed-data.js';
import type { StoredAnalysis } from '../analysis-repository.js';

/**
 * Everything the documents are built from, read from the pipeline DB (single source of truth).
 * Code renders every table and figure from this; the writer only adds text.
 */
export interface DocumentInputs {
  run: { id: string; title: string; description: string };
  /** FA-<n> in the page titles. */
  faNumber: number;
  /** The Epic title from intake, else the run title. */
  featureName: string;
  epicKey: string | null;
  /** The elicitation agent's restatement at intake. */
  restatement: string | null;
  assessment: Assessment;
  analysis: StoredAnalysis;
  report: DiscoveryReport | null;
  answered: AnsweredQuestionnaire[];
  assumptions: { text: string; kind: string; source: string; owner: string | null; status: string }[];
  constraints: { type: string; text: string }[];
  decisions: { gate: string; decision: string; comment: string | null; decidedAt: string }[];
  baseline: {
    projectName: string;
    financials: SeedData['kpis']['financials'];
    roadmap: SeedData['roadmap'];
  };
}

/** The answer labels the client chose for a discovery question, with any details. */
export function answerLabels(inputs: Pick<DocumentInputs, 'answered'>, questionId: string): string[] {
  for (const q of [...inputs.answered].reverse()) {
    const values = q.answers[questionId];
    const question = q.questions.find((x) => x.id === questionId);
    if (!values || !question) continue;
    return values.map((value) => {
      const label = question.options.find((o) => o.value === value)?.label ?? value;
      const detail = q.details?.[`${questionId}:${value}`];
      return detail ? `${label} (${detail})` : label;
    });
  }
  return [];
}
