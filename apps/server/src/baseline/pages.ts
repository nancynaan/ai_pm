import { formatPercent, formatUsd, markdownTable } from '../render/tables.js';
import { averageVelocity, formatDate, formatKpi, riskScore, teamCostPerSprint, teamFte } from './facts.js';
import type { SeedData } from './seed-data.js';

export interface PageContext {
  /** Seed id (EP-CORE, ST-01) → Jira key, once known. */
  issueKeys: ReadonlyMap<string, string>;
}

export interface BuiltPage {
  type: string;
  title: string;
  markdown: string;
  /** Structured data stored with the artifact for the calculators. */
  data: unknown;
}

export const pageTitle = (seed: SeedData, title: string) => `${seed.project.name}: ${title}`;

function values(seed: SeedData): Record<string, string> {
  const { project, kpis, team } = seed;
  const f = kpis.financials;
  return {
    name: project.name,
    client: project.client,
    genre: project.genre,
    engine: project.engine,
    pitch: project.pitch,
    platforms: project.platforms.join(', '),
    current_sprint: String(project.current_sprint),
    soft_launch: formatDate(project.soft_launch),
    global_launch: formatDate(project.global_launch_target),
    sprint_length: `${team.sprint_length_weeks}-week`,
    sprint_weeks: `${team.sprint_length_weeks} weeks`,
    hours_per_sprint: String(team.hours_per_sprint),
    approved_budget: formatUsd(f.approved_budget_usd),
    spent_to_date: formatUsd(f.spent_to_date_usd),
    ua_budget: formatUsd(f.user_acquisition_budget_usd),
    year1_revenue: formatUsd(f.expected_year1_revenue_usd),
    payback_months: String(f.payback_months_after_launch),
    revenue_split: `${formatPercent(kpis.revenue_split.iap)} in-app purchases, ${formatPercent(kpis.revenue_split.ads)} ads`,
    cost_per_sprint: formatUsd(teamCostPerSprint(team)),
    avg_velocity: averageVelocity(team).toFixed(1),
    velocity_sprints: String(team.velocity.length),
    capacity_share: formatPercent(team.capacity_share_new_epic),
  };
}

const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' } as const;

