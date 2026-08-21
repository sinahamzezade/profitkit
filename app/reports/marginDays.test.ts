import { describe, expect, it } from "vitest";
import { aggregateByDay, type LoadedOrder } from "./productMargin";
import type { ShopCostConfig } from "../ingestion/dbToDomain";

/** No cost data at all: margin equals revenue, so the arithmetic stays checkable by hand. */
const config: ShopCostConfig = {
  cogsEntries: [],
  feeRules: [],
  shipping: { globalPerOrderCents: null },
};

function order(
  overrides: Partial<LoadedOrder> & { lines?: unknown[] } = {},
): LoadedOrder {
  return {
    id: "o1",
    shopId: "s",
    shopifyGid: "gid://shopify/Order/1",
    name: "#1",
    currencyCode: "USD",
    test: false,
    createdAtShopify: new Date("2026-08-02T09:00:00Z"),
    shippingChargedCents: 0,
    discountTotalCents: 0,
    discountCodes: [],
    gatewayName: "manual",
    gatewayFeeCents: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [],
    ...overrides,
  } as unknown as LoadedOrder;
}

function line(
  revenue: number,
  discount = 0,
  refunds: Array<{ amount: number; on: string }> = [],
) {
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
      refundedAt: new Date(`${r.on}T00:00:00Z`),
      reason: null,
      note: null,
      createdAt: new Date(),
    })),
  } as unknown as LoadedOrder["lines"][number];
}

const FROM = new Date("2026-08-01T00:00:00Z");
const TO = new Date("2026-08-05T00:00:00Z");

describe("aggregateByDay", () => {
  it("returns every day in the window, including days with no orders", () => {
    // A sparkline drawn only from days that traded would compress a quiet stretch
    // into one step and imply business that did not happen.
    const days = aggregateByDay([order({ lines: [line(10_000)] })], config, FROM, TO);

    expect(days.map((d) => d.day)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
    expect(days.find((d) => d.day === "2026-08-01")?.revenue).toBe(0);
    expect(days.find((d) => d.day === "2026-08-02")?.revenue).toBe(10_000);
  });

  it("sums several orders landing on the same day", () => {
    const days = aggregateByDay(
      [
        order({ id: "a", lines: [line(10_000)] }),
        order({ id: "b", lines: [line(2_500)] }),
      ],
      config,
      FROM,
      TO,
    );

    const day = days.find((d) => d.day === "2026-08-02");
    expect(day?.revenue).toBe(12_500);
    expect(day?.contributionMargin).toBe(12_500);
  });

  it("nets line discounts out of revenue", () => {
    const days = aggregateByDay(
      [order({ lines: [line(10_000, 1_500)] })],
      config,
      FROM,
      TO,
    );

    expect(days.find((d) => d.day === "2026-08-02")?.revenue).toBe(8_500);
  });

  it("counts a refund on the day it was refunded, not the day of the order", () => {
    // The series answers "when did money leave", so attributing a later refund to
    // the order date would draw the outflow days before it happened.
    const days = aggregateByDay(
      [order({ lines: [line(10_000, 0, [{ amount: 4_000, on: "2026-08-04" }])] })],
      config,
      FROM,
      TO,
    );

    expect(days.find((d) => d.day === "2026-08-02")?.givenBack).toBe(0);
    expect(days.find((d) => d.day === "2026-08-04")?.givenBack).toBe(4_000);
  });

  it("uses the order-level discount total, matching the erosion report", () => {
    // buildErosionReport totals order.discountTotalCents. If this used the
    // line-allocated figure instead, the sparkline would disagree with the stat
    // printed directly above it whenever the two differ.
    const days = aggregateByDay(
      [order({ discountTotalCents: 2_000, lines: [line(10_000, 1_500)] })],
      config,
      FROM,
      TO,
    );

    expect(days.find((d) => d.day === "2026-08-02")?.givenBack).toBe(2_000);
  });

  it("ignores orders outside the window rather than throwing", () => {
    // Callers legitimately pass a window narrower than the orders they loaded.
    const days = aggregateByDay(
      [
        order({ id: "in", lines: [line(1_000)] }),
        order({
          id: "out",
          createdAtShopify: new Date("2026-07-20T09:00:00Z"),
          lines: [line(99_000)],
        }),
      ],
      config,
      FROM,
      TO,
    );

    expect(days.reduce((sum, d) => sum + d.revenue, 0)).toBe(1_000);
  });

  it("handles a single-day window", () => {
    const days = aggregateByDay(
      [order({ lines: [line(5_000)] })],
      config,
      new Date("2026-08-02T00:00:00Z"),
      new Date("2026-08-02T00:00:00Z"),
    );

    expect(days).toHaveLength(1);
    expect(days[0].revenue).toBe(5_000);
  });
});
