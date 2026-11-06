import type { DocumentDraft } from '../../agents/schemas.js';
import { buildFigures, figureKeys, type Figures } from './figures.js';
import type { DocumentInputs } from './inputs.js';
import type { RenderedDocument } from './render.js';

/**
 * The document validator (BPMN 04). Draft checks go back to the writer through the runner's
 * repair loop (at most two repairs); rendered checks guard the published result.
 */

const WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  twenty: '20',
  thirty: '30',
  fifty: '50',
  hundred: '100',
};

/** Numbers as written in a text: digits, and number words turned into digits. */
export function numbersIn(text: string): string[] {
  const digits = [...text.matchAll(/(?<![\w.])\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(',', '.'));
  const words = [...text.toLowerCase().matchAll(/\b[a-z]+\b/g)]
    .map((m) => WORDS[m[0]])
    .filter(Boolean) as string[];
  return [...digits, ...words];
}

/**
 * Numbers the writer may quote: what the client and the analysis stated (a 4-hour cooldown,
 * 60 FPS). Computed figures are not in here; the writer must cite those as {{figure:key}}.
 */
export function sourceNumbers(inputs: DocumentInputs): Set<string> {
  const a = inputs.analysis;
  const texts = [
    inputs.run.description,
    inputs.restatement ?? '',
    ...inputs.answered.flatMap((q) => [
      ...Object.values(q.details ?? {}),
      q.comment ?? '',
      ...q.questions.flatMap((question) =>
        (q.answers[question.id] ?? []).map((v) => question.options.find((o) => o.value === v)?.label ?? v),
      ),
    ]),
    ...a.requirements.flatMap((r) => [r.title, r.description]),
    ...a.conflicts.map((c) => c.description),
    ...a.impacts.map((i) => i.rationale),
    ...a.dependencies.map((d) => d.description),
    a.mvpSummary,
    a.magnitudeReason,
    a.spike.question ?? '',
    ...a.performanceRisks,
    ...inputs.constraints.map((c) => c.text),
    ...inputs.assumptions.map((x) => x.text),
    ...inputs.assessment.risks.flatMap((r) => [r.title, r.cause, r.event, r.effect, r.response, r.trigger]),
    ...(inputs.report?.gaps.map((g) => g.text) ?? []),
  ];
  // ISO/IEC 25010 is the quality model the requirements cite.
  return new Set(['25010', ...texts.flatMap(numbersIn)]);
}

/** Numbers in writer text that are neither a {{figure:key}}, an identifier nor a list marker. */
export function strayNumbers(text: string, allowed: Set<string>): string[] {
  const cleaned = text
    .replace(/\{\{figure:[a-z0-9_.]+\}\}/g, ' ')
    .replace(/^\s*\d+[.)]\s/gm, ' ')
    // Identifiers: REQ-FR-001, R-02, FA1-R3, D7, P85, R2, 2D, iOS17, BR-01.
    .replace(/\b[\w-]*[A-Za-z][\w-]*\d[\w-]*\b|\b\d+[A-Za-z][\w-]*\b/g, ' ');
  return numbersIn(cleaned).filter((n) => !allowed.has(n));
}

export interface DraftCheckContext {
  figures: Figures;
  requirementCodes: Set<string>;
  mvpCodes: string[];
  allowedNumbers: Set<string>;
  roadmapNeeded: boolean;
}

export function draftCheckContext(inputs: DocumentInputs, roadmapNeeded: boolean): DraftCheckContext {
  const reqs = inputs.analysis.requirements;
  return {
    figures: buildFigures(inputs),
    requirementCodes: new Set(reqs.map((r) => r.code)),
    mvpCodes: reqs.filter((r) => r.inMvp).map((r) => r.code),
    allowedNumbers: sourceNumbers(inputs),
    roadmapNeeded,
  };
}

