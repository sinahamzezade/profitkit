import { describe, expect, it } from "vitest";
import { parseCsv } from "../import/csv";
import {
  assertCanExport,
  FREE_TIER_WINDOW_DAYS,
  resolveTierLimits,
  TierRequiredError,
} from "../billing/tier";
import { accountantCsvFilename, buildAccountantCsv } from "./accountantExport";
import type { ProductMarginRow } from "./productMargin";

function row(overrides: Partial<ProductMarginRow> = {}): ProductMarginRow {
  return {
    productId: "p1",
    title: "Wool Blanket",
    vendor: "Northline",
    unitsSold: 12,
    orderCount: 10,
    revenue: 95000,
    discounts: 5000,
    cogs: 40000,
    fees: 3000,
    shippingDelta: 1200,
    refunds: 800,
    contributionMargin: 50000,
    marginPercent: 0.5263,
    estimated: true,
    costSource: "global",
    imageUrl: null,
    ...overrides,
  };
}

describe("tier limits", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("bounds the free tier to a trailing window", () => {
    const limits = resolveTierLimits("free", now);
    expect(limits.windowDays).toBe(FREE_TIER_WINDOW_DAYS);
    expect(limits.since).toEqual(new Date("2026-05-22T12:00:00.000Z"));
  });

  it("leaves Pro unbounded", () => {
    const limits = resolveTierLimits("pro", now);
    expect(limits.since).toBeNull();
    expect(limits.windowDays).toBeNull();
  });

  it("gates export on tier, not on the UI", () => {
    expect(resolveTierLimits("free", now).canExport).toBe(false);
    expect(resolveTierLimits("pro", now).canExport).toBe(true);
  });

  it("throws rather than quietly returning nothing when free tier hits export", () => {
    expect(() => assertCanExport(resolveTierLimits("free", now))).toThrow(TierRequiredError);
    expect(() => assertCanExport(resolveTierLimits("pro", now))).not.toThrow();
  });
});

describe("accountant export", () => {
  it("writes the header row accounting software expects", () => {
    const csv = buildAccountantCsv([row()], { currency: "USD" });
    const { headers } = parseCsv(csv);
    expect(headers.slice(0, 4)).toEqual(["Product", "Vendor", "Units sold", "Currency"]);
    expect(headers).toContain("Contribution margin");
    // Every column must carry data; a permanently blank column is noise in an export.
    expect(headers).not.toContain("SKU count");
  });

  it("writes plain decimals with no symbols or separators", () => {
    const csv = buildAccountantCsv(
      [row({ revenue: 123456789, discounts: 0, contributionMargin: 123456789 })],
      { currency: "USD" },
    );
    expect(csv).toContain("1234567.89");
    expect(csv).not.toContain("$");
    expect(csv).not.toContain("1,234,567.89");
  });

  it("reports gross revenue as net plus discounts so it reconciles against a sales report", () => {
    const csv = buildAccountantCsv([row({ revenue: 95000, discounts: 5000 })], {
      currency: "USD",
    });
    const { headers, rows } = parseCsv(csv);
    const cell = (name: string) => rows[0][headers.indexOf(name)];
    expect(cell("Gross revenue")).toBe("1000.00");
    expect(cell("Discounts")).toBe("50.00");
    expect(cell("Net revenue")).toBe("950.00");
  });

  it("flags rows built on estimates, so nobody books a guess as fact", () => {
    const estimated = buildAccountantCsv([row({ estimated: true })], { currency: "USD" });
    const measured = buildAccountantCsv([row({ estimated: false })], { currency: "USD" });
    const { headers, rows } = parseCsv(estimated);
    expect(rows[0][headers.indexOf("Figures include estimates")]).toBe("yes");
    expect(parseCsv(measured).rows[0][headers.indexOf("Figures include estimates")]).toBe("no");
  });

  it("leaves margin % blank rather than writing a fake zero", () => {
    const csv = buildAccountantCsv([row({ marginPercent: null })], { currency: "USD" });
    const { headers, rows } = parseCsv(csv);
    expect(rows[0][headers.indexOf("Margin %")]).toBe("");
  });

  it("quotes product names containing commas so columns don't shift", () => {
    const csv = buildAccountantCsv([row({ title: "Mug, large" })], { currency: "USD" });
    const { rows } = parseCsv(csv);
    expect(rows[0][0]).toBe("Mug, large");
  });

  it("names the file after the store and date", () => {
    expect(
      accountantCsvFilename("first-test-zenmt2u1.myshopify.com", new Date("2026-08-20T00:00:00Z")),
    ).toBe("profitkit-margin-first-test-zenmt2u1-2026-08-20.csv");
  });
});
