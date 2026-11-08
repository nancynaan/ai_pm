import type { BacklogItem } from '@ai-pm/shared';
import type { BacklogDraft } from '../agents/schemas.js';
import { findCycle } from '../pipeline-engine/backlog/plan.js';

/**
 * Eval v2 graders, shared by the eval CLI and the end-to-end test. All of them are code: no
 * LLM judge. Each returns the problems it found; an empty list passes.
 */

/** In-scope requirements (everything but Won't) that no story in the written backlog covers. */
export function uncoveredRequirements(
  requirements: { code: string; moscow: string }[],
  stories: Pick<BacklogItem, 'requirementCodes'>[],
): string[] {
  const covered = new Set(stories.flatMap((s) => s.requirementCodes));
  return requirements.filter((r) => r.moscow !== 'wont' && !covered.has(r.code)).map((r) => r.code);
}

/** A story larger than this many points should be split before refinement. */
export const MAX_STORY_POINTS = 13;
const MAX_BLOCKERS = 3;

/**
 * INVEST lint for the AI draft: Independent (no cycle; a user story waits for at most three
 * others, while enablers, NFR and QA items may wait for more), Valuable ("so that"),
 * Estimable (an AI estimate), Small (at most 13 points), Testable (every scenario has a Then).
 * Negotiable is left to the Product Owner's review.
 */
export function investProblems(
  draft: BacklogDraft,
  items: Pick<BacklogItem, 'localId' | 'type' | 'summary' | 'aiEstimate'>[],
): string[] {
  const problems: string[] = [];
  const cycle = findCycle(draft.stories);
  if (cycle) problems.push(`Independent: blocker cycle ${cycle.join(' → ')}`);
  for (const story of draft.stories) {
    const at = `${story.ref} "${story.summary}"`;
    const userStory = items.find((i) => i.localId === story.ref)?.type === 'story';
    if (userStory && story.blockedBy.length > MAX_BLOCKERS)
      problems.push(`Independent: ${at} waits for ${story.blockedBy.length} stories`);
    if (!/\bso that\b/i.test(story.userStory)) problems.push(`Valuable: ${at} has no "so that"`);
    for (const scenario of story.acceptanceCriteria) {
      if (scenario.then.length === 0)
        problems.push(`Testable: ${at} scenario "${scenario.scenario}" has no Then`);
    }
  }
  for (const item of items) {
    if (item.aiEstimate === null) problems.push(`Estimable: "${item.summary}" has no AI estimate`);
    else if (item.aiEstimate > MAX_STORY_POINTS)
      problems.push(
        `Small: "${item.summary}" is ${item.aiEstimate} points (split above ${MAX_STORY_POINTS})`,
      );
  }
  return problems;
}
