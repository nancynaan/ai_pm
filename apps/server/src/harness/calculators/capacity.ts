import type { Discipline } from '@ai-pm/shared';
import { round } from './finance.js';

/**
 * Who does the work and what it displaces. Disciplines come from the team roles; the Product Owner
 * and Scrum Master do not produce story points.
 */

export function disciplineOf(role: string): Discipline | null {
  if (/gameplay/i.test(role)) return 'gameplay';
  if (/backend|server/i.test(role)) return 'backend';
  if (/ui|ux|art|design/i.test(role)) return 'ui_art';
  if (/qa|test/i.test(role)) return 'qa';
  return null;
}

/** Developer FTE per discipline. */
function supplyOf(roles: { role: string; fte: number }[]) {
  const supply = new Map<Discipline, number>();
  for (const r of roles) {
    const d = disciplineOf(r.role);
    if (d) supply.set(d, (supply.get(d) ?? 0) + r.fte);
  }
  return supply;
}

/**
 * Points per sprint each discipline can give the feature at an average sprint: its FTE × the
 * capacity share × the points one developer FTE delivers (team velocity ÷ developer FTE).
 */
export function disciplinePace(
  roles: { role: string; fte: number }[],
  capacityShare: number,
  velocity: number,
) {
  const supply = supplyOf(roles);
  const devFte = [...supply.values()].reduce((s, f) => s + f, 0);
  const pointsPerFte = devFte ? velocity / devFte : 0;
  return Object.fromEntries([...supply.entries()].map(([d, fte]) => [d, fte * capacityShare * pointsPerFte]));
}

/**
 * The feature's work per discipline against what the team can give it. With a capacity share s,
 * a discipline gets fte × s; its demand is its share of the points × all developer FTE × s. A
 * discipline whose demand exceeds its supply sets the pace: the forecast already takes its own
 * duration into account, so this is planning information, not a condition.
 */
export function resourceDemand(
  items: { discipline: Discipline; mean: number }[],
  roles: { role: string; fte: number }[],
  capacityShare: number,
  velocity: number,
) {
  const supply = supplyOf(roles);
  const pace = disciplinePace(roles, capacityShare, velocity);
  const devFte = [...supply.values()].reduce((s, f) => s + f, 0);
  const total = items.reduce((s, i) => s + i.mean, 0) || 1;
  const disciplines = [...new Set(items.map((i) => i.discipline))];
  return disciplines
    .map((discipline) => {
      const points = items.filter((i) => i.discipline === discipline).reduce((s, i) => s + i.mean, 0);
      const share = points / total;
      const demand = share * devFte * capacityShare;
      const available = (supply.get(discipline) ?? 0) * capacityShare;
      const rate = pace[discipline];
      return {
        discipline,
        pointsShare: round(share, 3),
        demandFte: round(demand, 2),
        availableFte: round(available, 2),
        sprintsNeeded: rate ? round(points / rate, 1) : null,
        // "other" work is spread over everyone.
        bottleneck: discipline !== 'other' && demand > available + 0.01,
      };
    })
    .sort((a, b) => b.pointsShare - a.pointsShare);
}

/**
 * Sprints until the current release's remaining points are done, from the start sprint, without
 * and with the feature taking `capacityShare` of the team for `featureSprints` sprints.
 */
export function releaseDelay(
  remainingPoints: number,
  velocity: number,
  capacityShare: number,
  featureSprints: number,
) {
  const finish = (withFeature: boolean) => {
    let left = remainingPoints;
    let n = 0;
    while (left > 1e-9 && n < 200) {
      left -= velocity * (withFeature && n < featureSprints ? 1 - capacityShare : 1);
      n++;
    }
    return n;
  };
  const without = finish(false);
  const withFeature = finish(true);
  return { without, with: withFeature, delay: withFeature - without };
}
