import type { Deck, ValueScenario } from '@ai-pm/shared';
import type { DeckDraft } from '../../agents/schemas.js';
import { formatKpi } from '../../baseline/facts.js';
import type { SeedData } from '../../baseline/seed-data.js';
import { formatPercent, formatUsd } from '../../render/tables.js';
import { kpiAfterChange } from '../calculators/baseline.js';
import { answerLabels, type DocumentInputs } from '../documents/inputs.js';
import { requirementLines } from '../stages/estimating.js';
import { clientRequest, section, transcript } from '../stages/prompts.js';

/**
 * The client deck (BPMN 05): three slides. `deckFacts` computes everything numeric from the DB;
 * the presenter only words headings and labels. Delivery and budget are calendar and money
 * ranges (P50–P85), never story points, and every slide says the estimate is preliminary.
 */

export type KpiMetric = SeedData['kpis']['metrics'][number];
export interface DeckInputs extends DocumentInputs {
  kpis: KpiMetric[];
}

/** Client-friendly precision: two decimals for plain numbers, three for ratios (shown as %). */
const roundKpi = (v: number, unit: string) =>
  unit === 'ratio' ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100;

const RETENTION = new Set(['d1_retention', 'd7_retention', 'd30_retention']);
const LEVEL_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SCENARIOS = ['pessimistic', 'base', 'optimistic'] as const;

/** $100k, $1.2M */
export function compactUsd(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}k`;
  return `${sign}${formatUsd(a)}`;
}

/** 2027-01-24 → 24 Jan 2027 */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const dateRange = (from: string, to: string) =>
  from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`;

const change = (value: number, unit: string) => {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  const abs = Math.abs(value);
  return unit === '%' ? `${sign}${abs} %` : unit === 'pts' ? `${sign}${abs} pts` : `${sign}${abs} ${unit}`;
};

function kpiChange(s: ValueScenario | undefined, kpi: string) {
  const c = s?.kpiChanges.find((k) => k.kpi === kpi);
  return { value: c?.change ?? 0, unit: c?.unit ?? '%' };
}

/** The numbers on the slides, all from the DB (no wording). */
export function deckFacts(inputs: DeckInputs) {
  const a = inputs.assessment;
  const scenario = (name: (typeof SCENARIOS)[number]) => a.value.scenarios.find((s) => s.name === name);
  const base = scenario('base');
  const kpiKey = a.value.primaryKpi;
  const metric = inputs.kpis.find((m) => m.key === kpiKey);
  const changes = Object.fromEntries(SCENARIOS.map((n) => [n, kpiChange(scenario(n), kpiKey)])) as Record<
    (typeof SCENARIOS)[number],
    { value: number; unit: string }
  >;

  // The client's own target from the discovery answers ("a specific KPI target (…)").
  const target = answerLabels(inputs, 'success')
    .map((l) => /\((.+)\)$/.exec(l)?.[1])
    .find(Boolean);

  const bars = metric
    ? [
        { label: 'Today', value: metric.baseline },
        ...SCENARIOS.map((n) => ({
          label: n[0]!.toUpperCase() + n.slice(1),
          value: kpiAfterChange(metric.baseline, changes[n].value, changes[n].unit),
        })),
      ].map((b) => ({ ...b, display: formatKpi(metric.unit, roundKpi(b.value, metric.unit)) }))
    : [];

  const benefits = a.value.scenarios.map((s) => s.benefitUsd);
  const retentionClaimed =
    RETENTION.has(kpiKey) ||
    a.value.scenarios.some((s) => s.kpiChanges.some((k) => RETENTION.has(k.kpi) && k.change > 0));
  const strong = a.inputs.evidence === 'strong';

  const serious = a.risks.filter((r) => r.level === 'high' || r.level === 'critical');
  const topRisks = (serious.length ? serious : a.risks)
    .slice()
    .sort((x, y) => (LEVEL_ORDER[x.level] ?? 9) - (LEVEL_ORDER[y.level] ?? 9) || y.score - x.score)
    .slice(0, serious.length ? 3 : 2);

  const reqs = inputs.analysis.requirements;
  const exclusions = reqs.filter((r) => r.moscow === 'wont').length;
  const { mvp, full } = a.forecast;
  const sameScope = mvp.dates.p50 === full.dates.p50 && mvp.dates.p85 === full.dates.p85;

  return {
    kpiName: metric?.name ?? kpiKey,
    kpiBaseline: metric ? formatKpi(metric.unit, metric.baseline) : 'not in the KPI baseline',
    clientTarget: target ?? null,
    impact: {
      base: change(changes.base.value, changes.base.unit),
      range: `${change(changes.pessimistic.value, changes.pessimistic.unit)} to ${change(changes.optimistic.value, changes.optimistic.unit)}`,
    },
    reach: formatPercent(base?.reach ?? 0),
    value: {
      base: `${compactUsd(base?.benefitUsd ?? 0)} in ${a.value.horizonMonths} months`,
      range: `${compactUsd(Math.min(...benefits))} – ${compactUsd(Math.max(...benefits))} across scenarios`,
      payback: base?.paybackMonth
        ? `Payback in month ${base.paybackMonth} (base case)`
        : `No payback within ${a.value.horizonMonths} months (base case)`,
    },
    caution:
      retentionClaimed && !strong
        ? 'Retention effects are a hypothesis to validate after release; they are not promised.'
        : !strong
          ? `The expected effect rests on ${a.inputs.evidence === 'weak' ? 'limited' : 'no'} evidence; validate it with an A/B test before scaling.`
          : null,
    chart: { kpi: metric?.name ?? kpiKey, bars },
    counts: [
      {
        label: 'components affected',
        value: inputs.analysis.impacts.filter((i) => i.level !== 'none').length,
      },
      { label: 'functional requirements', value: reqs.filter((r) => r.type === 'functional').length },
      { label: 'user stories proposed', value: a.storyMap.items.filter((i) => i.type === 'story').length },
      { label: 'dependencies & integrations', value: inputs.analysis.dependencies.length },
      ...(exclusions ? [{ label: 'scope exclusions', value: exclusions }] : []),
    ],
    delivery: {
      range: `${sameScope ? 'Full scope' : 'MVP'} ${dateRange(mvp.dates.p50, mvp.dates.p85)}`,
      detail: `${sameScope ? '' : `Full scope ${dateRange(full.dates.p50, full.dates.p85)}. `}Forecast range at 50–85 % confidence, starting Sprint ${a.inputs.startSprint} with ${formatPercent(a.inputs.capacityShare)} of the team. A forecast, not a commitment.`,
    },
    budget: {
      range: `${compactUsd(a.budget.total.p50)} – ${compactUsd(a.budget.total.p85)}`,
      detail: `Preliminary estimate at 50–85 % confidence, including risk contingency; ${formatPercent(a.budget.limitUsage)} of ${a.inputs.budgetLimit.source === 'client' ? 'your budget limit' : 'the remaining project budget'} at the upper end.`,
    },
    risks: {
      items: topRisks.map((r) => ({ title: r.title, level: r.level })),
      note: serious.length ? null : 'No high or critical risks identified; the largest ones:',
    },
    verdict: {
      decision: a.verdict.decision,
      label: `${a.verdict.label}${a.preliminary ? ' (preliminary)' : ''}`,
    },
  };
}
export type DeckFacts = ReturnType<typeof deckFacts>;

