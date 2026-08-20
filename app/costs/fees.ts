import type { Cents } from "../margin/types";
import type { FeeRule, ResolvedFee, ResolvedShippingCost, ShippingCostConfig } from "./types";

/**
 * The field audit confirmed transactions.fees is empty for every gateway except
 * Shopify Payments — and Shopify Payments has no AED/SAR settlement, so for GCC
 * merchants it is empty always. Modeled rules aren't a fallback here, they're the
 * only path, which is why "no rule configured" returns a zero rule flagged as an
 * estimate rather than silently guessing an industry-average percentage.
 */
export function resolveFee(
  gatewayName: string | null,
  reportedFeeCents: Cents | null,
  rules: FeeRule[],
): ResolvedFee {
  if (reportedFeeCents != null) {
    // Shopify told us the real settled fee. Express it as a flat amount — there's
    // no rate to infer from a single number, and the caller adds percent × base + flat.
    return { percent: 0, flatCents: reportedFeeCents, estimated: false, source: "reported" };
  }

  const rule = gatewayName
    ? rules.find((r) => r.gatewayName.toLowerCase() === gatewayName.toLowerCase())
    : undefined;
  if (rule) {
    return { percent: rule.percent, flatCents: rule.flatCents, estimated: true, source: "rule" };
  }

  return { percent: 0, flatCents: 0, estimated: true, source: "default" };
}

/**
 * Actual shipping cost does not exist anywhere in the Shopify API — confirmed absent
 * from the schema, not merely null. It is always a merchant input, so the ladder here
 * has exactly one rung until per-variant weights arrive.
 */
export function resolveShippingCost(config: ShippingCostConfig): ResolvedShippingCost {
  if (config.globalPerOrderCents != null) {
    return { cents: config.globalPerOrderCents, estimated: true, source: "global" };
  }
  return { cents: 0, estimated: true, source: "none" };
}
