import { betaPert, type Rng } from './random.js';

/**
 * Three-point estimates and the Monte Carlo release forecast. Scope per trial is the sum of the
 * items' beta-PERT draws; velocity per sprint is resampled from the team's history and scaled by
 * the capacity share the feature gets.
 */

export interface ThreePoint {
  optimistic: number;
  mostLikely: number;
  pessimistic: number;
}

/** PERT: E = (O + 4M + P) / 6, σ = (P − O) / 6. */
export const pert = ({ optimistic, mostLikely, pessimistic }: ThreePoint) => ({
  mean: (optimistic + 4 * mostLikely + pessimistic) / 6,
  sd: (pessimistic - optimistic) / 6,
});

/** Mean and σ of a sum of independent estimates. */
export function pertTotal(items: ThreePoint[]) {
  const parts = items.map(pert);
  return {
    mean: parts.reduce((s, p) => s + p.mean, 0),
    sd: Math.sqrt(parts.reduce((s, p) => s + p.sd ** 2, 0)),
  };
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export interface MonteCarloInput {
  /** `group` ties an item to a discipline whose own pace may limit the forecast. */
  items: (ThreePoint & { group?: string })[];
  /** Completed points of past sprints. */
  velocities: number[];
  capacityShare: number;
  trials: number;
  maxSprints: number;
  rng: Rng;
  /**
   * Points per sprint each discipline can deliver to this feature at an average sprint. A trial
   * takes at least as long as its busiest discipline needs (critical-resource constraint).
   */
  groupPace?: Record<string, number>;
}

export interface MonteCarloResult {
  points: number[];
  sprints: number[];
  histogram: { sprints: number; share: number }[];
}

export function monteCarlo({
  items,
  velocities,
  capacityShare,
  trials,
  maxSprints,
  rng,
  groupPace,
}: MonteCarloInput): MonteCarloResult {
  if (!velocities.length) throw new Error('A forecast needs at least one past sprint velocity');
  const mean = velocities.reduce((s, v) => s + v, 0) / velocities.length;
  const points: number[] = [];
  const sprints: number[] = [];
  for (let t = 0; t < trials; t++) {
    const byGroup = new Map<string, number>();
    let scope = 0;
    for (const i of items) {
      const draw = betaPert(i.optimistic, i.mostLikely, i.pessimistic, rng);
      scope += draw;
      if (i.group) byGroup.set(i.group, (byGroup.get(i.group) ?? 0) + draw);
    }
    let remaining = scope;
    let n = 0;
    let pace = 0;
    while (remaining > 1e-9 && n < maxSprints) {
      const velocity = velocities[Math.floor(rng() * velocities.length)]!;
      remaining -= velocity * capacityShare;
      pace += velocity / mean;
      n++;
    }
    // A discipline cannot go faster than its own capacity, scaled by how the sampled sprints went.
    const factor = n ? pace / n : 1;
    let bound = 0;
    for (const [group, groupPoints] of byGroup) {
      const rate = groupPace?.[group];
      if (rate && rate > 0) bound = Math.max(bound, Math.ceil(groupPoints / (rate * factor) - 1e-9));
    }
    points.push(scope);
    sprints.push(Math.min(maxSprints, Math.max(1, n, bound)));
  }
  points.sort((a, b) => a - b);
  sprints.sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const n of sprints) counts.set(n, (counts.get(n) ?? 0) + 1);
  const histogram = [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, count]) => ({ sprints: n, share: count / trials }));
  return { points, sprints, histogram };
}
