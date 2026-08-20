import { describe, expect, it } from "vitest";
import { detectDelimiter, isBlankRow, parseCsv, toCsv } from "./csv";
import { parseCostToCents } from "./money";

describe("parseCsv", () => {
  it("parses a plain file", () => {
    const { headers, rows } = parseCsv("sku,cost\nA-1,10.00\nA-2,20.00");
    expect(headers).toEqual(["sku", "cost"]);
    expect(rows).toEqual([
      ["A-1", "10.00"],
      ["A-2", "20.00"],
    ]);
  });

  it("keeps commas and newlines inside quoted fields", () => {
    const { rows } = parseCsv('sku,title,cost\nA-1,"Mug, large",10.00\nA-2,"Two\nlines",20.00');
    expect(rows[0]).toEqual(["A-1", "Mug, large", "10.00"]);
    expect(rows[1]).toEqual(["A-2", "Two\nlines", "20.00"]);
  });

  it("unescapes doubled quotes", () => {
    const { rows } = parseCsv('sku,title\nA-1,"He said ""hi"""');
    expect(rows[0]).toEqual(["A-1", 'He said "hi"']);
  });

  it("handles CRLF line endings and a UTF-8 BOM", () => {
    const { headers, rows } = parseCsv("﻿sku,cost\r\nA-1,10.00\r\n");
    expect(headers).toEqual(["sku", "cost"]);
    expect(rows).toEqual([["A-1", "10.00"]]);
  });

  it("does not invent a trailing row when the file ends in a newline", () => {
    expect(parseCsv("sku,cost\nA-1,10.00\n").rows).toHaveLength(1);
  });

  it("preserves an empty trailing field", () => {
    expect(parseCsv("sku,cost\nA-1,").rows[0]).toEqual(["A-1", ""]);
  });
});

describe("detectDelimiter", () => {
  it("detects semicolons from a European export", () => {
    expect(detectDelimiter("sku;cost\nA-1;12,50")).toBe(";");
  });

  it("detects tabs", () => {
    expect(detectDelimiter("sku\tcost\nA-1\t10.00")).toBe("\t");
  });

  it("is not fooled by commas inside quoted titles", () => {
    const text = 'sku;title;cost\nA-1;"Mug, large";10.00\nA-2;"Bowl, small";20.00';
    expect(detectDelimiter(text)).toBe(";");
  });

  it("falls back to comma on a single column", () => {
    expect(detectDelimiter("sku\nA-1")).toBe(",");
  });
});

describe("isBlankRow", () => {
  it("treats whitespace-only rows as blank", () => {
    expect(isBlankRow(["", "  ", "\t"])).toBe(true);
    expect(isBlankRow(["", "x"])).toBe(false);
  });
});

describe("toCsv", () => {
  it("quotes values containing commas, quotes, or newlines", () => {
    const out = toCsv(["a", "b"], [['x,y', 'he said "hi"']]);
    expect(out).toBe('a,b\n"x,y","he said ""hi"""');
  });
});

describe("parseCostToCents", () => {
  it("reads plain decimals", () => {
    expect(parseCostToCents("10.00").cents).toBe(1000);
    expect(parseCostToCents("7.5").cents).toBe(750);
    expect(parseCostToCents("12").cents).toBe(1200);
  });

  it("strips currency symbols, codes, and padding", () => {
    expect(parseCostToCents("  $12.50 ").cents).toBe(1250);
    expect(parseCostToCents("€9,99").cents).toBe(999);
    expect(parseCostToCents("12.50 USD").cents).toBe(1250);
    expect(parseCostToCents("AED 45.00").cents).toBe(4500);
  });

  it("uses the rightmost separator as the decimal point when both appear", () => {
    expect(parseCostToCents("1,234.56").cents).toBe(123456);
    expect(parseCostToCents("1.234,56").cents).toBe(123456);
  });

  it("reads a lone comma as thousands or decimal by digit count", () => {
    expect(parseCostToCents("1,234").cents).toBe(123400);
    expect(parseCostToCents("12,50").cents).toBe(1250);
  });

  it("warns rather than guessing on an ambiguous lone period", () => {
    const result = parseCostToCents("1.234");
    expect(result.cents).toBe(123);
    expect(result.warning).toContain("thousands");
  });

  it("treats repeated periods as thousands separators", () => {
    expect(parseCostToCents("1.234.567").cents).toBe(123456700);
  });

  it("rejects blanks, junk, and negatives", () => {
    expect(parseCostToCents("").error).toBe("missing cost");
    expect(parseCostToCents("   ").error).toBe("missing cost");
    expect(parseCostToCents("n/a").error).toContain("not a number");
    expect(parseCostToCents("-5.00").error).toContain("negative");
    expect(parseCostToCents("(5.00)").error).toContain("negative");
  });
});
