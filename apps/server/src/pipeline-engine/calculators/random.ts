/** A seeded random number generator in [0, 1), so every forecast can be reproduced. */
export type Rng = () => number;

/** mulberry32: small, fast and good enough for Monte Carlo forecasts. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: a stable 32-bit seed from a run id. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function normal(rng: Rng): number {
  // Box–Muller; 1 − u avoids log(0).
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) for shape ≥ 1 (Marsaglia–Tsang). */
function gamma(shape: number, rng: Rng): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * One draw from the beta-PERT distribution of a three-point estimate: the most likely value is
 * the mode, and the shape weights it four times as much as the extremes.
 */
export function betaPert(optimistic: number, mostLikely: number, pessimistic: number, rng: Rng): number {
  if (pessimistic <= optimistic) return mostLikely;
  const range = pessimistic - optimistic;
  const alpha = 1 + (4 * (mostLikely - optimistic)) / range;
  const beta = 1 + (4 * (pessimistic - mostLikely)) / range;
  const x = gamma(alpha, rng);
  const y = gamma(beta, rng);
  return optimistic + (range * x) / (x + y);
}
