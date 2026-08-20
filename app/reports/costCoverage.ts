import type { CogsSource } from "../costs/types";
import type { Cents } from "../margin/types";
import type { ProductMarginRow } from "./productMargin";

/**
 * How much of the catalog's cost data is measured versus guessed.
 *
 * Every margin figure in this app is only as good as its cost input, and until now
 * nothing told a merchant how solid that input was — one universal "Est." badge
 * said everything was estimated, which is true but useless. This says which rung of
 * the ladder each product sits on, and weights it by revenue, because a guess on a
 * product that sells nothing barely matters and a guess on the bestseller matters a lot.
 */

export type CoverageTier = "measured" | "grouped" | "estimated" | "unset";

/** Collapses the ladder's six sources into the four states a merchant can act on. */
const TIER_BY_SOURCE: Record<CogsSource, CoverageTier> = {
  variant_override: "measured",
  native: "measured",
  collection: "grouped",
  vendor: "grouped",
  global: "estimated",
  none: "unset",
};

export const TIER_LABELS: Record<CoverageTier, string> = {
  measured: "Exact cost",
  grouped: "By vendor",
  estimated: "Global estimate",
  unset: "No cost set",
};

export interface CoverageBand {
  tier: CoverageTier;
  products: number;
  /** Revenue riding on this tier — the reason to care about it. */
  revenue: Cents;
}

export interface CostCoverage {
  bands: CoverageBand[];
  totalProducts: number;
  totalRevenue: Cents;
  /** Share of revenue whose cost is a global estimate or missing entirely. */
  looseShare: number;
  /** The single next thing worth doing, or null when cost data is already solid. */
  nextStep: { vendor: string; products: number; revenue: Cents } | null;
}

const TIER_ORDER: CoverageTier[] = ["measured", "grouped", "estimated", "unset"];

export function buildCostCoverage(rows: ProductMarginRow[]): CostCoverage {
  const byTier = new Map<CoverageTier, CoverageBand>(
    TIER_ORDER.map((tier) => [tier, { tier, products: 0, revenue: 0 }]),
  );

  let totalRevenue = 0;
  let looseRevenue = 0;
  // Vendors whose products still ride on the global estimate: the cheapest
  // meaningful improvement a merchant can make is one number per vendor.
  const looseByVendor = new Map<string, { products: number; revenue: Cents }>();

  for (const row of rows) {
    const tier = TIER_BY_SOURCE[row.costSource];
    const band = byTier.get(tier)!;
    band.products += 1;
    band.revenue += row.revenue;
    totalRevenue += row.revenue;

    if (tier === "estimated" || tier === "unset") {
      looseRevenue += row.revenue;
      const vendor = row.vendor?.trim();
      if (vendor) {
        const entry = looseByVendor.get(vendor) ?? { products: 0, revenue: 0 };
        entry.products += 1;
        entry.revenue += row.revenue;
        looseByVendor.set(vendor, entry);
      }
    }
  }

  // Rank by revenue, not product count: setting a cost for the vendor behind the
  // most sales sharpens the most numbers.
  const [topVendor] = [...looseByVendor.entries()].sort((a, b) => b[1].revenue - a[1].revenue);

  return {
    bands: TIER_ORDER.map((tier) => byTier.get(tier)!).filter((b) => b.products > 0),
    totalProducts: rows.length,
    totalRevenue,
    looseShare: totalRevenue === 0 ? 0 : looseRevenue / totalRevenue,
    nextStep: topVendor ? { vendor: topVendor[0], ...topVendor[1] } : null,
  };
}
