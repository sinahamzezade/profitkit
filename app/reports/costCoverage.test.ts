import { describe, expect, it } from "vitest";
import { buildCostCoverage } from "./costCoverage";
import type { ProductMarginRow } from "./productMargin";

function row(overrides: Partial<ProductMarginRow> = {}): ProductMarginRow {
  return {
    productId: "p",
    title: "Product",
    vendor: "Acme",
    unitsSold: 5,
    orderCount: 5,
    revenue: 10000,
    discounts: 0,
    cogs: 4500,
    fees: 300,
    shippingDelta: 0,
    refunds: 0,
    contributionMargin: 5200,
    marginPercent: 0.52,
    estimated: true,
    costSource: "global",
    imageUrl: null,
    ...overrides,
  };
}

describe("buildCostCoverage", () => {
  it("collapses the six ladder sources into four states a merchant can act on", () => {
    const coverage = buildCostCoverage([
      row({ productId: "a", costSource: "variant_override" }),
      row({ productId: "b", costSource: "native" }),
      row({ productId: "c", costSource: "vendor" }),
      row({ productId: "d", costSource: "global" }),
      row({ productId: "e", costSource: "none" }),
    ]);

    const byTier = Object.fromEntries(coverage.bands.map((b) => [b.tier, b.products]));
    expect(byTier).toEqual({ measured: 2, grouped: 1, estimated: 1, unset: 1 });
  });

  it("weights looseness by revenue, not product count", () => {
    // One big seller on a guess outweighs three tiny ones on exact costs.
    const coverage = buildCostCoverage([
      row({ productId: "big", costSource: "global", revenue: 90000 }),
      row({ productId: "s1", costSource: "native", revenue: 4000 }),
      row({ productId: "s2", costSource: "native", revenue: 3000 }),
      row({ productId: "s3", costSource: "native", revenue: 3000 }),
    ]);
    expect(coverage.looseShare).toBeCloseTo(0.9, 5);
  });

  it("names the vendor worth fixing next by revenue at stake", () => {
    const coverage = buildCostCoverage([
      // More products, but far less revenue riding on them.
      row({ productId: "a", vendor: "Small Co", costSource: "global", revenue: 1000 }),
      row({ productId: "b", vendor: "Small Co", costSource: "global", revenue: 1000 }),
      row({ productId: "c", vendor: "Big Co", costSource: "global", revenue: 50000 }),
    ]);
    expect(coverage.nextStep).toEqual({ vendor: "Big Co", products: 1, revenue: 50000 });
  });

  it("suggests nothing once every cost is measured", () => {
    const coverage = buildCostCoverage([
      row({ productId: "a", costSource: "native" }),
      row({ productId: "b", costSource: "variant_override" }),
    ]);
    expect(coverage.looseShare).toBe(0);
    expect(coverage.nextStep).toBeNull();
  });

  it("ignores products with no vendor when suggesting a next step", () => {
    const coverage = buildCostCoverage([
      row({ productId: "a", vendor: null, costSource: "global", revenue: 90000 }),
      row({ productId: "b", vendor: "Named", costSource: "global", revenue: 1000 }),
    ]);
    expect(coverage.nextStep?.vendor).toBe("Named");
  });

  it("survives an empty catalog without dividing by zero", () => {
    expect(buildCostCoverage([])).toMatchObject({
      bands: [],
      totalProducts: 0,
      looseShare: 0,
      nextStep: null,
    });
  });
});
