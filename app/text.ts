/**
 * Copy helpers shared across routes and reports.
 *
 * `dayWord` exists because the reporting window is genuinely one day on a fresh
 * install — the store has a single day of orders until the backfill's history
 * accumulates — so "the last 1 days" is what a merchant reads on first run, which
 * is the worst possible moment for it. The seeded dataset always spans ~89 days,
 * so no local check would ever surface it.
 */
export function dayWord(count: number): string {
  return count === 1 ? "day" : "days";
}
