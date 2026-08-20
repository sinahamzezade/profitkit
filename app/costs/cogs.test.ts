import { describe, expect, it } from "vitest";
import { hasAnyCogsConfigured, resolveCogs } from "./cogs";
import { resolveFee, resolveShippingCost } from "./fees";
import type { CogsEntry, CogsTarget } from "./types";

function target(overrides: Partial<CogsTarget> = {}): CogsTarget {
  return {
    variantGid: "gid://shopify/ProductVariant/1",
    priceCents: 10000,
    nativeCogsCents: null,
    vendor: "Acme",
    collectionIds: ["gid://shopify/Collection/9"],
    ...overrides,
  };
}

const globalHalf: CogsEntry = {
  scope: "global",
  scopeKey: null,
  costCents: null,
  costPercent: 0.5,
};

describe("resolveCogs precedence", () => {
  it("falls back to the global estimate when nothing else is configured", () => {
    const result = resolveCogs(target(), [globalHalf]);
    expect(result).toEqual({ cents: 5000, estimated: true, source: "global" });
  });

  it("prefers a vendor override over the global estimate", () => {
    const vendor: CogsEntry = {
      scope: "vendor",
      scopeKey: "Acme",
      costCents: null,
      costPercent: 0.3,
    };
    const result = resolveCogs(target(), [globalHalf, vendor]);
    expect(result).toEqual({ cents: 3000, estimated: true, source: "vendor" });
  });

  it("prefers a collection override over a vendor override", () => {
    const vendor: CogsEntry = { scope: "vendor", scopeKey: "Acme", costCents: null, costPercent: 0.3 };
    const collection: CogsEntry = {
      scope: "collection",
      scopeKey: "gid://shopify/Collection/9",
      costCents: null,
      costPercent: 0.2,
    };
    const result = resolveCogs(target(), [globalHalf, vendor, collection]);
    expect(result).toEqual({ cents: 2000, estimated: true, source: "collection" });
  });

  it("prefers Shopify's native unitCost over any group-level estimate", () => {
    const vendor: CogsEntry = { scope: "vendor", scopeKey: "Acme", costCents: null, costPercent: 0.3 };
    const result = resolveCogs(target({ nativeCogsCents: 4200 }), [globalHalf, vendor]);
    expect(result).toEqual({ cents: 4200, estimated: false, source: "native" });
  });

  it("lets a variant override beat even the native cost field", () => {
    const variant: CogsEntry = {
      scope: "variant",
      scopeKey: "gid://shopify/ProductVariant/1",
      costCents: 3900,
      costPercent: null,
    };
    const result = resolveCogs(target({ nativeCogsCents: 4200 }), [globalHalf, variant]);
    expect(result).toEqual({ cents: 3900, estimated: false, source: "variant_override" });
  });

  it("ignores overrides that target a different variant, vendor, or collection", () => {
    const otherVariant: CogsEntry = {
      scope: "variant",
      scopeKey: "gid://shopify/ProductVariant/999",
      costCents: 100,
      costPercent: null,
    };
    const otherVendor: CogsEntry = {
      scope: "vendor",
      scopeKey: "Someone Else",
      costCents: 200,
      costPercent: null,
    };
    const otherCollection: CogsEntry = {
      scope: "collection",
      scopeKey: "gid://shopify/Collection/404",
      costCents: 300,
      costPercent: null,
    };
    const result = resolveCogs(target(), [otherVariant, otherVendor, otherCollection, globalHalf]);
    expect(result.source).toBe("global");
  });

  it("returns source 'none' rather than pretending a cost of zero is real", () => {
    const result = resolveCogs(target(), []);
    expect(result).toEqual({ cents: 0, estimated: true, source: "none" });
  });
});

describe("resolveCogs estimated flag", () => {
  it("marks an absolute variant override as precise", () => {
    const variant: CogsEntry = {
      scope: "variant",
      scopeKey: "gid://shopify/ProductVariant/1",
      costCents: 3900,
      costPercent: null,
    };
    expect(resolveCogs(target(), [variant]).estimated).toBe(false);
  });

  it("still flags a variant override expressed as a percentage", () => {
    const variant: CogsEntry = {
      scope: "variant",
      scopeKey: "gid://shopify/ProductVariant/1",
      costCents: null,
      costPercent: 0.45,
    };
    const result = resolveCogs(target(), [variant]);
    expect(result).toEqual({ cents: 4500, estimated: true, source: "variant_override" });
  });

  it("prefers an absolute amount when an entry carries both forms", () => {
    const entry: CogsEntry = { scope: "global", scopeKey: null, costCents: 111, costPercent: 0.9 };
    expect(resolveCogs(target(), [entry]).cents).toBe(111);
  });
});

describe("hasAnyCogsConfigured", () => {
  it("is false for no entries and for entries with no usable value", () => {
    expect(hasAnyCogsConfigured([])).toBe(false);
    expect(
      hasAnyCogsConfigured([{ scope: "global", scopeKey: null, costCents: null, costPercent: null }]),
    ).toBe(false);
  });

  it("is true once any rung carries a value", () => {
    expect(hasAnyCogsConfigured([globalHalf])).toBe(true);
  });
});

describe("resolveFee", () => {
  it("uses Shopify's reported fee as a precise flat amount", () => {
    const result = resolveFee("shopify_payments", 349, []);
    expect(result).toEqual({ percent: 0, flatCents: 349, estimated: false, source: "reported" });
  });

  it("falls back to a modeled rule when the gateway reports nothing", () => {
    const rules = [{ gatewayName: "telr", percent: 0.027, flatCents: 100 }];
    const result = resolveFee("Telr", null, rules);
    expect(result).toEqual({ percent: 0.027, flatCents: 100, estimated: true, source: "rule" });
  });

  it("returns a zero rule rather than guessing when no rule matches", () => {
    const result = resolveFee("cod", null, [{ gatewayName: "telr", percent: 0.027, flatCents: 100 }]);
    expect(result).toEqual({ percent: 0, flatCents: 0, estimated: true, source: "default" });
  });
});

describe("resolveShippingCost", () => {
  it("uses the global per-order estimate, always flagged", () => {
    expect(resolveShippingCost({ globalPerOrderCents: 700 })).toEqual({
      cents: 700,
      estimated: true,
      source: "global",
    });
  });

  it("reports 'none' when the merchant hasn't supplied a figure", () => {
    expect(resolveShippingCost({ globalPerOrderCents: null })).toEqual({
      cents: 0,
      estimated: true,
      source: "none",
    });
  });
});