/** Problems in the writer's draft, phrased for the repair prompt. */
export function checkDraft(draft: DocumentDraft, ctx: DraftCheckContext): string[] {
  const problems: string[] = [];
  const texts: [string, string][] = [
    ['brief.problem', draft.brief.problem],
    ['brief.objectives', draft.brief.objectives],
    ['brief.expectedValue', draft.brief.expectedValue],
    ['brief.scope', draft.brief.scope],
    ['brief.impact', draft.brief.impact],
    ['brief.recommendation', draft.brief.recommendation],
    ['estimation.sequencing', draft.estimation.sequencing],
    ['estimation.confidence', draft.estimation.confidence],
    ...(draft.roadmap ? [['roadmap', draft.roadmap] as [string, string]] : []),
    ...draft.requirements.userFlows.flatMap((f, i) =>
      [f.name, ...f.steps].map((t) => [`requirements.userFlows[${i}]`, t] as [string, string]),
    ),
    ...draft.requirements.businessRules.map(
      (r, i) => [`requirements.businessRules[${i}]`, r.rule] as [string, string],
    ),
    ...draft.requirements.acceptanceCriteria.flatMap((c) =>
      c.criteria.map((t) => [`acceptanceCriteria ${c.requirementCode}`, t] as [string, string]),
    ),
  ];

  for (const [where, text] of texts) {
    for (const key of figureKeys(text))
      if (!(key in ctx.figures)) problems.push(`${where}: {{figure:${key}}} is not in the figure list.`);
    const other = text.match(/\{\{(?!figure:)[^}]*\}\}/g);
    if (other)
      problems.push(`${where}: only {{figure:key}} placeholders are allowed, not ${other.join(', ')}.`);
    if (/^\s{0,3}#{1,6}\s/m.test(text)) problems.push(`${where}: no headings inside a text slot.`);
    const stray = [...new Set(strayNumbers(text, ctx.allowedNumbers))];
    if (stray.length)
      problems.push(
        `${where}: the numbers ${stray.join(', ')} are not stated by the client or the requirements; cite computed values as {{figure:key}} or describe them in words.`,
      );
  }

  const cited = [
    ...draft.requirements.userFlows.flatMap((f) => f.requirementCodes),
    ...draft.requirements.businessRules.flatMap((r) => r.requirementCodes),
    ...draft.requirements.acceptanceCriteria.map((c) => c.requirementCode),
  ];
  const unknown = [...new Set(cited.filter((c) => !ctx.requirementCodes.has(c)))];
  if (unknown.length)
    problems.push(
      `Unknown requirement codes: ${unknown.join(', ')}. Use only codes from the requirements list.`,
    );
  const covered = new Set(draft.requirements.acceptanceCriteria.map((c) => c.requirementCode));
  const missing = ctx.mvpCodes.filter((c) => !covered.has(c));
  if (missing.length)
    problems.push(`Acceptance criteria are missing for the MVP requirements ${missing.join(', ')}.`);

  if (ctx.roadmapNeeded && !draft.roadmap)
    problems.push('roadmap: a Roadmap Update Proposal is needed; write its text.');
  if (!ctx.roadmapNeeded && draft.roadmap) problems.push('roadmap: no proposal is needed; return null.');
  return problems;
}

/**
 * Final checks on the rendered documents: no slot left unfilled, and every printed figure equal
 * to the value the DB gives now (single source of truth).
 */
export function checkRendered(docs: RenderedDocument[], inputs: DocumentInputs): string[] {
  const figures = buildFigures(inputs);
  const problems: string[] = [];
  for (const doc of docs.filter((d) => d.needed)) {
    const left = doc.markdown.match(/\{\{[^}]*\}\}/g);
    if (left) problems.push(`${doc.title}: unfilled slots ${[...new Set(left)].join(', ')}`);
    for (const [key, value] of Object.entries(doc.figures))
      if (figures[key] !== value)
        problems.push(`${doc.title}: figure ${key} is "${value}", the DB gives "${figures[key]}"`);
    if (!doc.storage.trim()) problems.push(`${doc.title}: empty page`);
  }
  return problems;
}
