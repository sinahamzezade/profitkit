import type { LineItemInput, OrderCostInputs } from "../margin/types";
import type { OrderGroundTruth } from "./orders";

function toCents(amount: string): number {
  return Math.round(parseFloat(amount) * 100);
}

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/**
 * Maps one Shopify-shaped order payload into Day-1 domain inputs, exactly like the
 * real ingestion adapter (Day 9) will. COGS and true shipping cost never come from
 * the payload — that's the cost-assumptions ladder's job (Day 4); here the seed's
 * own ground truth stands in for it, since the whole point is validating the math.
 */
export function mapOrderToDomainInputs(
  rawOrder: unknown,
  groundTruth: OrderGroundTruth,
): { lines: LineItemInput[]; order: OrderCostInputs } {
  const lineNodes = (get(rawOrder, "lineItems.nodes") ?? []) as unknown[];
  const refundNodes = (get(rawOrder, "refunds") ?? []) as unknown[];

  const refundedByLineItemId = new Map<string, number>();
  for (const refund of refundNodes) {
    const items = (get(refund, "refundLineItems.nodes") ?? []) as unknown[];
    for (const item of items) {
      const id = get(item, "lineItem.id") as string;
      const amount = toCents(get(item, "subtotalSet.shopMoney.amount") as string);
      refundedByLineItemId.set(id, (refundedByLineItemId.get(id) ?? 0) + amount);
    }
  }

  const cogsByLineItemId = new Map(groundTruth.lines.map((l) => [l.lineItemId, l.cogs]));

  const lines: LineItemInput[] = lineNodes.map((node) => {
    const id = get(node, "id") as string;
    const discountAllocations = (get(node, "discountAllocations") ?? []) as unknown[];
    const discountAllocated = discountAllocations.reduce(
      (sum: number, a) => sum + toCents(get(a, "allocatedAmountSet.shopMoney.amount") as string),
      0,
    );
    const nativeCogs = get(node, "variant.inventoryItem.unitCost.amount") as string | null;

    return {
      id,
      revenue: toCents(get(node, "originalTotalSet.shopMoney.amount") as string),
      discountAllocated,
      cogs: nativeCogs != null ? toCents(nativeCogs) : cogsByLineItemId.get(id) ?? 0,
      cogsEstimated: nativeCogs == null,
      refunded: refundedByLineItemId.get(id) ?? 0,
    };
  });

  const order: OrderCostInputs = {
    shippingCharged: toCents(get(rawOrder, "totalShippingPriceSet.shopMoney.amount") as string),
    shippingCost: groundTruth.shippingCost,
    shippingCostEstimated: true,
    // The generator always supplies a shipping cost, so the seeded ground truth
    // exercises the known-cost path.
    shippingCostKnown: true,
    gatewayFeePercent: groundTruth.gatewayFeePercent,
    gatewayFeeFlat: groundTruth.gatewayFeeFlat,
    gatewayFeeEstimated: !groundTruth.gatewayFeeInPayload,
  };

  return { lines, order };
}
