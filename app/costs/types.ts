import type { Cents } from "../margin/types";

/**
 * The cost-assumptions ladder. Three inputs Shopify can't reliably give us —
 * COGS, gateway fees, shipping cost — resolved through one shared pattern:
 * precise data if it exists, a group-level override if not, a global estimate
 * as the floor. Every resolution reports where it came from and whether it's
 * an estimate, because the UI has to label estimated figures as estimated.
 */

export type CogsScope = "variant" | "collection" | "vendor" | "global";

/** One row of the merchant's cost configuration. Mirrors the CogsEntry table. */
export interface CogsEntry {
  scope: CogsScope;
  /** Variant gid, collection id, or vendor name. Null for global. */
  scopeKey: string | null;
  /** Absolute cost. Takes precedence over costPercent when both are set. */
  costCents: Cents | null;
  /** Cost as a fraction of price, e.g. 0.4 for 40%. */
  costPercent: number | null;
}

/** What we know about the variant we're pricing, from the products/variants tables. */
export interface CogsTarget {
  variantGid: string;
  priceCents: Cents;
  /** Shopify's native inventoryItem.unitCost. Rung 0 — real data, not an estimate. */
  nativeCogsCents: Cents | null;
  vendor: string | null;
  collectionIds: string[];
}

export type CogsSource =
  | "variant_override"
  | "native"
  | "collection"
  | "vendor"
  | "global"
  | "none";

export interface ResolvedCogs {
  cents: Cents;
  /** True whenever the figure is modeled rather than known. Drives the "estimated" label in the UI. */
  estimated: boolean;
  source: CogsSource;
}

export interface FeeRule {
  gatewayName: string;
  percent: number;
  flatCents: Cents;
}

export interface ResolvedFee {
  percent: number;
  flatCents: Cents;
  estimated: boolean;
  source: "reported" | "rule" | "default";
}

export interface ShippingCostConfig {
  /** Flat per-order shipping cost estimate, the only rung merchants can realistically fill in first. */
  globalPerOrderCents: Cents | null;
}

export interface ResolvedShippingCost {
  cents: Cents;
  estimated: boolean;
  source: "global" | "none";
}
