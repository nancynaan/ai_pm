import { type BacklogItemType, type EstimateItem, JIRA_PRIORITIES } from '@ai-pm/shared';
import { createHash } from 'node:crypto';
import type { BacklogDraft, DocumentDraft } from '../../agents/schemas.js';
import type { Figures } from '../documents/figures.js';
import type { DocumentInputs } from '../documents/inputs.js';
import { analysisSection, requirementLines } from '../stages/estimating.js';
import { clientRequest, section } from '../stages/prompts.js';

/**
 * Stage 06 (BPMN 06), the deterministic part: the backlog builder's prompt, the Definition of
 * Ready and coverage gates, proposed priorities and the Jira issues to write. Pure functions; the
 * stage reads the data and the writer talks to Jira.
 */

export interface BacklogInputs {
  docs: DocumentInputs;
  /** The Requirements Specification's text (user flows, rules, draft acceptance criteria). */
  specification: DocumentDraft['requirements'] | null;
  /** The current Jira backlog, for duplicate awareness. */
  existingBacklog: string;
  /** Published documents with their Confluence links. */
  documents: { title: string; url: string | null }[];
  briefUrl: string | null;
}

export interface IssuePlan {
  localId: string;
  type: BacklogItemType;
  summary: string;
  /** Proposed priority, pending the Product Owner's review. */
  priority: (typeof JIRA_PRIORITIES)[number];
  aiEstimate: number | null;
  requirementCodes: string[];
  blockedBy: string[];
  /** Markdown; the writer turns it into ADF. */
  description: string;
  labels: string[];
  /** Label unique to this issue, to find it again without the sync log. */
  marker: string;
  components: string[];
}

export interface BacklogPlan {
  epic: IssuePlan;
  stories: IssuePlan[];
}

export const AI_DRAFT_LABEL = 'ai-draft';
export const epicMarker = (runId: string) => `aipm-run-${runId}`;
export const storyMarker = (runId: string, ref: string) => `aipm-run-${runId}-${ref.toLowerCase()}`;

const MOSCOW_LEVEL: Record<string, number> = { must: 3, should: 2, could: 1, wont: 0 };
// JIRA_PRIORITIES runs Highest → Lowest; level 4 is Highest.
const priorityAt = (level: number) => JIRA_PRIORITIES[4 - Math.max(0, Math.min(4, level))]!;

/**
 * Proposed priority: the strongest MoSCoW of the requirements an item covers (Must → High,
 * Should → Medium, Could → Low, Won't → Lowest; none → Medium), one step up for a starting
 * point: an item others wait for that waits for nothing itself. The Product Owner reviews it.
 */
export function proposePriority(moscows: string[], startingPoint: boolean) {
  const levels = moscows.map((m) => MOSCOW_LEVEL[m] ?? 2);
  const base = levels.length ? Math.max(...levels) : 2;
  return priorityAt(base + (startingPoint ? 1 : 0));
}

/** PERT expected points, one decimal: what the forecast used for the item. */
export const aiEstimate = (item: Pick<EstimateItem, 'mean'>) => Math.round(item.mean * 10) / 10;

/** Requirements no story covers. Won't-have requirements are out of scope and need none. */
export function coverageGaps(inputs: Pick<BacklogInputs, 'docs'>): string[] {
  const covered = new Set(inputs.docs.assessment.storyMap.items.flatMap((i) => i.requirementCodes));
  return inputs.docs.analysis.requirements
    .filter((r) => r.moscow !== 'wont' && !covered.has(r.code))
    .map((r) => r.code);
}

