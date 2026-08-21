import { describe, expect, it } from "vitest";
import { buildHeroReport, isSuspect } from "./lossLeaders";
import type { ProductMarginRow } from "./productMargin";

function row(overrides: Partial<ProductMarginRow> = {}): ProductMarginRow {
  const base: ProductMarginRow = {
    productId: "p",
    title: "Product",
    vendor: "Acme",
    unitsSold: 10,
    orderCount: 10,
    revenue: 100000,
    discounts: 5000,
    cogs: 45000,
    fees: 3000,
    shippingDelta: 2000,
    refunds: 2000,
    contributionMargin: 48000,
    marginPercent: 0.48,
    estimated: true,
    costSource: "global",
    imageUrl: null,
    ...overrides,
  };
  return base;
}

/** A catalog of ordinary products, so medians reflect a normal store. */
function normalCatalog(count = 8): ProductMarginRow[] {
  return Array.from({ length: count }, (_, i) => row({ productId: `normal-${i}` }));
}

const options = { periodDays: 90, currency: "USD" };

describe("buildHeroReport ranking", () => {
  it("returns negative-margin products worst first", () => {
    const rows = [
      ...normalCatalog(),
      row({ productId: "a", contributionMargin: -500 }),
      row({ productId: "b", contributionMargin: -9000 }),
      row({ productId: "c", contributionMargin: -100 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers.map((l) => l.row.productId)).toEqual(["b", "a", "c"]);
  });

  it("caps the list at ten", () => {
    const rows = [
      ...normalCatalog(),
      ...Array.from({ length: 25 }, (_, i) =>
        row({ productId: `loss-${i}`, contributionMargin: -(i + 1) * 100 }),
      ),
    ];
    expect(buildHeroReport(rows, options).losers).toHaveLength(10);
  });

  it("totals what the listed products lost", () => {
    const rows = [
      ...normalCatalog(),
      row({ productId: "a", contributionMargin: -500 }),
      row({ productId: "b", contributionMargin: -1500 }),
    ];
    expect(buildHeroReport(rows, options).totalLost).toBe(-2000);
  });

  it("leaves profitable products out of the list entirely", () => {
    expect(buildHeroReport(normalCatalog(), options).losers).toHaveLength(0);
  });
});

describe("buildHeroReport empty state", () => {
  it("falls back to the three thinnest margins when nothing loses money", () => {
    const rows = [
      row({ productId: "fat", marginPercent: 0.6, contributionMargin: 60000 }),
      row({ productId: "thin-1", marginPercent: 0.02, contributionMargin: 2000 }),
      row({ productId: "thin-2", marginPercent: 0.05, contributionMargin: 5000 }),
      row({ productId: "thin-3", marginPercent: 0.08, contributionMargin: 8000 }),
      row({ productId: "thin-4", marginPercent: 0.12, contributionMargin: 12000 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers).toHaveLength(0);
    expect(report.thinnest.map((r) => r.productId)).toEqual(["thin-1", "thin-2", "thin-3"]);
  });

  it("ignores products with no revenue when picking thin margins", () => {
    const rows = [
      row({ productId: "never-sold", revenue: 0, marginPercent: null, contributionMargin: 0 }),
      row({ productId: "thin", marginPercent: 0.01, contributionMargin: 1000 }),
    ];
    expect(buildHeroReport(rows, options).thinnest.map((r) => r.productId)).toEqual(["thin"]);
  });

  it("copes with an empty catalog", () => {
    const report = buildHeroReport([], options);
    expect(report).toMatchObject({ losers: [], thinnest: [], suspect: [], totalLost: 0 });
  });
});

describe("suspect cost data", () => {
  it("flags a cost far above revenue as a data problem", () => {
    expect(isSuspect(row({ revenue: 3699, cogs: 123400 }))).toBe(true);
    expect(isSuspect(row({ revenue: 10000, cogs: 12000 }))).toBe(false);
  });

  it("does not treat a zero-revenue product as suspect", () => {
    expect(isSuspect(row({ revenue: 0, cogs: 5000 }))).toBe(false);
  });

  it("keeps a mistyped cost out of the ranking so it can't define the view", () => {
    const rows = [
      ...normalCatalog(),
      row({ productId: "typo", revenue: 3699, cogs: 123400, contributionMargin: -3850023 }),
      row({ productId: "real", contributionMargin: -5000 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers.map((l) => l.row.productId)).toEqual(["real"]);
    expect(report.suspect.map((r) => r.productId)).toEqual(["typo"]);
  });

  it("excludes suspect products from the catalog norms", () => {
    // A 3300%-of-revenue COGS outlier would otherwise drag the median and make
    // genuinely high-cost products look average.
    const rows = [
      ...normalCatalog(),
      row({ productId: "typo", revenue: 3699, cogs: 123400, contributionMargin: -3850023 }),
      row({ productId: "real", cogs: 90000, contributionMargin: -5000 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers[0].driver).toBe("cogs");
  });
});

describe("loss driver attribution", () => {
  it("blames shipping when shipping is the abnormal cost, not COGS", () => {
    const rows = [
      ...normalCatalog(),
      row({
        productId: "heavy",
        cogs: 45000, // exactly the catalog norm
        shippingDelta: 60000, // wildly above it
        contributionMargin: -12000,
        orderCount: 20,
      }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers[0].driver).toBe("shipping");
    expect(report.losers[0].explanation).toContain("per order");
  });

  it("blames refunds when refunds are the outlier", () => {
    const rows = [
      ...normalCatalog(),
      row({ productId: "returned", refunds: 70000, contributionMargin: -20000 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers[0].driver).toBe("refunds");
    expect(report.losers[0].explanation).toContain("refunds");
  });

  it("blames discounts when discounts are the outlier", () => {
    const rows = [
      ...normalCatalog(),
      row({ productId: "discounted", discounts: 60000, contributionMargin: -8000 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers[0].driver).toBe("discounts");
  });

  it("explains rather than printing a percentage above 100 when refunds exceed revenue", () => {
    // Real at a window boundary: an order placed before the period and refunded
    // inside it contributes a refund with no matching revenue.
    const rows = [
      ...normalCatalog(),
      row({ productId: "boundary", revenue: 42442, refunds: 52197, contributionMargin: -30881 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers[0].driver).toBe("refunds");
    expect(report.losers[0].explanation).not.toMatch(/\d{3,}%/);
    expect(report.losers[0].explanation).toContain("orders placed earlier");
  });

  it("offers the diagnosis without the amount, for surfaces that already show it", () => {
    const rows = [...normalCatalog(), row({ productId: "a", contributionMargin: -34000 })];
    const leader = buildHeroReport(rows, options).losers[0];
    expect(leader.diagnosis).not.toContain("$340.00");
    expect(leader.diagnosis).not.toContain("90 days");
    // The full sentence stays intact for surfaces that need it standalone.
    expect(leader.explanation).toBe(`This product lost $340.00 in 90 days. ${leader.diagnosis}`);
  });

  it("reports loss per unit, which separates a broken product from a busy one", () => {
    const rows = [
      ...normalCatalog(),
      // Loses far more in total, but barely anything per sale — a volume problem.
      row({ productId: "busy", contributionMargin: -20000, unitsSold: 400 }),
      // Loses less in total but bleeds on every sale — structurally broken.
      row({ productId: "broken", contributionMargin: -6000, unitsSold: 4 }),
    ];
    const report = buildHeroReport(rows, options);
    const busy = report.losers.find((l) => l.row.productId === "busy")!;
    const broken = report.losers.find((l) => l.row.productId === "broken")!;

    expect(busy.lossPerUnit).toBe(-50);
    expect(broken.lossPerUnit).toBe(-1500);
    // Ranking still follows total loss; per-unit is diagnosis, not priority.
    expect(report.losers[0].row.productId).toBe("busy");
  });

  it("returns no per-unit figure when nothing was kept after refunds", () => {
    const rows = [...normalCatalog(), row({ productId: "a", contributionMargin: -500, unitsSold: 0 })];
    expect(buildHeroReport(rows, options).losers[0].lossPerUnit).toBeNull();
  });

  it("says the price is too low when no single cost is abnormal", () => {
    // Every cost sits at the catalog norm; the product still loses money.
    const rows = [
      ...normalCatalog(),
      row({ productId: "underpriced", contributionMargin: -3000 }),
    ];
    const report = buildHeroReport(rows, options);
    expect(report.losers[0].driver).toBe("low_price");
    expect(report.losers[0].explanation).toContain("price just doesn't cover");
  });

  it("states the amount lost and the period in every sentence", () => {
    const rows = [...normalCatalog(), row({ productId: "a", contributionMargin: -34000 })];
    const report = buildHeroReport(rows, { periodDays: 60, currency: "USD" });
    expect(report.losers[0].explanation).toContain("$340.00");
    expect(report.losers[0].explanation).toContain("60 days");
  });

  it("formats the shipping sentence the way the brief specifies", () => {
    const rows = [
      ...normalCatalog(),
      row({
        productId: "heavy",
        cogs: 45000,
        shippingDelta: 7200,
        orderCount: 10,
        contributionMargin: -34000,
      }),
    ];
    const report = buildHeroReport(rows, { periodDays: 90, currency: "USD" });
    expect(report.losers[0].explanation).toBe(
      "This product lost $340.00 in 90 days. Shipping costs exceed what you charge " +
        "by an average of $7.20 per order.",
    );
  });
});
