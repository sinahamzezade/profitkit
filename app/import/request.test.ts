import { describe, expect, it } from "vitest";

import {
  countProblems,
  describeDelimiter,
  describeProblems,
  mappingError,
  MAX_ROWS,
  MAX_TEXT_BYTES,
  prepareImport,
  PROBLEM_LIMIT,
  readMapping,
  TEMPLATE_COST_INDEX,
  TEMPLATE_HEADERS,
} from "./request";
import {
  suggestColumnMapping,
  validateImport,
  type ValidatedRow,
  type ValidationSummary,
} from "./cogsImport";

describe("prepareImport", () => {
  it("accepts a normal cost sheet and reports what it found", () => {
    const result = prepareImport("sku,cost\nWB-1,20.00\nWB-2,31.50\n");

    expect(result).toMatchObject({ ok: true, delimiter: "," });
    if (!result.ok) throw new Error("expected ok");
    expect(result.headers).toEqual(["sku", "cost"]);
    expect(result.rows).toHaveLength(2);
  });

  it("rejects an empty file with advice rather than a parse result", () => {
    // A merchant who picked the wrong file wants to be told that, not shown
    // several thousand match failures.
    expect(prepareImport("   \n  ")).toEqual({
      ok: false,
      error: "That file looks empty.",
    });
  });

  it("rejects a file with no header row", () => {
    expect(prepareImport("\n")).toMatchObject({ ok: false });
  });

  it("refuses a file larger than the byte cap before parsing it", () => {
    const huge = "a".repeat(MAX_TEXT_BYTES + 1);
    const result = prepareImport(huge);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toMatch(/larger than/);
  });

  it("refuses more rows than the cap, naming both numbers", () => {
    // The cap exists so one paste cannot occupy a worker validating it.
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `SKU-${i},1.00`);
    const result = prepareImport(`sku,cost\n${rows.join("\n")}`);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toContain((MAX_ROWS + 1).toLocaleString());
    expect(result.error).toContain(MAX_ROWS.toLocaleString());
  });

  it("allows exactly the cap", () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => `SKU-${i},1.00`);
    expect(prepareImport(`sku,cost\n${rows.join("\n")}`).ok).toBe(true);
  });
});

describe("readMapping", () => {
  it("reads three column indexes", () => {
    expect(readMapping({ sku: "0", variantId: "2", cost: "1" })).toEqual({
      sku: 0,
      variantId: 2,
      cost: 1,
    });
  });

  it("treats an empty string as 'not in this file'", () => {
    expect(readMapping({ sku: "0", variantId: "", cost: "1" })).toEqual({
      sku: 0,
      variantId: null,
      cost: 1,
    });
  });

  it("turns junk into null rather than NaN", () => {
    // A mapping index that became NaN would read every cost as blank and report
    // the entire file as broken, which looks like a bad file rather than a bad
    // mapping.
    expect(readMapping({ sku: "abc", variantId: "-1", cost: "1.5" })).toEqual({
      sku: null,
      variantId: null,
      cost: null,
    });
  });

  it("handles missing keys", () => {
    expect(readMapping({})).toEqual({ sku: null, variantId: null, cost: null });
  });
});

describe("mappingError", () => {
  it("requires a cost column", () => {
    expect(mappingError({ sku: 0, variantId: null, cost: null })).toMatch(/cost/i);
  });

  it("requires something to match on", () => {
    expect(mappingError({ sku: null, variantId: null, cost: 1 })).toMatch(/SKU/);
  });

  it("accepts SKU alone", () => {
    expect(mappingError({ sku: 0, variantId: null, cost: 1 })).toBeNull();
  });

  it("accepts variant id alone", () => {
    expect(mappingError({ sku: null, variantId: 0, cost: 1 })).toBeNull();
  });
});

function row(overrides: Partial<ValidatedRow>): ValidatedRow {
  return {
    line: 2,
    status: "matched",
    variantGid: "gid://shopify/ProductVariant/1",
    costCents: 1000,
    message: null,
    warning: null,
    raw: [],
    ...overrides,
  };
}

function summaryOf(rows: ValidatedRow[]): ValidationSummary {
  return {
    rows,
    matched: rows.filter((r) => r.status === "matched").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    errored: rows.filter((r) => r.status === "error").length,
    unmatchedCatalogCount: 0,
  };
}

