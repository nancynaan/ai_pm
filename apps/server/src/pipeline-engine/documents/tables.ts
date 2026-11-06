import type { AssessedRisk } from '@ai-pm/shared';
import { formatDate } from '../../baseline/facts.js';
import { formatInt, formatPercent, formatUsd, markdownTable } from '../../render/tables.js';
import { answerLabels, type DocumentInputs } from './inputs.js';
import type { Figures } from './figures.js';

/**
 * Every table and code-written list of the documents, from the DB only. Text that agents wrote
 * earlier (requirement titles, risk statements) is data here; `{{` is defused so it can never
 * be read as a template slot.
 */
const safe = (text: string | null | undefined) => (text ?? '').replaceAll('{{', '{ {').trim();
const money = (n: number) => `${n < 0 ? '−' : ''}${formatUsd(Math.abs(n))}`;
const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
const none = (text: string) => `_${text}_`;
const bullets = (items: string[]) => items.map((i) => `- ${safe(i)}`).join('\n');

const LEVEL_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
const MOSCOW: Record<string, string> = { must: 'Must', should: 'Should', could: 'Could', wont: "Won't" };
const SOURCE: Record<string, string> = {
  stated: 'Client request',
  answer: 'Questionnaire',
  inferred: 'AI hypothesis',
};

/** Risk ids are per run (F-R3); on the shared register they get the feature's prefix (FA1-R3). */
export const sharedRiskId = (faNumber: number, id: string) => `FA${faNumber}-${id.replace(/^F-/, '')}`;

export interface OpenItem {
  text: string;
  source: string;
  blocking: boolean;
}

/** Open questions and unresolved issues: discovery gaps and contradictions, conflicts, the spike. */
export function openItems(inputs: DocumentInputs): OpenItem[] {
  const items: OpenItem[] = [];
  const report = inputs.report;
  for (const g of report?.gaps ?? [])
    items.push({ text: g.text, source: 'Discovery gap', blocking: g.critical });
  for (const c of report?.contradictions ?? [])
    if (!c.resolved)
      items.push({ text: c.text, source: 'Discovery contradiction', blocking: c.severity === 'blocking' });
  for (const f of report?.findings ?? [])
    if (f.kind === 'missing') items.push({ text: f.text, source: 'Missing information', blocking: false });
  for (const c of inputs.analysis.conflicts)
    items.push({
      text: `${c.requirementCode ? `${c.requirementCode}: ` : ''}${c.description} (${c.kind} with ${c.with})`,
      source: 'Requirement conflict',
      blocking: c.blocking,
    });
  const spike = inputs.analysis.spike;
  if (spike.needed && spike.question)
    items.push({ text: spike.question, source: 'Technical spike', blocking: false });
  for (const a of inputs.assumptions)
    if (a.kind === 'open_issue') items.push({ text: a.text, source: 'Accepted open issue', blocking: false });
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.text) ? false : (seen.add(i.text), true)));
}

const openItemsTable = (items: OpenItem[]) =>
  items.length
    ? markdownTable(items, [
        { header: '#', value: (i) => String(items.indexOf(i) + 1) },
        { header: 'Question or issue', value: (i) => safe(i.text) },
        { header: 'Source', value: (i) => i.source },
        { header: 'Blocking', value: (i) => yesNo(i.blocking) },
      ])
    : none('Nothing open.');

const dependenciesTable = (inputs: DocumentInputs) =>
  inputs.analysis.dependencies.length
    ? markdownTable(
        [...inputs.analysis.dependencies].sort((a, b) => Number(b.blocking) - Number(a.blocking)),
        [
          { header: 'Type', value: (d) => d.type },
          { header: 'On', value: (d) => safe(d.target) },
          { header: 'What is needed', value: (d) => safe(d.description) },
          { header: 'Blocking', value: (d) => yesNo(d.blocking) },
        ],
      )
    : none('No dependencies found.');

const CLIENT_GOALS: [string, string][] = [
  ['problem', 'Problem or opportunity'],
  ['outcome', 'Expected business outcome'],
  ['evidence', 'Basis for the request'],
  ['audience', 'Who benefits most'],
  ['success', 'How success is judged'],
  ['priority', 'Priority and timing'],
  ['approval', 'Approval'],
];

