import type { AssessedRisk, Forecast, ValueScenario, Verdict } from '@ai-pm/shared';
import type { AssessmentConfig } from '../assessment-config.js';

/**
 * The feasibility verdict (plan §9). No-Go when even the MVP misses a hard deadline at P85, the
 * P85 budget is far over the limit, a critical risk is accepted without mitigation, or the value
 * does not cover the cost even in the optimistic case. Go with conditions when the plan only
 * holds under conditions. Otherwise Go. An incomplete discovery makes any verdict preliminary.
 */

export interface VerdictInput {
  config: AssessmentConfig['verdict'];
  deadline: { date: string | null; hard: boolean };
  forecast: { mvp: Forecast; full: Forecast };
  budget: { p85: number; limit: number; limitSource: 'client' | 'remaining_project_budget' };
  risks: AssessedRisk[];
  scenarios: ValueScenario[];
  spike: { needed: boolean; question?: string; timeboxDays?: number };
  blockingConflicts: string[];
  roadmap: { delaySprints: number; launchAtRisk: boolean; release: string | null };
  preliminary: { value: boolean; reasons: string[] };
  readiness: { canApprove: 'full' | 'scope_only' | 'none'; note: string } | null;
  /** The expected outcome rests on no or weak evidence. */
  unvalidatedOutcome: boolean;
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function decideVerdict(input: VerdictInput): Verdict {
  const noGo: string[] = [];
  const conditions: string[] = [];
  const reasons: string[] = [];
  const { forecast, deadline, budget } = input;
  const base = input.scenarios.find((s) => s.name === 'base');
  const optimistic = input.scenarios.find((s) => s.name === 'optimistic');

  // Schedule.
  if (deadline.hard && deadline.date) {
    const full = forecast.full.meetsDeadline;
    const mvp = forecast.mvp.meetsDeadline;
    if (full?.p85) reasons.push(`The full scope meets the ${deadline.date} deadline at P85.`);
    else if (mvp?.p85) {
      conditions.push(
        `Ship the MVP slice by ${deadline.date} (P85 ${forecast.mvp.dates.p85}); the rest follows after the deadline (full scope P85 ${forecast.full.dates.p85}).`,
      );
    } else if (mvp?.p50) {
      conditions.push(
        `The MVP meets ${deadline.date} only at P50 (${forecast.mvp.dates.p50}); add capacity or cut scope to raise confidence.`,
      );
    } else {
      noGo.push(
        `Even the MVP misses the hard deadline ${deadline.date} (MVP P85 ${forecast.mvp.dates.p85}).`,
      );
    }
  } else {
    reasons.push(`No hard deadline; the full scope is done by ${forecast.full.dates.p85} at P85.`);
  }

  // Budget.
  const limitName = budget.limitSource === 'client' ? 'the budget limit' : 'the remaining project budget';
  if (budget.p85 > budget.limit * input.config.budgetNoGoFactor) {
    noGo.push(
      `The P85 cost ${usd(budget.p85)} is more than ${input.config.budgetNoGoFactor}× ${limitName} (${usd(budget.limit)}).`,
    );
  } else if (budget.p85 > budget.limit) {
    conditions.push(
      `Approve ${usd(budget.p85 - budget.limit)} above ${limitName} (P85 cost ${usd(budget.p85)}).`,
    );
  } else {
    reasons.push(`The P85 cost ${usd(budget.p85)} fits ${limitName} (${usd(budget.limit)}).`);
  }

  // Risks.
  const unmitigatedCritical = input.risks.filter((r) => r.level === 'critical' && r.strategy === 'Accept');
  for (const r of unmitigatedCritical) noGo.push(`Critical risk ${r.id} "${r.title}" has no mitigation.`);
  const serious = input.risks.filter(
    (r) => (r.level === 'high' || r.level === 'critical') && r.strategy !== 'Accept',
  );
  if (serious.length) {
    conditions.push(
      `Put the responses to ${serious.map((r) => `${r.id} (${r.title})`).join(', ')} in place before or during the first sprint.`,
    );
  }

  // Value.
  if (optimistic && optimistic.roi < 0) {
    noGo.push(
      `The value does not cover the cost even in the optimistic case (ROI ${(optimistic.roi * 100).toFixed(0)} %).`,
    );
  } else if (base && base.roi < input.config.minBaseRoi) {
    conditions.push(
      `The base case does not pay back within the horizon (ROI ${(base.roi * 100).toFixed(0)} %); validate the effect on a small scale before the full build.`,
    );
  } else if (base) {
    reasons.push(`The base case returns ${(base.roi * 100).toFixed(0)} % (NPV ${usd(base.npvUsd)}).`);
  }
  if (input.unvalidatedOutcome) {
    conditions.push(
      'The expected outcome is an unvalidated hypothesis; measure it with an A/B test or a soft-launch cohort before scaling.',
    );
  }

  // Delivery.
  if (input.spike.needed) {
    conditions.push(
      `Run the technical spike first${input.spike.timeboxDays ? ` (${input.spike.timeboxDays} days)` : ''}${input.spike.question ? `: ${input.spike.question}` : ''}`,
    );
  }
  for (const c of input.blockingConflicts) conditions.push(`Resolve the blocking conflict: ${c}`);
  if (input.roadmap.delaySprints > 0 && input.roadmap.launchAtRisk) {
    conditions.push(
      `${input.roadmap.release ?? 'The current release'} slips by ${input.roadmap.delaySprints} sprint${input.roadmap.delaySprints === 1 ? '' : 's'} past its target; add capacity or start after it.`,
    );
  }
  if (input.readiness && input.readiness.canApprove !== 'full')
    conditions.push(`Sign-off needed: ${input.readiness.note}`);
  if (input.preliminary.value) {
    conditions.push(
      `Confirm the open discovery points (${input.preliminary.reasons.join('; ')}); the figures stay preliminary until then.`,
    );
  }
  // The team re-estimate (Planning Poker) is a standard next step for every verdict, shown on the
  // Analysis tab, not a condition: a clean assessment is a plain Go.
  const decision: Verdict['decision'] = noGo.length
    ? 'no_go'
    : conditions.length
      ? 'go_with_conditions'
      : 'go';
  const label = { go: 'Go', go_with_conditions: 'Go with conditions', no_go: 'No-Go' }[decision];
  return {
    decision,
    label: input.preliminary.value ? `${label} (preliminary)` : label,
    preliminary: input.preliminary.value,
    reasons: [...noGo, ...reasons],
    conditions,
  };
}
