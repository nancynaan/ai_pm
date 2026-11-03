import { formatInt, formatPercent, formatUsd } from '../render/tables.js';
import type { SeedData } from './seed-data.js';

/** Numbers derived from the seed data. Pages and the digest both use these, so they always agree. */

export const teamCostPerSprint = (team: SeedData['team']) =>
  team.roles.reduce((sum, r) => sum + r.fte * r.rate * team.hours_per_sprint, 0);

export const teamFte = (team: SeedData['team']) => team.roles.reduce((sum, r) => sum + r.fte, 0);

export const averageVelocity = (team: SeedData['team']) =>
  team.velocity.reduce((sum, v) => sum + v.completed, 0) / team.velocity.length;

export const riskScore = (risk: { probability: number; impact: number }) => risk.probability * risk.impact;

type Kpi = SeedData['kpis']['metrics'][number];

export function formatKpi(unit: Kpi['unit'], value: number): string {
  switch (unit) {
    case 'users':
      return formatInt(value);
    case 'usd':
      return formatUsd(value, 2);
    case 'ratio':
      return formatPercent(value, 1);
    case 'minutes':
      return `${value} min`;
    case 'number':
      return String(value);
  }
}

/** "2027-02-15" → "15 February 2027" */
export function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
