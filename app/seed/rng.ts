/** Seeded PRNG (mulberry32) — deterministic so a generated dataset is reproducible and debuggable. */
export function createRng(seed: number) {
  let a = seed >>> 0;

  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function float(min: number, max: number): number {
    return next() * (max - min) + min;
  }

  function bool(probability: number): boolean {
    return next() < probability;
  }

  function pick<T>(items: readonly T[]): T {
    return items[int(0, items.length - 1)];
  }

  /** Weighted pick — weights don't need to sum to 1. */
  function weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((sum, i) => sum + i.weight, 0);
    let roll = next() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item.value;
    }
    return items[items.length - 1].value;
  }

  return { next, int, float, bool, pick, weighted };
}

export type Rng = ReturnType<typeof createRng>;
