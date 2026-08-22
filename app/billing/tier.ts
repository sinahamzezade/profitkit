/**
 * Tier gating.
 *
 * The rule from the brief: gate at the data-fetch layer, not the UI, or it's
 * trivially bypassed. So the free tier doesn't get a full report with parts
 * greyed out — it gets a genuinely shorter window of data, decided here and
 * applied as a query bound before anything is read.
 *
 * The free tier is a commitment, not a trial. Product-level margin over the
 * trailing window is complete and useful on its own; Pro adds history depth,
 * channel breakdown and export, not basic usability.
 */

export type Tier = "free" | "pro";

/** Trailing days of history each tier can see. Pro is unbounded. */
export const FREE_TIER_WINDOW_DAYS = 90;

export interface TierLimits {
  tier: Tier;
  /** Oldest date this tier may query, or null for no bound. */
  since: Date | null;
  windowDays: number | null;
  canExport: boolean;
}

/**
 * `now` is injected rather than read from the clock so the boundary is testable
 * and so a single request computes one consistent cutoff.
 */
export function resolveTierLimits(tier: Tier, now: Date): TierLimits {
  if (tier === "pro") {
    return { tier, since: null, windowDays: null, canExport: true };
  }
  const since = new Date(now.getTime() - FREE_TIER_WINDOW_DAYS * 86_400_000);
  return { tier, since, windowDays: FREE_TIER_WINDOW_DAYS, canExport: false };
}

/**
 * Thrown rather than silently returning empty data: a free-tier caller reaching a
 * Pro-only path is a bug in the caller, and swallowing it would hide the mistake
 * until a merchant found it.
 */
export class TierRequiredError extends Error {
  constructor(feature: string) {
    super(`${feature} requires the Pro plan.`);
    this.name = "TierRequiredError";
  }
}

export function assertCanExport(limits: TierLimits): void {
  if (!limits.canExport) throw new TierRequiredError("Accountant export");
}

/**
 * Resolves the tier for a shop. Real billing arrives on day 9 with the Billing API;
 * until then every shop is free tier, which is the safe default — it under-serves
 * rather than silently handing out Pro data.
 */
/**
 * The slice of Shopify's billing helper this module needs, so tests can fake it.
 *
 * `plans` is deliberately omitted from the call: the library derives its type from
 * the app's billing config, and there is exactly one plan, so checking all of them
 * asks the same question without depending on that inference.
 */
export interface BillingChecker {
  check(options: { isTest: boolean }): Promise<{ hasActivePayment: boolean }>;
}

/**
 * Resolves the tier from Shopify's Billing API — the only authority on whether a
 * merchant is actually paying. A failed check resolves to free rather than
 * throwing: a billing outage should degrade the report window, not take the app
 * down, and erring toward free never gives away paid data.
 */
export async function resolveTierForShop(
  shopDomain: string,
  billing?: BillingChecker,
): Promise<Tier> {
  void shopDomain;

  // Development-only override so the Pro paths can be exercised without a real
  // subscription. Deliberately ignored outside development: an env var must never
  // be able to hand out a paid tier on a deployed app.
  // eslint-disable-next-line no-undef
  if (process.env.NODE_ENV !== "production" && process.env.REDLINE_FORCE_TIER === "pro") {
    return "pro";
  }

  if (!billing) return "free";

  try {
    const { hasActivePayment } = await billing.check({
      // Dev stores can't take real payments, so subscriptions there must be test ones.
      // eslint-disable-next-line no-undef
      isTest: process.env.NODE_ENV !== "production",
    });
    return hasActivePayment ? "pro" : "free";
  } catch {
    return "free";
  }
}