describe("describeProblems", () => {
  it("reports errors and warnings, and leaves clean rows out", () => {
    const summary = summaryOf([
      row({ line: 2 }),
      row({ line: 3, status: "error", message: 'no product with SKU "X"' }),
      row({ line: 4, warning: "cost is more than 3x the price" }),
      row({ line: 5, status: "skipped", message: "blank row" }),
    ]);

    expect(describeProblems(summary)).toEqual([
      { line: 3, status: "error", detail: 'no product with SKU "X"' },
      { line: 4, status: "warning", detail: "cost is more than 3x the price" },
    ]);
  });

  it("caps the list but not the count", () => {
    // A mis-mapped column makes every row an error. The table shows a sample; the
    // number above it has to stay honest, or the merchant reads 50 and thinks that
    // is all of them.
    const rows = Array.from({ length: PROBLEM_LIMIT + 25 }, (_, i) =>
      row({ line: i + 2, status: "error", message: "bad" }),
    );
    const summary = summaryOf(rows);

    expect(describeProblems(summary)).toHaveLength(PROBLEM_LIMIT);
    expect(countProblems(summary)).toBe(PROBLEM_LIMIT + 25);
  });

  it("counts a warning on an imported row as needing attention", () => {
    const summary = summaryOf([row({ warning: "check the decimal separator" })]);
    expect(countProblems(summary)).toBe(1);
    expect(summary.errored).toBe(0);
  });
});

describe("describeDelimiter", () => {
  it("names separators in words", () => {
    expect(describeDelimiter(",")).toBe("commas");
    expect(describeDelimiter(";")).toBe("semicolons");
    expect(describeDelimiter("\t")).toBe("tabs");
  });

  it("quotes anything unexpected rather than guessing a name", () => {
    expect(describeDelimiter("^")).toBe('"^"');
  });
});

/**
 * The downloadable template's contract.
 *
 * Its whole point is that a merchant fills one column and uploads — no mapping
 * screen. That only holds while the header names stay exact matches for the
 * importer's hints, which is easy to break by renaming a column for readability.
 */
describe("TEMPLATE_HEADERS", () => {
  it("auto-maps with no merchant input", () => {
    const mapping = suggestColumnMapping([...TEMPLATE_HEADERS]);

    expect(mapping).toEqual({ sku: 0, variantId: 1, cost: 3 });
    // Usable as-is: no error means the merchant never has to touch a select.
    expect(mappingError(mapping)).toBeNull();
  });

  it("does not offer the product title as a match column", () => {
    // Titles repeat, and a wrong match writes a wrong cost silently. `product` is
    // in the file for the human, and must never be picked up as an identifier.
    const mapping = suggestColumnMapping([...TEMPLATE_HEADERS]);
    const productIndex = TEMPLATE_HEADERS.indexOf("product");

    expect(mapping.sku).not.toBe(productIndex);
    expect(mapping.variantId).not.toBe(productIndex);
  });

  it("puts the cost column where the template builder writes it", () => {
    expect(TEMPLATE_COST_INDEX).toBe(TEMPLATE_HEADERS.indexOf("cost"));
    expect(TEMPLATE_HEADERS[TEMPLATE_COST_INDEX]).toBe("cost");
  });

  it("round-trips: a filled template imports, an unfilled one reports missing costs", () => {
    const catalog = [
      { variantGid: "gid://shopify/ProductVariant/1", sku: "WB-1", priceCents: 5000 },
      { variantGid: "gid://shopify/ProductVariant/2", sku: null, priceCents: 2500 },
    ];
    const mapping = suggestColumnMapping([...TEMPLATE_HEADERS]);
    // As the route emits it: identifiers filled, cost blank.
    const rows = catalog.map((c) => [c.sku ?? "", c.variantGid, "A Product", ""]);

    const unfilled = validateImport(rows, mapping, catalog, TEMPLATE_HEADERS.length);
    expect(unfilled.matched).toBe(0);
    expect(unfilled.errored).toBe(2);
    expect(unfilled.rows[0].message).toMatch(/cost/i);

    const filled = rows.map((r) => {
      const copy = [...r];
      copy[TEMPLATE_COST_INDEX] = "9.99";
      return copy;
    });
    const done = validateImport(filled, mapping, catalog, TEMPLATE_HEADERS.length);
    expect(done.matched).toBe(2);
    expect(done.errored).toBe(0);
    // Including the SKU-less variant, which only its id can match.
    expect(done.unmatchedCatalogCount).toBe(0);
  });
});
