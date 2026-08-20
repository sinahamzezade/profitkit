import { describe, expect, it } from "vitest";
import {
  formatMoneyInput,
  formatPercent,
  parseMoneyInput,
  parseOptionalPercentInput,
  parsePercentInput,
} from "./settingsForm";

describe("parsePercentInput", () => {
  it("converts a typed percentage into a fraction", () => {
    expect(parsePercentInput("45")).toEqual({ ok: true, value: 0.45 });
    expect(parsePercentInput("2.9")).toEqual({ ok: true, value: 0.029 });
  });

  it("tolerates a trailing percent sign and padding", () => {
    expect(parsePercentInput("  45 % ")).toEqual({ ok: true, value: 0.45 });
  });

  it("rejects zero for cost of goods, where it would report revenue as profit", () => {
    expect(parsePercentInput("0").ok).toBe(false);
  });

  it("allows zero for fees, since plenty of gateways charge nothing", () => {
    expect(parsePercentInput("0", { allowZero: true })).toEqual({ ok: true, value: 0 });
  });

  it("rejects a value above 100, which is nearly always a mistyped fraction", () => {
    expect(parsePercentInput("450").ok).toBe(false);
  });

  it("accepts exactly 100 — selling at cost is dire but real", () => {
    expect(parsePercentInput("100")).toEqual({ ok: true, value: 1 });
  });

  it("rejects negatives and junk with a message naming the input", () => {
    expect(parsePercentInput("-5").ok).toBe(false);
    const junk = parsePercentInput("abc");
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.error).toContain("abc");
  });

  it("rejects blank rather than treating it as zero", () => {
    expect(parsePercentInput("").ok).toBe(false);
  });
});

describe("parseMoneyInput", () => {
  it("converts a typed amount into cents", () => {
    expect(parseMoneyInput("6.50")).toEqual({ ok: true, value: 650 });
    expect(parseMoneyInput("12")).toEqual({ ok: true, value: 1200 });
  });

  it("accepts what a merchant would paste from a spreadsheet", () => {
    // Same parser as the CSV importer, so form and file behave identically.
    expect(parseMoneyInput("$6.50")).toEqual({ ok: true, value: 650 });
    expect(parseMoneyInput("1,234.56")).toEqual({ ok: true, value: 123456 });
  });

  it("treats blank as not set rather than as zero", () => {
    expect(parseMoneyInput("")).toEqual({ ok: true, value: null });
    expect(parseMoneyInput("   ")).toEqual({ ok: true, value: null });
  });

  it("allows an explicit zero, which is a real answer for free shipping you absorb", () => {
    expect(parseMoneyInput("0")).toEqual({ ok: true, value: 0 });
  });

  it("rejects negatives and junk", () => {
    expect(parseMoneyInput("-3").ok).toBe(false);
    expect(parseMoneyInput("n/a").ok).toBe(false);
  });
});

describe("parseOptionalPercentInput", () => {
  it("treats blank as clearing the override", () => {
    expect(parseOptionalPercentInput("")).toEqual({ ok: true, value: null });
  });

  it("still validates a value that was supplied", () => {
    expect(parseOptionalPercentInput("75")).toEqual({ ok: true, value: 0.75 });
    expect(parseOptionalPercentInput("999").ok).toBe(false);
  });
});

describe("round trips", () => {
  it("survives storage and display without drift", () => {
    for (const typed of ["45", "2.9", "0.5", "100"]) {
      const parsed = parsePercentInput(typed, { allowZero: true });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatPercent(parsed.value)).toBe(String(Number(typed)));
    }
  });

  it("formats stored fractions without trailing noise", () => {
    expect(formatPercent(0.029)).toBe("2.9");
    expect(formatPercent(0.45)).toBe("45");
    expect(formatPercent(null)).toBe("");
  });

  it("formats cents as a plain decimal an input can hold", () => {
    expect(formatMoneyInput(650)).toBe("6.50");
    expect(formatMoneyInput(0)).toBe("0.00");
    expect(formatMoneyInput(null)).toBe("");
    // No currency symbol or separators — those would fail to re-parse cleanly.
    expect(formatMoneyInput(123456)).toBe("1234.56");
  });
});
