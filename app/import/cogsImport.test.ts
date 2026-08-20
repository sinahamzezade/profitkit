import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import {
  buildErrorReportCsv,
  importableRows,
  suggestColumnMapping,
  validateImport,
  type CatalogEntry,
} from "./cogsImport";

const catalog: CatalogEntry[] = [
  { variantGid: "gid://shopify/ProductVariant/1", sku: "MUG-01" },
  { variantGid: "gid://shopify/ProductVariant/2", sku: "TOTE-02" },
  { variantGid: "gid://shopify/ProductVariant/3", sku: "LAMP-03" },
  { variantGid: "gid://shopify/ProductVariant/4", sku: null },
];

describe("suggestColumnMapping", () => {
  it("finds conventional headers", () => {
    expect(suggestColumnMapping(["SKU", "Title", "Cost per item"])).toEqual({
      sku: 0,
      variantId: null,
      cost: 2,
    });
  });

  it("handles columns in an unexpected order", () => {
    expect(suggestColumnMapping(["Unit Cost", "Product", "Variant ID", "sku"])).toEqual({
      sku: 3,
      variantId: 2,
      cost: 0,
    });
  });

  it("prefers an exact header over one that merely contains the hint", () => {
    expect(suggestColumnMapping(["Cost Center", "Cost", "SKU"]).cost).toBe(1);
  });

  it("returns nulls when nothing looks right, rather than guessing", () => {
    expect(suggestColumnMapping(["alpha", "beta"])).toEqual({
      sku: null,
      variantId: null,
      cost: null,
    });
  });

  it("does not claim one column as both sku and variant id", () => {
    const mapping = suggestColumnMapping(["sku", "cost"]);
    expect(mapping.sku).toBe(0);
    expect(mapping.variantId).toBeNull();
  });
});

describe("validateImport", () => {
  const mapping = { sku: 0, variantId: null, cost: 1 };

  it("matches on SKU case-insensitively and ignoring padding", () => {
    const summary = validateImport([["  mug-01 ", "4.00"]], mapping, catalog);
    expect(summary.rows[0].status).toBe("matched");
    expect(summary.rows[0].variantGid).toBe("gid://shopify/ProductVariant/1");
    expect(summary.rows[0].costCents).toBe(400);
  });

  it("skips blank rows instead of failing them", () => {
    const summary = validateImport([["", ""], ["MUG-01", "4.00"]], mapping, catalog);
    expect(summary.rows[0].status).toBe("skipped");
    expect(summary.skipped).toBe(1);
    expect(summary.matched).toBe(1);
  });

  it("errors on an unknown SKU without touching the other rows", () => {
    const summary = validateImport(
      [["NOPE-99", "4.00"], ["MUG-01", "4.00"]],
      mapping,
      catalog,
    );
    expect(summary.rows[0].status).toBe("error");
    expect(summary.rows[0].message).toContain("no product with SKU");
    expect(summary.matched).toBe(1);
  });

  it("refuses to guess when a SKU is on more than one variant", () => {
    const ambiguous: CatalogEntry[] = [
      { variantGid: "gid://shopify/ProductVariant/1", sku: "DUP" },
      { variantGid: "gid://shopify/ProductVariant/2", sku: "DUP" },
    ];
    const summary = validateImport([["DUP", "4.00"]], mapping, ambiguous);
    expect(summary.rows[0].status).toBe("error");
    expect(summary.rows[0].message).toContain("2 variants");
  });

  it("falls back to variant id when the SKU column is empty", () => {
    const summary = validateImport(
      [["", "gid://shopify/ProductVariant/4", "9.00"]],
      { sku: 0, variantId: 1, cost: 2 },
      catalog,
    );
    expect(summary.rows[0].status).toBe("matched");
    expect(summary.rows[0].variantGid).toBe("gid://shopify/ProductVariant/4");
  });

  it("rescues a row whose SKU is wrong but whose variant id is right", () => {
    const summary = validateImport(
      [["WRONG", "gid://shopify/ProductVariant/2", "9.00"]],
      { sku: 0, variantId: 1, cost: 2 },
      catalog,
    );
    expect(summary.rows[0].status).toBe("matched");
    expect(summary.rows[0].variantGid).toBe("gid://shopify/ProductVariant/2");
  });

  it("flags a row that identifies no product at all", () => {
    const summary = validateImport(
      [["", "", "9.00"]],
      { sku: 0, variantId: 1, cost: 2 },
      catalog,
    );
    expect(summary.rows[0].message).toContain("neither a SKU nor a variant id");
  });

  it("flags contradictory duplicate rows instead of letting the last one win", () => {
    const summary = validateImport(
      [["MUG-01", "4.00"], ["MUG-01", "9.00"]],
      mapping,
      catalog,
    );
    expect(summary.rows[0].status).toBe("matched");
    expect(summary.rows[1].status).toBe("error");
    expect(summary.rows[1].message).toContain("line 2");
    expect(importableRows(summary)).toEqual([
      { variantGid: "gid://shopify/ProductVariant/1", costCents: 400 },
    ]);
  });

  it("reports how many catalog variants the file never covered", () => {
    const summary = validateImport([["MUG-01", "4.00"]], mapping, catalog);
    expect(summary.unmatchedCatalogCount).toBe(3);
  });

  it("flags a row with more values than the file has columns", () => {
    // "€12,00" left unquoted in a comma-delimited file: every later column shifts,
    // so the cost read from it would be wrong rather than merely missing.
    const summary = validateImport([["€12", "00", "Tote", "TOTE-02"]], mapping, catalog, 3);
    expect(summary.rows[0].status).toBe("error");
    expect(summary.rows[0].message).toContain("unquoted delimiter");
  });

  it("tolerates a row with fewer values than columns", () => {
    const summary = validateImport([["MUG-01", "4.00"]], mapping, catalog, 3);
    expect(summary.rows[0].status).toBe("matched");
  });

  it("warns when an imported cost dwarfs the price, without rejecting it", () => {
    const priced: CatalogEntry[] = [
      { variantGid: "gid://shopify/ProductVariant/1", sku: "MUG-01", priceCents: 3699 },
    ];
    const summary = validateImport([["MUG-01", "1234.00"]], mapping, priced);
    expect(summary.rows[0].status).toBe("matched");
    expect(summary.rows[0].warning).toContain("3x the price");
  });

  it("accepts a below-cost price without complaint", () => {
    const priced: CatalogEntry[] = [
      { variantGid: "gid://shopify/ProductVariant/1", sku: "MUG-01", priceCents: 1000 },
    ];
    // $12.00 cost against a $10.00 price: below margin, but entirely plausible.
    const summary = validateImport([["MUG-01", "12.00"]], mapping, priced);
    expect(summary.rows[0].costCents).toBe(1200);
    expect(summary.rows[0].warning).toBeNull();
  });

  it("refuses to run without the columns it needs", () => {
    expect(() => validateImport([], { sku: 0, variantId: null, cost: null }, catalog)).toThrow(
      /cost column/,
    );
    expect(() => validateImport([], { sku: null, variantId: null, cost: 1 }, catalog)).toThrow(
      /SKU column or a variant-id column/,
    );
  });
});

