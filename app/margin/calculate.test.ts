import { describe, expect, it } from "vitest";
import { calculateOrderMargin } from "./calculate";
import { allocateProportionally } from "./allocate";
import type { LineItemInput, OrderCostInputs } from "./types";

const noFees: OrderCostInputs = {
  shippingCharged: 0,
  shippingCost: 0,
  shippingCostEstimated: false,
  shippingCostKnown: true,
  gatewayFeePercent: 0,
  gatewayFeeFlat: 0,
  gatewayFeeEstimated: false,
};

function line(overrides: Partial<LineItemInput> = {}): LineItemInput {
  return {
    id: "line-1",
    revenue: 10000,
    discountAllocated: 0,
    cogs: 0,
    refunded: 0,
    cogsEstimated: false,
    ...overrides,
  };
}

describe("allocateProportionally", () => {
  it("sums exactly to the total despite rounding", () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("splits evenly when weights are all zero", () => {
    const parts = allocateProportionally(10, [0, 0, 0]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("handles negative totals by preserving sign", () => {
    const parts = allocateProportionally(-100, [1, 1]);
    expect(parts).toEqual([-50, -50]);
  });

  it("returns nothing for an empty weight list", () => {
    expect(allocateProportionally(100, [])).toEqual([]);
  });
});

describe("calculateOrderMargin", () => {
  it("computes a simple line with no discount, refund, or fees", () => {
    const [result] = calculateOrderMargin(
      [line({ revenue: 10000, cogs: 4000 })],
      noFees,
    );
    expect(result.contributionMargin).toBe(6000);
    expect(result.estimated).toBe(false);
  });

  it("subtracts discountAllocated as its own term against gross revenue", () => {
    const [result] = calculateOrderMargin(
      [line({ revenue: 10000, discountAllocated: 1000, cogs: 4000 })],
      noFees,
    );
    // 10000 - 1000 discount - 4000 cogs = 5000
    expect(result.contributionMargin).toBe(5000);
  });

  it("does not recompute Shopify's order-level discount allocation, just trusts it", () => {
    // Two lines share a $10 order-level discount, already allocated proportionally by Shopify.
    const lines = [
      line({ id: "a", revenue: 20000, discountAllocated: 667 }),
      line({ id: "b", revenue: 10000, discountAllocated: 333 }),
    ];
    const results = calculateOrderMargin(lines, noFees);
    const totalDiscount = results.reduce((sum, r) => sum + r.discountAllocated, 0);
    expect(totalDiscount).toBe(1000);
    expect(results[0].discountAllocated).toBe(667);
    expect(results[1].discountAllocated).toBe(333);
  });

  it("full refund cancels the line's own revenue net of its costs", () => {
    const [result] = calculateOrderMargin(
      [line({ revenue: 10000, cogs: 4000, refunded: 10000 })],
      noFees,
    );
    // 10000 - 4000 cogs - 10000 refund = -4000: the COGS is now a pure loss.
    expect(result.contributionMargin).toBe(-4000);
  });

  it("partial refund reduces margin only on the refunded line, not pro-rata", () => {
    const lines = [
      line({ id: "a", revenue: 10000, cogs: 4000, refunded: 5000 }),
      line({ id: "b", revenue: 10000, cogs: 4000, refunded: 0 }),
    ];
    const [a, b] = calculateOrderMargin(lines, noFees);
    expect(a.contributionMargin).toBe(1000); // 10000 - 4000 - 5000
    expect(b.contributionMargin).toBe(6000); // untouched by a's refund
  });

  it("free-shipping promotion allocates the full shipping cost as a loss across lines", () => {
    const lines = [
      line({ id: "a", revenue: 15000, cogs: 5000 }),
      line({ id: "b", revenue: 5000, cogs: 1000 }),
    ];
    const order: OrderCostInputs = {
      ...noFees,
      shippingCharged: 0,
      shippingCost: 1000,
      shippingCostEstimated: true,
    };
    const results = calculateOrderMargin(lines, order);
    const totalShippingLoss = results.reduce((sum, r) => sum + r.shippingLoss, 0);
    expect(totalShippingLoss).toBe(1000);
    // Split evenly across lines, not by revenue — shipping tracks weight, not price.
    expect(results[0].shippingLoss).toBe(500);
    expect(results[1].shippingLoss).toBe(500);
    expect(results.every((r) => r.estimated)).toBe(true);
  });

  it("shipping charged above cost adds the surplus back to margin", () => {
    const [result] = calculateOrderMargin(
      [line({ revenue: 10000, cogs: 4000 })],
      { ...noFees, shippingCharged: 1000, shippingCost: 700 },
    );
    // shippingLoss = 700 - 1000 = -300, so margin = 10000 - 4000 - (-300) = 6300
    expect(result.shippingLoss).toBe(-300);
    expect(result.contributionMargin).toBe(6300);
  });

  it("allocates gateway fees across lines by net revenue share, including shipping in the base", () => {
    const lines = [
      line({ id: "a", revenue: 8000, cogs: 0 }),
      line({ id: "b", revenue: 2000, cogs: 0 }),
    ];
    const order: OrderCostInputs = {
      ...noFees,
      shippingCharged: 1000,
      shippingCost: 1000,
      gatewayFeePercent: 0.029,
      gatewayFeeFlat: 30,
      gatewayFeeEstimated: true,
    };
    const results = calculateOrderMargin(lines, order);
    // chargeableAmount = 8000 + 2000 + 1000 = 11000; fee = 11000*0.029 + 30 = 349
    const totalFee = results.reduce((sum, r) => sum + r.gatewayFee, 0);
    expect(totalFee).toBe(349);
    expect(results.every((r) => r.estimated)).toBe(true);
  });
});

describe("shipping cost that was never supplied", () => {
  const line: LineItemInput = {
    id: "l1",
    revenue: 10_000,
    discountAllocated: 0,
    cogs: 0,
    cogsEstimated: true,
    refunded: 0,
  };

  it("does not turn an unknown shipping cost into profit", () => {
    // Regression: shippingCost defaulted to 0 when unset, so `cost − charged` made
    // the whole shipping charge a gain and margin exceeded 100% of revenue. A real
    // store reported 101.1% on a product before this was fixed.
    const [result] = calculateOrderMargin([line], {
      ...noFees,
      shippingCharged: 1_500,
      shippingCost: 0,
      shippingCostKnown: false,
    });

    expect(result.shippingLoss).toBe(0);
    expect(result.contributionMargin).toBe(10_000);
  });

  it("still counts a gain when the merchant says shipping costs them nothing", () => {
    // An explicit 0 is a claim about the business, not missing information.
    const [result] = calculateOrderMargin([line], {
      ...noFees,
      shippingCharged: 1_500,
      shippingCost: 0,
      shippingCostKnown: true,
    });

    expect(result.shippingLoss).toBe(-1_500);
    expect(result.contributionMargin).toBe(11_500);
  });

  it("keeps charging the gateway fee on shipping the processor settled", () => {
    // Dropping the shipping term must not also drop the fee on that money.
    const [result] = calculateOrderMargin([line], {
      ...noFees,
      shippingCharged: 1_500,
      shippingCost: 0,
      shippingCostKnown: false,
      gatewayFeePercent: 0.029,
      gatewayFeeFlat: 30,
    });

    // 2.9% of (10_000 + 1_500) + 30 = 333.5 + 30 -> 364 (rounded)
    expect(result.gatewayFee).toBe(364);
    expect(result.shippingLoss).toBe(0);
  });

  it("never reports margin above revenue when the cost is unknown", () => {
    const [result] = calculateOrderMargin([line], {
      ...noFees,
      shippingCharged: 9_999,
      shippingCost: 0,
      shippingCostKnown: false,
    });

    expect(result.contributionMargin).toBeLessThanOrEqual(result.revenue);
  });
});