/** A cycle in `blockedBy`, as refs, or null. */
export function findCycle(stories: { ref: string; blockedBy: string[] }[]): string[] | null {
  const deps = new Map(stories.map((s) => [s.ref, s.blockedBy]));
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const visit = (ref: string): string[] | null => {
    if (state.get(ref) === 'done') return null;
    if (state.get(ref) === 'visiting') return [...path.slice(path.indexOf(ref)), ref];
    state.set(ref, 'visiting');
    path.push(ref);
    for (const next of deps.get(ref) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(ref, 'done');
    return null;
  };
  for (const ref of deps.keys()) {
    const cycle = visit(ref);
    if (cycle) return cycle;
  }
  return null;
}

// Any role: "As a player", "As the Product Owner", "As QA".
const CONNEXTRA = /^As\s+\S.*?,\s*I want\s.+?,?\s*so that\s.+/is;
const FORBIDDEN = [
  { pattern: /story[ -]?points?\b/i, what: 'story points' },
  { pattern: /\b\d+(\.\d+)?\s?SP\b/, what: 'story points' },
  { pattern: /\bsprint\s?\d+/i, what: 'a sprint' },
];

/**
 * The Definition of Ready for the draft (problems go back to the agent): one story per
 * story-map item, the Connextra form, known blockers without cycles, unique summaries, and no
 * sizes, sprints or priorities typed into the text.
 */
export function checkBacklogDraft(draft: BacklogDraft, items: Pick<EstimateItem, 'ref'>[]): string[] {
  const problems: string[] = [];
  const refs = new Set(items.map((i) => i.ref));
  const seen = new Set<string>();
  for (const story of draft.stories) {
    if (!refs.has(story.ref)) problems.push(`${story.ref} is not in the story map`);
    if (seen.has(story.ref)) problems.push(`${story.ref} appears more than once`);
    seen.add(story.ref);
  }
  for (const ref of refs) if (!seen.has(ref)) problems.push(`${ref} has no story`);

  const summaries = new Map<string, string>();
  for (const story of draft.stories) {
    const key = story.summary.trim().toLowerCase();
    if (summaries.has(key)) problems.push(`${story.ref} has the same summary as ${summaries.get(key)}`);
    summaries.set(key, story.ref);
    if (!CONNEXTRA.test(story.userStory.trim()))
      problems.push(`${story.ref}: userStory must read "As a <role>, I want <goal>, so that <benefit>."`);
    for (const blocker of story.blockedBy) {
      if (blocker === story.ref) problems.push(`${story.ref} cannot block itself`);
      else if (!refs.has(blocker)) problems.push(`${story.ref} is blocked by unknown ${blocker}`);
    }
    const text = [
      story.summary,
      story.userStory,
      story.context,
      ...story.openQuestions,
      ...story.acceptanceCriteria.flatMap((c) => [c.scenario, ...c.given, ...c.when, ...c.then]),
    ].join('\n');
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(text))
        problems.push(`${story.ref} mentions ${what}; the pipeline engine sets sizes and plans`);
    }
  }
  const cycle = findCycle(draft.stories);
  if (cycle) problems.push(`blockedBy has a cycle: ${cycle.join(' → ')}`);
  return problems;
}

/** The backlog builder's prompt. No sizes or money: the agent writes text only. */
export function builderPrompt(inputs: BacklogInputs): string {
  const { docs, specification } = inputs;
  const items = docs.assessment.storyMap.items
    .map(
      (i) =>
        `- ${i.ref} [${i.type}, ${i.release}, ${i.discipline}] ${i.title} (${i.requirementCodes.join(', ') || 'no REQ'})`,
    )
    .join('\n');
  const spec = specification
    ? [
        section(
          'User flows (Requirements Specification)',
          specification.userFlows
            .map(
              (f) =>
                `${f.name} (${f.requirementCodes.join(', ')}):\n${f.steps.map((s, n) => `${n + 1}. ${s}`).join('\n')}`,
            )
            .join('\n\n'),
        ),
        section(
          'Business rules (Requirements Specification)',
          specification.businessRules
            .map((r) => `- ${r.rule} (${r.requirementCodes.join(', ')})`)
            .join('\n') || '(none)',
        ),
        section(
          'Draft acceptance criteria per requirement (Requirements Specification)',
          specification.acceptanceCriteria
            .map((a) => `${a.requirementCode}:\n${a.criteria.map((c) => `- ${c}`).join('\n')}`)
            .join('\n\n'),
        ),
      ]
    : [section('Requirements Specification', '(not published; write the criteria from the requirements)')];

  return [
    section('Feature request from the client', clientRequest(docs.run.description)),
    section('Feature', `${docs.featureName} (FA-${docs.faNumber}), approved by the client.`),
    section('Analyzed requirements', requirementLines(docs.analysis)),
    section('Analysis', analysisSection(docs.analysis)),
    section('Story map (one story per item, same refs, same order)', items),
    ...spec,
    section('Current Jira backlog (for references and duplicates)', inputs.existingBacklog),
    section(
      'Task',
      'Write the Epic text and exactly one story per story-map item, following the skills. Return BacklogDraft.',
    ),
  ].join('\n\n');
}

export const builderHash = (prompt: string, version: string) =>
  createHash('sha256').update(version).update(prompt).digest('hex');

// ---- issue descriptions ----------------------------------------------------------------------

/** Agent text inside a Gherkin fence must not close it. */
const fenceSafe = (text: string) => text.replaceAll('```', "'''").replace(/\s+/g, ' ').trim();

export function gherkin(criteria: BacklogDraft['stories'][number]['acceptanceCriteria']): string {
  const steps = (keyword: string, lines: string[]) =>
    lines.map(
      (line, n) =>
        `    ${n === 0 ? keyword : 'And'} ${fenceSafe(line).replace(/^(Given|When|Then|And)\s+/i, '')}`,
    );
  return criteria
    .map((c) =>
      [
        `  Scenario: ${fenceSafe(c.scenario)}`,
        ...steps('Given', c.given),
        ...steps('When', c.when),
        ...steps('Then', c.then),
      ].join('\n'),
    )
    .join('\n\n');
}

const KIND: Record<EstimateItem['type'], BacklogItemType> = {
  story: 'story',
  enabler: 'enabler',
  nfr: 'nfr',
  spike: 'spike',
};