function requirementTable(inputs: DocumentInputs, type: 'functional' | 'non_functional') {
  const rows = inputs.analysis.requirements.filter((r) => r.type === type);
  if (!rows.length) return none('None.');
  return markdownTable(rows, [
    { header: 'Code', value: (r) => r.code },
    { header: 'Requirement', value: (r) => safe(r.title) },
    { header: 'Description', value: (r) => safe(r.description) },
    { header: type === 'functional' ? 'Area' : 'Quality (ISO/IEC 25010)', value: (r) => safe(r.category) },
    { header: 'MoSCoW', value: (r) => MOSCOW[r.moscow] ?? r.moscow },
    { header: 'MVP', value: (r) => yesNo(r.inMvp) },
    { header: 'Source', value: (r) => SOURCE[r.source] ?? r.source },
  ]);
}

const OWNER: Record<string, string> = {
  client_hypothesis: 'Client',
  ai_hypothesis: 'Development team',
  default: 'Product Owner',
  open_issue: 'Product Owner',
  estimate: 'Development team',
  value: 'Product Owner',
};
const VALIDATE: Record<string, string> = {
  client_hypothesis: 'Measure after release (A/B test or soft-launch cohort)',
  ai_hypothesis: 'Team confirms in Backlog Refinement',
  default: 'Client confirms or replaces the default',
  open_issue: 'Resolve before Sprint Planning',
  estimate: 'Team re-estimates in Backlog Refinement',
  value: 'Track the primary KPI after release',
};
const KIND: Record<string, string> = {
  client_hypothesis: 'Client hypothesis',
  ai_hypothesis: 'AI hypothesis',
  default: 'Default',
  open_issue: 'Open issue',
  assumption: 'Assumption',
  estimate: 'Estimate assumption',
  value: 'Value assumption',
};

const DECISION_LABEL: Record<string, string> = {
  approve: 'Approved',
  changes: 'Changes requested',
  decline: 'Declined',
  proceed: 'Continue with a preliminary assessment',
  stop: 'Stopped',
};

const riskStatement = (r: AssessedRisk) => `${safe(r.cause)} → ${safe(r.event)} → ${safe(r.effect)}`;

export interface TableContext {
  inputs: DocumentInputs;
  figures: Figures;
  /** Confluence links, when known. */
  links: { brief: string | null; riskRegister: string | null; assumptionLog: string | null };
}

