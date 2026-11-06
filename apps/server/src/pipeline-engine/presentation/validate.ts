import type { DeckDraft } from '../../agents/schemas.js';
import { sourceNumbers, strayNumbers } from '../documents/validate.js';
import type { DeckInputs } from './deck.js';

/**
 * Checks on the presenter's wording, sent back through the repair loop: no computed numbers, no
 * story points, no retention promise without evidence, known REQ codes, and a recommendation
 * that agrees with the rules' verdict.
 */
export interface DeckCheckContext {
  allowedNumbers: Set<string>;
  requirementCodes: Set<string>;
  strongEvidence: boolean;
  decision: 'go' | 'go_with_conditions' | 'no_go';
  dependencies: number;
}

export const deckCheckContext = (inputs: DeckInputs): DeckCheckContext => ({
  allowedNumbers: sourceNumbers(inputs),
  requirementCodes: new Set(inputs.analysis.requirements.map((r) => r.code)),
  strongEvidence: inputs.assessment.inputs.evidence === 'strong',
  decision: inputs.assessment.verdict.decision,
  dependencies: inputs.analysis.dependencies.length,
});

const POINTS = /story[\s-]*points?|\bpoints?\b|\bvelocity\b|\bSP\b/i;
const HYPOTHESIS = /hypothes|validat|to be (tested|proven|confirmed)|not promised|expected to support/i;

export function checkDeckDraft(draft: DeckDraft, ctx: DeckCheckContext): string[] {
  const problems: string[] = [];
  const texts: [string, string][] = [
    ['opportunity.heading', draft.opportunity.heading],
    ['opportunity.objective', draft.opportunity.objective],
    ['opportunity.audience', draft.opportunity.audience],
    ['solution.heading', draft.solution.heading],
    ...draft.solution.flow.map((s, i) => [`solution.flow[${i}]`, s] as [string, string]),
    ...draft.solution.capabilities.flatMap((c, i) => [
      [`solution.capabilities[${i}].title`, c.title] as [string, string],
      [`solution.capabilities[${i}].detail`, c.detail] as [string, string],
    ]),
    ['solution.boundary', draft.solution.boundary],
    ['feasibility.heading', draft.feasibility.heading],
    ...draft.feasibility.dependencies.map(
      (d, i) => [`feasibility.dependencies[${i}]`, d] as [string, string],
    ),
    ['feasibility.recommendation', draft.feasibility.recommendation],
  ];
  for (const [where, text] of texts) {
    const stray = [...new Set(strayNumbers(text, ctx.allowedNumbers))];
    if (stray.length)
      problems.push(
        `${where}: remove the numbers ${stray.join(', ')}; the slides show computed values next to your text.`,
      );
    if (POINTS.test(text)) problems.push(`${where}: never mention story points or velocity to the client.`);
    if (/\{\{/.test(text)) problems.push(`${where}: no placeholders; write plain words.`);
    if (!ctx.strongEvidence && /retention/i.test(text) && !HYPOTHESIS.test(text))
      problems.push(
        `${where}: a retention effect without strong evidence is a hypothesis to validate, not a promise.`,
      );
  }

  const unknown = draft.solution.capabilities
    .flatMap((c) => c.requirementCodes)
    .filter((c) => !ctx.requirementCodes.has(c));
  if (unknown.length) problems.push(`Unknown requirement codes: ${[...new Set(unknown)].join(', ')}.`);
  if (draft.feasibility.dependencies.length > ctx.dependencies)
    problems.push(
      ctx.dependencies === 0
        ? 'feasibility.dependencies: the analysis found no dependencies; return an empty list.'
        : `feasibility.dependencies: the analysis found only ${ctx.dependencies}; do not invent more.`,
    );

  const rec = draft.feasibility.recommendation;
  if (ctx.decision === 'no_go' && !/\bnot\b|no-go|n't|against/i.test(rec))
    problems.push(
      'feasibility.recommendation: the verdict is No-Go; recommend not starting the feature in this form.',
    );
  if (ctx.decision === 'go_with_conditions' && !/subject to|condition|provided|once|\bif\b|after/i.test(rec))
    problems.push(
      'feasibility.recommendation: the verdict is Go with conditions; name the main condition ("subject to …").',
    );
  if (ctx.decision === 'go' && /no-go|do not (start|proceed)|not recommend/i.test(rec))
    problems.push('feasibility.recommendation: the verdict is Go; do not recommend against it.');
  return problems;
}