const draftNotice = (fa: string, priority: string, epic: boolean) =>
  `**AI draft, pending Product Owner review.** Generated by the AI PM pipeline after the client approved ${fa}. It is part of the Product Backlog, not a sprint plan: nothing is assigned to a sprint. ${
    epic
      ? `Proposed priority **${priority}**, pending PO review.`
      : `Proposed priority **${priority}**, pending PO review. Story Points are left for the team; the AI's expected size is in "AI estimate (SP)".`
  }`;

/** The Epic and the stories as they go to Jira; priorities, estimates and labels come from code. */
export function buildBacklogPlan(inputs: BacklogInputs, draft: BacklogDraft, figures: Figures): BacklogPlan {
  const { docs } = inputs;
  const runId = docs.run.id;
  const fa = `FA-${docs.faNumber}`;
  const requirements = new Map(docs.analysis.requirements.map((r) => [r.code, r]));
  const items = docs.assessment.storyMap.items;
  const texts = new Map(draft.stories.map((s) => [s.ref, s]));
  const blockers = new Set(draft.stories.flatMap((s) => s.blockedBy));
  const common = ['ai-pm', AI_DRAFT_LABEL, `fa-${docs.faNumber}`];

  const stories: IssuePlan[] = items.map((item) => {
    const text = texts.get(item.ref)!;
    const type = KIND[item.type];
    const priority = proposePriority(
      item.requirementCodes.map((c) => requirements.get(c)?.moscow ?? 'should'),
      blockers.has(item.ref) && text.blockedBy.length === 0,
    );
    const reqs = item.requirementCodes.map((c) => `- ${c} ${requirements.get(c)?.title ?? ''}`.trimEnd());
    const blockedBy = text.blockedBy.map((ref) => `- Blocked by ${ref}: ${texts.get(ref)?.summary ?? ref}`);
    const description = [
      draftNotice(fa, priority, false),
      '## User story',
      text.userStory.trim(),
      '## Context',
      text.context.trim(),
      '## Acceptance criteria',
      '```gherkin\n' + `Feature: ${fenceSafe(text.summary)}\n\n${gherkin(text.acceptanceCriteria)}\n` + '```',
      '## Requirements',
      reqs.join('\n') || 'None named in the story map.',
      '## Dependencies',
      blockedBy.join('\n') || 'None inside this feature.',
      ...(text.openQuestions.length
        ? ['## Open questions for Backlog Refinement', text.openQuestions.map((q) => `- ${q}`).join('\n')]
        : []),
      '## Source',
      `${fa} story map item ${item.ref} (${item.discipline.replace('_', '/')}).${inputs.briefUrl ? ` Feature Brief: ${inputs.briefUrl}` : ''}`,
    ].join('\n\n');
    return {
      localId: item.ref,
      type,
      summary: text.summary.trim(),
      priority,
      aiEstimate: aiEstimate(item),
      requirementCodes: item.requirementCodes,
      blockedBy: text.blockedBy,
      description,
      labels: [...common, ...(type === 'story' ? [] : [type]), storyMarker(runId, item.ref)],
      marker: storyMarker(runId, item.ref),
      components: [],
    };
  });

  const mvp = docs.analysis.requirements.filter((r) => r.inMvp);
  const epicPriority = proposePriority(
    (mvp.length ? mvp : docs.analysis.requirements).map((r) => r.moscow),
    false,
  );
  const out = docs.analysis.requirements.filter((r) => r.moscow === 'wont');
  const a = docs.assessment;
  const description = [
    draftNotice(fa, epicPriority, true),
    '## Overview',
    draft.epic.overview.trim(),
    '## Outcome',
    draft.epic.outcome.trim(),
    '## Scope',
    stories.map((s) => `- ${s.localId} ${s.summary}`).join('\n'),
    ...(out.length ? [`Out of scope: ${out.map((r) => `${r.code} ${r.title}`).join('; ')}.`] : []),
    '## Assessment (preliminary)',
    [
      `- Verdict: ${figures.verdict}${a.preliminary ? ' (preliminary)' : ''}`,
      `- MVP delivery: ${figures['forecast.mvp.date.p50']} to ${figures['forecast.mvp.date.p85']} (P50 to P85)`,
      `- Full scope: ${figures['forecast.full.date.p50']} to ${figures['forecast.full.date.p85']} (P50 to P85)`,
      `- Budget: ${figures['budget.total.p50']} to ${figures['budget.total.p85']} (P50 to P85)`,
      '- An AI-assisted assessment, not a delivery commitment: the team re-estimates the stories in Backlog Refinement.',
    ].join('\n'),
    '## Documents',
    inputs.documents
      .filter((d) => d.url)
      .map((d) => `- [${d.title}](${d.url})`)
      .join('\n') || 'The documents are not in Confluence yet.',
  ].join('\n\n');

  return {
    epic: {
      localId: 'EPIC',
      type: 'epic',
      summary: docs.featureName,
      priority: epicPriority,
      aiEstimate: null,
      requirementCodes: mvp.map((r) => r.code),
      blockedBy: [],
      description,
      labels: [...common, epicMarker(runId)],
      marker: epicMarker(runId),
      components: docs.analysis.impacts.filter((i) => i.level !== 'none').map((i) => i.component),
    },
    stories,
  };
}