function tables(seed: SeedData, ctx: PageContext): Record<string, () => string> {
  const key = (id: string) => ctx.issueKeys.get(id) ?? id;
  const epicName = (id: string) => {
    const epic = seed.backlog.epics.find((e) => e.id === id);
    return epic ? `${epic.summary} (${key(id)})` : id;
  };
  return {
    kpis: () =>
      `${markdownTable(seed.kpis.metrics, [
        { header: 'Metric', value: (m) => m.name },
        { header: 'Soft-launch baseline', value: (m) => formatKpi(m.unit, m.baseline) },
        { header: 'Global-launch target', value: (m) => formatKpi(m.unit, m.target) },
      ])}\n\n_Source: ${seed.kpis.source}._`,
    financials: () => {
      const f = seed.kpis.financials;
      return markdownTable(
        [
          ['Approved delivery budget', formatUsd(f.approved_budget_usd)],
          ['Spent to date', formatUsd(f.spent_to_date_usd)],
          ['User acquisition (funded by the client)', formatUsd(f.user_acquisition_budget_usd)],
          ['Expected revenue, first year after launch', formatUsd(f.expected_year1_revenue_usd)],
          ['Payback after launch', `${f.payback_months_after_launch} months`],
          ['Discount rate for NPV', formatPercent(f.discount_rate_annual)],
        ],
        [
          { header: 'Item', value: (r) => r[0] ?? '' },
          { header: 'Amount', value: (r) => r[1] ?? '' },
        ],
      );
    },
    team: () => {
      const { team } = seed;
      const rows = [
        ...team.roles.map((r) => ({
          role: r.role,
          name: r.name,
          fte: String(r.fte),
          rate: formatUsd(r.rate),
          cost: formatUsd(r.fte * r.rate * team.hours_per_sprint),
        })),
        {
          role: '**Total**',
          name: '',
          fte: `**${teamFte(team)}**`,
          rate: '',
          cost: `**${formatUsd(teamCostPerSprint(team))}**`,
        },
      ];
      return markdownTable(rows, [
        { header: 'Role', value: (r) => r.role },
        { header: 'Name', value: (r) => r.name },
        { header: 'FTE', value: (r) => r.fte },
        { header: 'Rate (USD/h)', value: (r) => r.rate },
        { header: 'Cost per sprint', value: (r) => r.cost },
      ]);
    },
    velocity: () =>
      markdownTable(seed.team.velocity, [
        { header: 'Sprint', value: (v) => v.sprint },
        { header: 'Committed (SP)', value: (v) => v.committed },
        { header: 'Completed (SP)', value: (v) => v.completed },
      ]),
    components: () =>
      markdownTable(seed.components.components, [
        { header: 'Component', value: (c) => c.name },
        { header: 'Responsibility', value: (c) => c.responsibility },
        { header: 'Technology', value: (c) => c.technology },
        { header: 'Change sensitivity', value: (c) => c.sensitivity },
        { header: 'Depends on', value: (c) => c.depends_on.join(', ') || '–' },
        { header: 'Owner', value: (c) => c.owner },
      ]),
    performance_budget: () =>
      markdownTable(seed.components.performance_budget, [
        { header: 'Metric', value: (p) => p.metric },
        { header: 'Budget', value: (p) => p.budget },
      ]),
    stakeholders: () =>
      markdownTable(seed.stakeholders.stakeholders, [
        { header: 'Name', value: (s) => s.name },
        { header: 'Role', value: (s) => s.role },
        { header: 'Organization', value: (s) => s.organization },
        { header: 'Interest', value: (s) => s.interest },
        { header: 'Influence', value: (s) => s.influence },
        { header: 'Engagement', value: (s) => s.engagement },
        { header: 'Email', value: (s) => s.email },
        { header: 'Scrum Team', value: (s) => (s.team ? 'Yes' : '–') },
      ]),
    assumptions: () =>
      markdownTable(seed.assumptions.assumptions, [
        { header: 'ID', value: (a) => a.id },
        { header: 'Assumption', value: (a) => a.text },
        { header: 'Owner', value: (a) => a.owner },
        { header: 'Status', value: (a) => a.status },
        { header: 'Validate by', value: (a) => formatDate(a.validate_by) },
      ]),
    risks: () =>
      markdownTable(seed.risks.risks, [
        { header: 'ID', value: (r) => r.id },
        { header: 'Risk', value: (r) => r.title },
        { header: 'Cause → event → effect', value: (r) => `${r.cause} → ${r.event} → ${r.effect}` },
        { header: 'Category', value: (r) => r.category },
        { header: 'P', value: (r) => r.probability },
        { header: 'I', value: (r) => r.impact },
        { header: 'Score', value: (r) => riskScore(r) },
        { header: 'Response', value: (r) => `${r.strategy}: ${r.response}` },
        { header: 'Owner', value: (r) => r.owner },
        { header: 'Status', value: (r) => r.status },
      ]),
    roadmap: () =>
      markdownTable(seed.roadmap.releases, [
        { header: 'Release', value: (r) => `${r.id} ${r.name}` },
        { header: 'Window', value: (r) => r.window },
        { header: 'Status', value: (r) => r.status },
        { header: 'Goals', value: (r) => r.goals },
        { header: 'Epics', value: (r) => r.epics.map(epicName).join(', ') || '–' },
      ]),
    backlog: () =>
      markdownTable(seed.backlog.epics, [
        { header: 'Epic', value: (e) => e.summary },
        { header: 'Jira', value: (e) => key(e.id) },
        { header: 'Status', value: (e) => STATUS_LABEL[e.status] },
        { header: 'Stories', value: (e) => seed.backlog.stories.filter((s) => s.epic === e.id).length },
        {
          header: 'Story points (done / total)',
          value: (e) => {
            const stories = seed.backlog.stories.filter((s) => s.epic === e.id);
            const done = stories.filter((s) => s.status === 'done').reduce((n, s) => n + s.points, 0);
            return `${done} / ${stories.reduce((n, s) => n + s.points, 0)}`;
          },
        },
      ]),
  };
}

function lists(seed: SeedData): Record<string, () => string> {
  return { dod: () => seed.dod.items.map((item) => `- ${item}`).join('\n') };
}

function pageData(type: string, seed: SeedData): unknown {
  switch (type) {
    case 'business_case':
      return seed.kpis;
    case 'project_charter':
      return { project: seed.project, financials: seed.kpis.financials };
    case 'stakeholder_register':
      return seed.stakeholders;
    case 'assumption_log':
      return seed.assumptions;
    case 'game_design_document':
    case 'baseline_home':
      return seed.project;
    case 'definition_of_done':
      return seed.dod;
    case 'product_roadmap':
      return seed.roadmap;
    case 'risk_register':
      return seed.risks;
    case 'architecture_overview':
      return seed.components;
    case 'team_velocity':
      return seed.team;
    case 'initial_backlog':
      return seed.backlog;
    default:
      return null;
  }
}

/** Fills `{{value:x}}`, `{{table:x}}` and `{{list:x}}` placeholders; `{{children}}` is left for the renderer. */
export function buildPages(seed: SeedData, ctx: PageContext): BuiltPage[] {
  const sources: Record<string, Record<string, () => string>> = {
    value: Object.fromEntries(Object.entries(values(seed)).map(([k, v]) => [k, () => v])),
    table: tables(seed, ctx),
    list: lists(seed),
  };
  return seed.pages.map((page) => ({
    type: page.type,
    title: pageTitle(seed, page.title),
    markdown: page.body.replace(
      /\{\{(value|table|list):([a-z0-9_]+)\}\}/g,
      (placeholder, kind: string, name: string) => {
        const render = sources[kind]?.[name];
        if (!render) throw new Error(`${page.file}: unknown placeholder ${placeholder}`);
        return render();
      },
    ),
    data: pageData(page.type, seed),
  }));
}
