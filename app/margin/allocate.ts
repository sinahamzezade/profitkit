import type { Cents } from "./types";

/**
 * Splits `total` across `weights` proportionally, largest-remainder method so the
 * parts always sum exactly to `total` (plain proportional rounding can drift by a cent).
 */
export function allocateProportionally(total: Cents, weights: Cents[]): Cents[] {
  if (weights.length === 0) return [];
  if (total < 0) return allocateProportionally(-total, weights).map((v) => -v);

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    // No revenue to weight by — split evenly, remainder to the first lines.
    const base = Math.floor(total / weights.length);
    const remainder = total - base * weights.length;
    return weights.map((_, i) => base + (i < remainder ? 1 : 0));
  }

  const raw = weights.map((w) => (total * w) / weightSum);
  const floored = raw.map(Math.floor);
  let remainder = total - floored.reduce((a, b) => a + b, 0);

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}