/** {{table:x}} and {{list:x}} contents by name. */
export function tables({ inputs, figures, links }: TableContext): Record<string, () => string> {
  const a = inputs.assessment;
  const fa = inputs.faNumber;
  const reqs = inputs.analysis.requirements;
  const briefRef = links.brief
    ? `[${figures.fa} Feature Brief](${links.brief})`
    : `${figures.fa} Feature Brief`;

  return {
    // ---- Feature Brief
    client_goals: () => {
      const rows = CLIENT_GOALS.map(([id, topic]) => [
        topic,
        answerLabels(inputs, id).join('; ') || 'Not answered',
      ]);
      return markdownTable(rows, [
        { header: 'Topic', value: (r) => r[0]! },
        { header: "Client's answer", value: (r) => safe(r[1]) },
      ]);
    },
    value_scenarios: () =>
      markdownTable(a.value.scenarios, [
        { header: 'Scenario', value: (s) => s.name[0]!.toUpperCase() + s.name.slice(1) },
        { header: 'Reach', value: (s) => formatPercent(s.reach) },
        {
          header: 'KPI changes',
          value: (s) =>
            s.kpiChanges
              .map(
                (k) =>
                  `${k.kpi} ${k.change >= 0 ? '+' : ''}${k.change} ${k.unit}${k.capped ? ' (capped)' : ''}`,
              )
              .join(', ') || 'No effect',
        },
        { header: `Benefit (${a.value.horizonMonths} months)`, value: (s) => money(s.benefitUsd) },
        { header: 'ROI', value: (s) => `${s.roi < 0 ? '−' : ''}${formatPercent(Math.abs(s.roi))}` },
        { header: 'NPV', value: (s) => money(s.npvUsd) },
        {
          header: 'Payback',
          value: (s) => (s.paybackMonth ? `Month ${s.paybackMonth}` : 'Not within the horizon'),
        },
      ]),
    scope: () => {
      const label = (r: (typeof reqs)[number]) => `${r.code} ${safe(r.title)}`;
      const buckets: [string, string[]][] = [
        ['First release (MVP)', reqs.filter((r) => r.inMvp).map(label)],
        ['Later releases', reqs.filter((r) => !r.inMvp && r.moscow !== 'wont').map(label)],
        ['Out of scope', reqs.filter((r) => r.moscow === 'wont').map(label)],
      ];
      return markdownTable(buckets, [
        { header: 'Scope', value: (b) => b[0] },
        { header: 'Requirements', value: (b) => b[1].join('; ') || 'None' },
      ]);
    },
    magnitude_reason: () => safe(inputs.analysis.magnitudeReason),
    components: () => {
      const rows = inputs.analysis.impacts
        .filter((i) => i.level !== 'none')
        .sort((x, y) => (LEVEL_ORDER[x.level] ?? 9) - (LEVEL_ORDER[y.level] ?? 9));
      return rows.length
        ? markdownTable(rows, [
            { header: 'Component', value: (i) => safe(i.component) },
            { header: 'Impact', value: (i) => i.level },
            { header: 'Why', value: (i) => safe(i.rationale) },
          ])
        : none('No component is affected.');
    },
    dependencies: () => dependenciesTable(inputs),
    constraints: () => {
      const rows = [
        ...inputs.constraints.map((c) => [c.type, safe(c.text)]),
        ['budget', `Budget limit ${figures['budget.limit']} (${figures['budget.limit_name']})`],
        ['time', `Deadline: ${figures.deadline}`],
      ];
      return markdownTable(rows, [
        { header: 'Type', value: (r) => r[0]! },
        { header: 'Constraint', value: (r) => r[1]! },
      ]);
    },
    baseline_impact: () =>
      markdownTable(
        [
          [
            'Approved delivery budget',
            figures['baseline.approved_budget']!,
            figures['baseline.approved_budget']!,
          ],
          ['Spent to date', figures['baseline.spent']!, figures['baseline.spent']!],
          [
            'Remaining budget',
            figures['baseline.remaining']!,
            `${figures['baseline.remaining_after']} (this feature at P85: ${figures['budget.total.p85']}, ${figures['baseline.share_of_remaining']} of the remaining budget)`,
          ],
          [
            `Current release (${figures['roadmap.release']})`,
            `Done by ${figures['roadmap.finish_without']}`,
            `Done by ${figures['roadmap.finish_with']} (${figures['roadmap.delay']} later)`,
          ],
          [
            'Launch target',
            figures['roadmap.launch_target']!,
            `${figures['roadmap.launch_target']} (${figures['roadmap.launch_at_risk']})`,
          ],
        ],
        [
          { header: 'Baseline', value: (r) => r[0]! },
          { header: 'Now', value: (r) => r[1]! },
          { header: 'With this feature', value: (r) => r[2]! },
        ],
      ),
    conditions: () =>
      a.verdict.conditions.length
        ? `Conditions:\n\n${bullets(a.verdict.conditions)}`
        : 'No conditions: the verdict is a plain Go.',
    shared_pages: () =>
      bullets([
        `Risk Register: ${figures.fa} block with this feature's risks${links.riskRegister ? ` (${links.riskRegister})` : ''}`,
        `Assumption Log: ${figures.fa} block with assumptions, decisions and unresolved issues${links.assumptionLog ? ` (${links.assumptionLog})` : ''}`,
      ]),

    // ---- Requirements Specification
    functional: () => requirementTable(inputs, 'functional'),
    non_functional: () => requirementTable(inputs, 'non_functional'),
    conflicts: () =>
      inputs.analysis.conflicts.length
        ? markdownTable(inputs.analysis.conflicts, [
            { header: 'Requirement', value: (c) => c.requirementCode ?? '—' },
            { header: 'With', value: (c) => safe(c.with) },
            { header: 'Kind', value: (c) => c.kind },
            { header: 'Description', value: (c) => safe(c.description) },
            { header: 'Blocking', value: (c) => yesNo(c.blocking) },
          ])
        : none('No conflicts or duplicates found.'),
    open_questions: () => openItemsTable(openItems(inputs)),

    // ---- Estimation & Release Forecast
    story_map: () =>
      markdownTable(a.storyMap.items, [
        { header: 'Ref', value: (i) => i.ref },
        { header: 'Item', value: (i) => safe(i.title) },
        { header: 'Type', value: (i) => i.type },
        { header: 'Release', value: (i) => (i.release === 'mvp' ? 'MVP' : 'Later') },
        { header: 'Discipline', value: (i) => i.discipline.replace('_', '/') },
        { header: 'Requirements', value: (i) => i.requirementCodes.join(', ') },
        { header: 'O', value: (i) => i.optimistic },
        { header: 'M', value: (i) => i.mostLikely },
        { header: 'P', value: (i) => i.pessimistic },
        { header: 'E', value: (i) => (Math.round(i.mean * 10) / 10).toString() },
        { header: 'Reference', value: (i) => i.referenceStory ?? '—' },
      ]),
    capacity: () =>
      markdownTable(
        [
          ['Start', `${figures['start.sprint']} (${figures['start.date']})`],
          ['Capacity share for this Epic', figures['capacity.share']!],
          ['Average velocity of past sprints', `${figures['velocity.average']} story points`],
          ['Team cost per sprint', figures['team.cost_per_sprint']!],
          ['Cost per story point at this velocity', figures['team.cost_per_point']!],
        ],
        [
          { header: 'Assumption', value: (r) => r[0]! },
          { header: 'Value', value: (r) => r[1]! },
        ],
      ),
    resources: () =>
      markdownTable(a.resources, [
        { header: 'Discipline', value: (r) => r.discipline.replace('_', '/') },
        { header: 'Share of points', value: (r) => formatPercent(r.pointsShare) },
        { header: 'FTE needed', value: (r) => (Math.round(r.demandFte * 10) / 10).toString() },
        { header: 'FTE available', value: (r) => (Math.round(r.availableFte * 10) / 10).toString() },
        {
          header: 'Sprints for its share',
          value: (r) => (r.sprintsNeeded === null ? '—' : formatInt(r.sprintsNeeded)),
        },
        { header: 'Sets the pace', value: (r) => yesNo(r.bottleneck) },
      ]),
    forecast: () =>
      markdownTable(['p50', 'p85', 'p95'] as const, [
        { header: 'Confidence', value: (p) => p.toUpperCase() },
        { header: 'MVP sprints', value: (p) => figures[`forecast.mvp.sprints.${p}`]! },
        { header: 'MVP done by', value: (p) => figures[`forecast.mvp.date.${p}`]! },
        { header: 'Full scope sprints', value: (p) => figures[`forecast.full.sprints.${p}`]! },
        { header: 'Full scope done by', value: (p) => figures[`forecast.full.date.${p}`]! },
      ]),
    budget_roles: () =>
      markdownTable(a.budget.byRole, [
        { header: 'Role', value: (r) => r.role },
        { header: 'FTE', value: (r) => r.fte },
        { header: 'Rate (USD/h)', value: (r) => r.rate },
        { header: 'Labour at P50', value: (r) => money(r.p50) },
        { header: 'Labour at P85', value: (r) => money(r.p85) },
      ]),
    budget_non_labour: () =>
      a.budget.nonLabour.length
        ? markdownTable(a.budget.nonLabour, [
            { header: 'Cost outside the team', value: (n) => safe(n.description) },
            { header: 'Kind', value: (n) => (n.kind === 'one_off' ? 'One-off' : 'Monthly') },
            { header: 'Amount', value: (n) => money(n.amountUsd) },
            { header: 'Total', value: (n) => money(n.totalUsd) },
            { header: 'Basis', value: (n) => safe(n.basis) },
          ])
        : none('No costs outside the team.'),
    budget_total: () =>
      markdownTable(
        [
          ['Labour', figures['budget.labour.p50']!, figures['budget.labour.p85']!],
          ['Costs outside the team', figures['budget.non_labour']!, figures['budget.non_labour']!],
          [
            `Contingency (risk EMV ${figures['budget.emv']}${a.budget.contingencyCapped ? ', capped' : ''})`,
            figures['budget.contingency']!,
            figures['budget.contingency']!,
          ],
          ['**Total**', `**${figures['budget.total.p50']}**`, `**${figures['budget.total.p85']}**`],
          [
            `Budget limit (${figures['budget.limit_name']})`,
            figures['budget.limit']!,
            `${figures['budget.limit']} (P85 uses ${figures['budget.limit_usage']})`,
          ],
        ],
        [
          { header: 'Budget', value: (r) => r[0]! },
          { header: 'P50', value: (r) => r[1]! },
          { header: 'P85', value: (r) => r[2]! },
        ],
      ),
    forecast_assumptions: () =>
      bullets([
        ...a.preliminaryReasons.map((r) => `Preliminary: ${r}`),
        ...(a.inputs.discoveryConfidence ? [`Discovery confidence: ${a.inputs.discoveryConfidence}`] : []),
        ...a.storyMap.assumptions,
        `Estimates are AI estimates in story points; the team's own Planning Poker estimate replaces them.`,
      ]),

    // ---- Roadmap Update Proposal
    roadmap: () => {
      const rows: { release: string; window: string; status: string; change: string }[] =
        inputs.baseline.roadmap.releases.map((r) => {
          const affected =
            a.roadmapImpact.release === `${r.id} ${r.name}` || a.roadmapImpact.release === r.name;
          return {
            release: `${r.id} ${r.name}`,
            window: r.window,
            status: r.status,
            change: affected
              ? `Done by ${figures['roadmap.finish_with']} instead of ${figures['roadmap.finish_without']} (${figures['roadmap.delay']} later)`
              : 'No change',
          };
        });
      rows.push({
        release: `${figures.fa} ${inputs.featureName} (new)`,
        window: `MVP by ${figures['forecast.mvp.date.p85']}, full scope by ${figures['forecast.full.date.p85']} (P85)`,
        status: 'proposed',
        change: 'Added to the plan',
      });
      return markdownTable(rows, [
        { header: 'Release', value: (r) => safe(r.release) },
        { header: 'Window', value: (r) => safe(r.window) },
        { header: 'Status', value: (r) => r.status },
        { header: 'Change', value: (r) => r.change },
      ]);
    },

    // ---- shared pages
    block_intro: () =>
      `Proposed by the feature assessment ${briefRef} on ${formatDate(a.createdAt.slice(0, 10))}. Status: proposed until the client decides; re-publishing replaces this block.`,
    new_risks: () => {
      const rows = a.risks.filter((r) => !r.existingRiskId);
      return rows.length
        ? markdownTable(rows, [
            { header: 'ID', value: (r) => sharedRiskId(fa, r.id) },
            { header: 'Risk', value: (r) => safe(r.title) },
            { header: 'Cause → event → effect', value: riskStatement },
            { header: 'P', value: (r) => r.probability },
            { header: 'I', value: (r) => r.impact },
            { header: 'Score', value: (r) => r.score },
            { header: 'Level', value: (r) => r.level },
            { header: 'Response', value: (r) => `${r.strategy}: ${safe(r.response)}` },
            { header: 'Owner', value: (r) => safe(r.owner) },
            { header: 'Trigger', value: (r) => safe(r.trigger) },
          ])
        : none('No new risks.');
    },
    risk_updates: () => {
      const rows = a.risks.filter((r) => r.existingRiskId);
      return rows.length
        ? markdownTable(rows, [
            { header: 'Register risk', value: (r) => r.existingRiskId! },
            { header: 'Feature risk', value: (r) => `${sharedRiskId(fa, r.id)} ${safe(r.title)}` },
            { header: 'P', value: (r) => r.probability },
            { header: 'I', value: (r) => r.impact },
            { header: 'Score', value: (r) => r.score },
            { header: 'Level', value: (r) => r.level },
            { header: 'Response', value: (r) => `${r.strategy}: ${safe(r.response)}` },
            { header: 'Owner', value: (r) => safe(r.owner) },
          ])
        : none('No changes to existing risks.');
    },
    assumptions: () => {
      const rows = [
        ...inputs.assumptions
          .filter((x) => x.kind !== 'open_issue')
          .map((x) => ({ text: x.text, kind: x.kind, owner: x.owner, status: x.status })),
        ...a.storyMap.assumptions.map((text) => ({ text, kind: 'estimate', owner: null, status: 'open' })),
        ...a.value.assumptions.map((text) => ({ text, kind: 'value', owner: null, status: 'open' })),
      ];
      return rows.length
        ? markdownTable(rows, [
            { header: 'ID', value: (r) => `FA${fa}-A${rows.indexOf(r) + 1}` },
            { header: 'Assumption', value: (r) => safe(r.text) },
            { header: 'Kind', value: (r) => KIND[r.kind] ?? r.kind },
            { header: 'Owner', value: (r) => safe(r.owner) || OWNER[r.kind] || 'Product Owner' },
            { header: 'How to validate', value: (r) => VALIDATE[r.kind] ?? 'Product Owner confirms' },
            { header: 'Status', value: (r) => r.status },
          ])
        : none('No assumptions.');
    },
    decisions: () => {
      const rows = [
        ...inputs.decisions.map((d) => ({
          when: formatDate(d.decidedAt.slice(0, 10)),
          what: `${d.gate === 'discovery' ? 'Discovery' : 'Client decision'}: ${DECISION_LABEL[d.decision] ?? d.decision}`,
          note: d.comment ?? '',
        })),
        ...(inputs.report?.contradictions ?? [])
          .filter((c) => c.resolved)
          .map((c) => ({ when: 'Discovery', what: 'Clarified by the client', note: c.text })),
        {
          when: formatDate(a.createdAt.slice(0, 10)),
          what: `Recommendation: ${a.verdict.label}${a.preliminary ? ' (preliminary)' : ''}`,
          note: inputs.decisions.some((d) => d.gate === 'assessment')
            ? 'Decided by the client (see the decision above)'
            : 'Awaiting the client decision',
        },
      ];
      return markdownTable(rows, [
        { header: 'When', value: (r) => r.when },
        { header: 'Decision', value: (r) => safe(r.what) },
        { header: 'Note', value: (r) => safe(r.note) || '—' },
      ]);
    },
    open_issues: () => openItemsTable(openItems(inputs)),
  };
}