export const DISCLAIMER =
  'Preliminary AI-assisted assessment, not a delivery commitment. The development team re-estimates scope and timing in Backlog Refinement.';

export function buildDeck(inputs: DeckInputs, draft: DeckDraft, version: string, createdAt: Date): Deck {
  const f = deckFacts(inputs);
  return {
    runId: inputs.run.id,
    version,
    feature: inputs.featureName,
    createdAt: createdAt.toISOString(),
    label: `Feature Proposal · ${inputs.featureName} · Version ${version}`,
    disclaimer: DISCLAIMER,
    opportunity: {
      heading: draft.opportunity.heading,
      objective: draft.opportunity.objective,
      targetKpi: { name: f.kpiName, baseline: f.kpiBaseline, clientTarget: f.clientTarget },
      impact: f.impact,
      audience: `${draft.opportunity.audience} (reach ${f.reach} of players)`,
      value: f.value,
      caution: f.caution,
      chart: f.chart,
    },
    solution: {
      heading: draft.solution.heading,
      flow: draft.solution.flow,
      capabilities: draft.solution.capabilities.map(({ title, detail }) => ({ title, detail })),
      counts: f.counts,
      boundary: draft.solution.boundary,
    },
    feasibility: {
      heading: draft.feasibility.heading,
      delivery: f.delivery,
      budget: f.budget,
      risks: f.risks,
      dependencies: draft.feasibility.dependencies,
      // The badge shows the verdict; a sentence that repeats it ("Go: …") starts after it.
      verdict: {
        ...f.verdict,
        sentence: draft.feasibility.recommendation.replace(/^(go with conditions|no-go|go)\s*[:–—-]\s*/i, ''),
      },
    },
  };
}

/** The presenter's prompt: the run's data and the figures the slides will show (no story points). */
export function presenterPrompt(inputs: DeckInputs): string {
  const a = inputs.assessment;
  const f = deckFacts(inputs);
  return [
    section('Feature request from the client', clientRequest(inputs.run.description)),
    section('Discovery answers', transcript(inputs.answered)),
    section('Analyzed requirements', requirementLines(inputs.analysis)),
    section(
      'Components and dependencies',
      [
        ...inputs.analysis.impacts
          .filter((i) => i.level !== 'none')
          .map((i) => `- ${i.component}: ${i.level}`),
        ...inputs.analysis.dependencies.map(
          (d) => `- dependency [${d.type}${d.blocking ? ', blocking' : ''}] ${d.target}: ${d.description}`,
        ),
      ].join('\n') || '(none)',
    ),
    section('Story map (titles only)', a.storyMap.items.map((i) => `- ${i.title} (${i.release})`).join('\n')),
    section('Risks', a.risks.map((r) => `- [${r.level}] ${r.title}`).join('\n') || '(none)'),
    section('Value rationale', a.value.scenarios.map((s) => `- ${s.name}: ${s.rationale}`).join('\n')),
    section(
      'Verdict (decided by the pipeline engine)',
      `${f.verdict.label}${a.verdict.conditions.length ? `\nConditions:\n${a.verdict.conditions.map((c) => `- ${c}`).join('\n')}` : '\nNo conditions.'}`,
    ),
    section(
      'What the slides show next to your wording (do not repeat these numbers)',
      [
        `Target KPI: ${f.kpiName}, today ${f.kpiBaseline}${f.clientTarget ? `; client target: ${f.clientTarget}` : ''}`,
        `Expected impact: ${f.impact.base} (range ${f.impact.range}); evidence: ${a.inputs.evidence}`,
        `Business value: ${f.value.base}, ${f.value.range}; ${f.value.payback}`,
        `Delivery: ${f.delivery.range}. Budget: ${f.budget.range} (preliminary)`,
        `Counts: ${f.counts.map((c) => `${c.value} ${c.label}`).join(', ')}`,
        ...(f.caution ? [`Caution shown: ${f.caution}`] : []),
      ].join('\n'),
    ),
    section('Task', 'Write the wording of the three slides as the DeckDraft JSON.'),
  ].join('\n\n');
}