describe("messy real-world file", () => {
  // Wrong column order, a blank line, currency symbols, a missing SKU, an unknown
  // SKU, a junk cost, and a European decimal comma — the acceptance case.
  const file = [
    "Cost,Product Name,sku",
    '"$4.50","Mug, large",MUG-01',
    "",
    '"€12,00",Tote bag,TOTE-02',
    "9.99,Orphan product,GHOST-99",
    "n/a,Lamp,LAMP-03",
    "7.00,Nameless,",
  ].join("\n");

  const { headers, rows } = parseCsv(file);
  const mapping = suggestColumnMapping(headers);
  const summary = validateImport(rows, mapping, catalog);

  it("maps columns despite the unexpected order", () => {
    expect(mapping).toEqual({ sku: 2, variantId: null, cost: 0 });
  });

  it("imports the good rows and only the good rows", () => {
    expect(importableRows(summary)).toEqual([
      { variantGid: "gid://shopify/ProductVariant/1", costCents: 450 },
      { variantGid: "gid://shopify/ProductVariant/2", costCents: 1200 },
    ]);
  });

  it("accounts for every line", () => {
    expect(summary.matched).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.errored).toBe(3);
    expect(summary.rows).toHaveLength(6);
  });

  it("produces an error report naming each problem and its line", () => {
    const report = buildErrorReportCsv(summary, headers)!;
    const lines = report.split("\n");
    expect(lines[0]).toBe("line,status,problem,Cost,Product Name,sku");
    expect(report).toContain("no product with SKU");
    expect(report).toContain("not a number");
    expect(report).toContain("neither a SKU nor a variant id");
    // The merchant's original values survive into the report so the file can be fixed in place.
    expect(report).toContain("GHOST-99");
    expect(lines).toHaveLength(4);
  });

  it("returns no report at all when nothing went wrong", () => {
    const clean = validateImport([["4.00", "Mug", "MUG-01"]], mapping, catalog);
    expect(buildErrorReportCsv(clean, headers)).toBeNull();
  });
});
