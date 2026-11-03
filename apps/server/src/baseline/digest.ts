import { formatPercent, formatUsd } from '../render/tables.js';
import { averageVelocity, formatDate, formatKpi, riskScore, teamCostPerSprint, teamFte } from './facts.js';
import type { SeedData } from './seed-data.js';

/**
 * A compact, deterministic summary of the baseline for agent prompts. Built from the structured
 * data, never by a model, so the same baseline always gives the same digest.
 */
export function buildDigest(seed: SeedData): string {
  const { project, kpis, team, components, risks, roadmap, dod, assumptions, backlog } = seed;
  const f = kpis.financials;
  const velocities = team.velocity.map((v) => v.completed);
  const lines = [
    `# ${project.name}: baseline digest`,
    '',
    `${project.pitch}`,
    `Client: ${project.client} | Genre: ${project.genre} | Platforms: ${project.platforms.join(', ')} | Engine: ${project.engine}`,
    `Scrum, ${team.sprint_length_weeks}-week sprints. Current sprint: ${project.current_sprint}. Soft launch: ${formatDate(project.soft_launch)}. Global launch target: ${formatDate(project.global_launch_target)}.`,
    '',
    '## KPIs (soft-launch baseline → global-launch target)',
    ...kpis.metrics.map(
      (m) => `- ${m.name}: ${formatKpi(m.unit, m.baseline)} → ${formatKpi(m.unit, m.target)}`,
    ),
    `- Revenue split: ${formatPercent(kpis.revenue_split.iap)} IAP, ${formatPercent(kpis.revenue_split.ads)} ads`,
    '',
    '## Budget',
    `- Approved ${formatUsd(f.approved_budget_usd)}, spent ${formatUsd(f.spent_to_date_usd)}, remaining ${formatUsd(f.approved_budget_usd - f.spent_to_date_usd)}`,
    `- Expected first-year revenue ${formatUsd(f.expected_year1_revenue_usd)}; payback ${f.payback_months_after_launch} months after launch; discount rate ${formatPercent(f.discount_rate_annual)}`,
    '',
    '## Team and capacity',
    `- ${teamFte(team)} FTE, ${formatUsd(teamCostPerSprint(team))} per sprint (${team.hours_per_sprint} h per person per sprint)`,
    `- Velocity, last ${velocities.length} sprints: ${velocities.join(', ')} SP (average ${averageVelocity(team).toFixed(1)})`,
    `- Default capacity share for a new feature: ${formatPercent(team.capacity_share_new_epic)}`,
    '',
    '## Components (change sensitivity)',
    ...components.components.map((c) => `- ${c.name} (${c.sensitivity}): ${c.responsibility}`),
    '',
    '## Performance budget',
    ...components.performance_budget.map((p) => `- ${p.metric}: ${p.budget}`),
    '',
    '## Roadmap',
    ...roadmap.releases.map((r) => `- ${r.id} ${r.name} (${r.window}, ${r.status}): ${r.goals}`),
    '',
    '## Backlog epics',
    ...backlog.epics.map((e) => {
      const stories = backlog.stories.filter((s) => s.epic === e.id);
      const points = stories.reduce((n, s) => n + s.points, 0);
      return `- ${e.id} ${e.summary} (${e.status}, ${stories.length} stories, ${points} SP)`;
    }),
    '',
    '## Risks with score 12 or more',
    ...risks.risks
      .filter((r) => riskScore(r) >= 12)
      .sort((a, b) => riskScore(b) - riskScore(a))
      .map((r) => `- ${r.id} ${r.title} (P${r.probability} × I${r.impact} = ${riskScore(r)}): ${r.response}`),
    '',
    '## Open assumptions',
    ...assumptions.assumptions.filter((a) => a.status === 'open').map((a) => `- ${a.id} ${a.text}`),
    '',
    '## Definition of Done',
    ...dod.items.map((item) => `- ${item}`),
  ];
  return lines.join('\n');
}
