import { describe, expect, it } from "vitest";
import {
  aggregateByVendor,
  applyReportOptions,
  type ProductMarginRow,
} from "./productMargin";

function row(overrides: Partial<ProductMarginRow> = {}): ProductMarginRow {
  return {
    productId: "p1",
    title: "Product",
    vendor: "Acme",
    unitsSold: 1,
    orderCount: 1,
    revenue: 10000,
    discounts: 0,
    cogs: 4000,
    fees: 300,
    shippingDelta: 0,
    refunds: 0,
    contributionMargin: 5700,
    marginPercent: 0.57,
    estimated: false,
    costSource: "global",
    imageUrl: null,
    ...overrides,
  };
}

describe("applyReportOptions sorting", () => {
  const rows = [
    row({ productId: "a", title: "Alpha", contributionMargin: 500 }),
    row({ productId: "b", title: "Bravo", contributionMargin: -900 }),
    row({ productId: "c", title: "Charlie", contributionMargin: 100 }),
  ];

  it("defaults to worst margin first — the question the app exists to answer", () => {
    const report = applyReportOptions(rows, {});
    expect(report.rows.map((r) => r.productId)).toEqual(["b", "c", "a"]);
  });

  it("sorts descending when asked", () => {
    const report = applyReportOptions(rows, { sortDirection: "desc" });
    expect(report.rows.map((r) => r.productId)).toEqual(["a", "c", "b"]);
  });

  it("sorts by title alphabetically, not by codepoint", () => {
    const report = applyReportOptions(
      [row({ title: "Zebra" }), row({ title: "apple" }), row({ title: "Mango" })],
      { sortKey: "title" },
    );
    expect(report.rows.map((r) => r.title)).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("parks null margin percentages last regardless of direction", () => {
    const withNull = [
      row({ productId: "x", marginPercent: null, revenue: 0 }),
      row({ productId: "y", marginPercent: 0.1 }),
    ];
    expect(
      applyReportOptions(withNull, { sortKey: "marginPercent", sortDirection: "asc" }).rows[0]
        .productId,
    ).toBe("y");
    expect(
      applyReportOptions(withNull, { sortKey: "marginPercent", sortDirection: "desc" }).rows[0]
        .productId,
    ).toBe("y");
  });
});

describe("applyReportOptions filtering", () => {
  const rows = [
    row({ productId: "a", title: "Wool Blanket", vendor: "Northline" }),
    row({ productId: "b", title: "Ceramic Mug", vendor: "Amberwood", contributionMargin: -100 }),
    row({ productId: "c", title: "Wool Socks", vendor: "Amberwood" }),
  ];

  it("matches on title, case-insensitively", () => {
    const report = applyReportOptions(rows, { search: "wool" });
    expect(report.rows.map((r) => r.productId).sort()).toEqual(["a", "c"]);
  });

  it("matches on vendor too", () => {
    const report = applyReportOptions(rows, { search: "amberwood" });
    expect(report.totalRows).toBe(2);
  });

  it("filters to loss-makers", () => {
    const report = applyReportOptions(rows, { onlyNegative: true });
    expect(report.rows.map((r) => r.productId)).toEqual(["b"]);
  });

  it("combines search and the negative filter", () => {
    expect(applyReportOptions(rows, { search: "wool", onlyNegative: true }).totalRows).toBe(0);
  });

  it("ignores surrounding whitespace in the search term", () => {
    expect(applyReportOptions(rows, { search: "  mug  " }).totalRows).toBe(1);
  });
});

describe("applyReportOptions pagination", () => {
  const rows = Array.from({ length: 125 }, (_, i) =>
    row({ productId: `p${i}`, contributionMargin: i }),
  );

  it("returns one page at a time but counts every match", () => {
    const report = applyReportOptions(rows, { pageSize: 50 });
    expect(report.rows).toHaveLength(50);
    expect(report.totalRows).toBe(125);
  });

  it("returns the remainder on the last page", () => {
    expect(applyReportOptions(rows, { pageSize: 50, page: 3 }).rows).toHaveLength(25);
  });

  it("clamps a page past the end rather than returning nothing", () => {
    const report = applyReportOptions(rows, { pageSize: 50, page: 99 });
    expect(report.page).toBe(3);
    expect(report.rows).toHaveLength(25);
  });

  it("clamps a page below one", () => {
    expect(applyReportOptions(rows, { page: 0 }).page).toBe(1);
  });

  it("survives an empty result set", () => {
    const report = applyReportOptions([], {});
    expect(report).toMatchObject({ rows: [], totalRows: 0, page: 1 });
  });
});

describe("applyReportOptions totals", () => {
  it("totals the whole filtered set, not just the visible page", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ productId: `p${i}`, revenue: 1000, cogs: 400, contributionMargin: i < 3 ? -100 : 500 }),
    );
    const report = applyReportOptions(rows, { pageSize: 2 });
    expect(report.rows).toHaveLength(2);
    expect(report.totals.revenue).toBe(10000);
    expect(report.totals.cogs).toBe(4000);
    expect(report.totals.negativeProducts).toBe(3);
  });

  it("totals only what passed the filter", () => {
    const rows = [
      row({ productId: "a", revenue: 1000, contributionMargin: -50 }),
      row({ productId: "b", revenue: 9000, contributionMargin: 900 }),
    ];
    expect(applyReportOptions(rows, { onlyNegative: true }).totals.revenue).toBe(1000);
  });
});

describe("aggregateByVendor", () => {
  it("rolls products up and ranks worst margin first", () => {
    const result = aggregateByVendor([
      row({ productId: "a", vendor: "Acme", revenue: 10000, contributionMargin: 2000 }),
      row({ productId: "b", vendor: "Acme", revenue: 10000, contributionMargin: 1000 }),
      row({ productId: "c", vendor: "Beta", revenue: 5000, contributionMargin: -4000 }),
    ]);
    expect(result.map((v) => v.vendor)).toEqual(["Beta", "Acme"]);
    expect(result[1]).toMatchObject({ products: 2, revenue: 20000, contributionMargin: 3000 });
  });

  it("computes margin percent per vendor, not per product", () => {
    const [vendor] = aggregateByVendor([
      row({ productId: "a", vendor: "Acme", revenue: 8000, contributionMargin: 800 }),
      row({ productId: "b", vendor: "Acme", revenue: 2000, contributionMargin: 200 }),
    ]);
    expect(vendor.marginPercent).toBeCloseTo(0.1, 5);
  });

  it("leaves products with no vendor out rather than inventing an 'Other' supplier", () => {
    const result = aggregateByVendor([
      row({ productId: "a", vendor: null }),
      row({ productId: "b", vendor: "   " }),
      row({ productId: "c", vendor: "Real" }),
    ]);
    expect(result.map((v) => v.vendor)).toEqual(["Real"]);
  });

  it("reports no margin percent for a vendor that took no revenue", () => {
    const [vendor] = aggregateByVendor([
      row({ productId: "a", vendor: "Acme", revenue: 0, contributionMargin: 0 }),
    ]);
    expect(vendor.marginPercent).toBeNull();
  });
});
