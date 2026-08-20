/**
 * Billing configuration for the single paid plan.
 *
 * $29 against a ~$92 ecosystem average is a deliberate wedge, not underpricing,
 * so the amount lives here as a named constant rather than scattered through UI
 * copy where it can drift out of sync with what Shopify actually charges.
 */
import { BillingInterval } from "@shopify/shopify-api";

export const PRO_PLAN = {
  name: "Pro",
  amount: 29,
  currencyCode: "USD",
  // The library's enum, not the raw string: a plain string fails to satisfy the
  // billing config type, which silently collapses plan inference to `never`.
  interval: BillingInterval.Every30Days,
  trialDays: 0,
} as const;

/** Matches the plan name registered with Shopify's Billing API. */
export const PRO_PLAN_NAME = PRO_PLAN.name;
