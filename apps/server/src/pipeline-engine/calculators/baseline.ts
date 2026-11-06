import type { Assessment } from '@ai-pm/shared';

/**
 * The feature's effect on the approved project baseline (Charter budget, roadmap), for the
 * Feature Brief and the roadmap proposal. Pure functions; documents print what they return.
 */

export interface BaselineImpact {
  /** Approved budget minus what is spent. */
  remainingUsd: number;
  /** What is left once this feature is paid at P85. */
  remainingAfterUsd: number;
  /** The feature's P85 cost as a share of the remaining budget; null when nothing is left. */
  shareOfRemaining: number | null;
}

export function baselineImpact(input: {
  approvedBudgetUsd: number;
  spentToDateUsd: number;
  featureCostP85Usd: number;
}): BaselineImpact {
  const remainingUsd = input.approvedBudgetUsd - input.spentToDateUsd;
  return {
    remainingUsd,
    remainingAfterUsd: remainingUsd - input.featureCostP85Usd,
    shareOfRemaining: remainingUsd > 0 ? input.featureCostP85Usd / remainingUsd : null,
  };
}

/** A roadmap proposal is needed when the feature delays a committed release or the launch target. */
export const needsRoadmapProposal = (impact: Assessment['roadmapImpact']) =>
  impact.delaySprints > 0 || impact.launchAtRisk;

/**
 * A KPI's value after a scenario's change, for the client's KPI impact chart: `%` is a relative
 * change, `pts` adds percentage points to a ratio, `min` adds minutes.
 */
export function kpiAfterChange(baseline: number, change: number, unit: string): number {
  if (unit === '%') return baseline * (1 + change / 100);
  if (unit === 'pts') return baseline + change / 100;
  return baseline + change;
}
