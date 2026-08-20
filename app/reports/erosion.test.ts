import { describe, expect, it } from "vitest";
import { buildErosionReport, NO_REASON_RECORDED, UNCODED_DISCOUNT } from "./erosion";
import type { ErosionOrder } from "./erosion";
import type { ShopCostConfig } from "../ingestion/dbToDomain";

/** No cost data at all: margin is revenue, which keeps the arithmetic checkable by hand. */
const config: ShopCostConfig = {
  cogsEntries: [],
  feeRules: [],
  shipping: { globalPerOrderCents: null },
};

function order(overrides: Partial<ErosionOrder> = {}): ErosionOrder {
  return {
    id: "o1",
    shopId: "s",
    shopifyGid: "gid://shopify/Order/1",
    name: "#1",
    currencyCode: "USD",
    test: false,
    createdAtShopify: new Date("2026-07-10T00:00:00Z"),
    shippingChargedCents: 0,
    discountTotalCents: 0,
    discountCodes: [],
    gatewayName: "manual",
    gatewayFeeCents: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [],
    ...overrides,
  } as unknown as ErosionOrder;
}

function line(revenue: number, discount = 0, refunds: Array<{ amount: number; reason?: string }> = []) {
  return {
    id: `l${revenue}`,
    orderId: "o1",
    variantId: null,
    shopifyGid: `gid://shopify/LineItem/${revenue}`,
    title: "Item",
    sku: null,
    quantity: 1,
    originalTotalCents: revenue,
    discountAllocatedCents: discount,
    createdAt: new Date(),
    updatedAt: new Date(),
    variant: null,
    refunds: refunds.map((r, i) => ({
      id: `r${i}`,
      orderId: "o1",
      orderLineId: "l",
      shopifyRefundGid: `gid://shopify/Refund/${i}`,
      quantity: 1,
      subtotalCents: r.amount,
      refundedAt: new Date("2026-07-12T00:00:00Z"),
      reason: r.reason ?? null,
      note: null,
      createdAt: new Date(),
    })),
  } as unknown as ErosionOrder["lines"][number];
}

describe("discount code verdicts", () => {
  it("scores each code against orders that used no code", () => {
    const report = buildErosionReport(
      [
        // Baseline: two undiscounted orders earning 10000 each.
        order({ id: "a", lines: [line(10000)] }),
        order({ id: "b", lines: [line(10000)] }),
        // SAVE10 orders are bigger even after the discount — it paid for itself.
        order({
          id: "c",
          discountTotalCents: 1000,
          discountCodes: ["SAVE10"],
          lines: [line(16000, 1000)],
        }),
      ],
      config,
    );

    expect(report.baselineMarginPerOrder).toBe(10000);
    const [save10] = report.discountPerformance;
    expect(save10).toMatchObject({ code: "SAVE10", orders: 1, given: 1000 });
    expect(save10.marginPerOrder).toBe(15000);
    expect(save10.versusBaseline).toBe(5000);
  });

  it("ranks the codes that cost the most against baseline first", () => {
    const report = buildErosionReport(
      [
        order({ id: "a", lines: [line(10000)] }),
        order({
          id: "b",
          discountTotalCents: 500,
          discountCodes: ["GOOD"],
          lines: [line(14000, 500)],
        }),
        order({
          id: "c",
          discountTotalCents: 500,
          discountCodes: ["BAD"],
          lines: [line(6000, 500)],
        }),
      ],
      config,
    );
    expect(report.discountPerformance.map((p) => p.code)).toEqual(["BAD", "GOOD"]);
    expect(report.discountPerformance[0].versusBaseline).toBeLessThan(0);
  });

  it("counts an order in full for every code it carries", () => {
    // Splitting margin between codes would understate both; the question is how
    // orders carrying each code performed.
    const report = buildErosionReport(
      [
        order({ id: "a", lines: [line(10000)] }),
        order({
          id: "b",
          discountTotalCents: 1000,
          discountCodes: ["ONE", "TWO"],
          lines: [line(12000, 1000)],
        }),
      ],
      config,
    );
    for (const code of report.discountPerformance) {
      expect(code.orders).toBe(1);
      expect(code.marginPerOrder).toBe(11000);
      // The order-level discount is split evenly, since Shopify doesn't attribute it.
      expect(code.given).toBe(500);
    }
  });

  it("reports no baseline when every order used a code", () => {
    const report = buildErosionReport(
      [
        order({
          id: "a",
          discountTotalCents: 100,
          discountCodes: ["ONLY"],
          lines: [line(5000, 100)],
        }),
      ],
      config,
    );
    expect(report.baselineMarginPerOrder).toBeNull();
    expect(report.discountPerformance[0].versusBaseline).toBe(0);
  });

  it("omits the verdict entirely when no cost config is supplied", () => {
    const report = buildErosionReport([order({ lines: [line(10000)] })]);
    expect(report.discountPerformance).toEqual([]);
    expect(report.baselineMarginPerOrder).toBeNull();
  });
});

describe("erosion buckets", () => {
  it("separates uncoded discounts rather than dropping them", () => {
    const report = buildErosionReport(
      [order({ discountTotalCents: 800, discountCodes: [], lines: [line(9000, 800)] })],
      config,
    );
    expect(report.discountsByCode[0].label).toBe(UNCODED_DISCOUNT);
    expect(report.totalDiscounts).toBe(800);
  });

  it("buckets refunds with no reason separately and totals them", () => {
    const report = buildErosionReport(
      [
        order({
          lines: [
            line(10000, 0, [
              { amount: 3000 },
              { amount: 1000, reason: "Defective" },
            ]),
          ],
        }),
      ],
      config,
    );
    expect(report.totalRefunds).toBe(4000);
    expect(report.refundsWithoutReason).toBe(3000);
    expect(report.refundsByReason.map((r) => r.label)).toContain(NO_REASON_RECORDED);
  });
});
