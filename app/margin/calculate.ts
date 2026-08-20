import { allocateProportionally } from "./allocate";
import type { Cents, LineItemInput, LineMargin, OrderCostInputs } from "./types";

/**
 * contributionMargin(line) =
 *     lineRevenue
 *   − lineDiscountAllocated
 *   − lineCOGS
 *   − lineGatewayFee
 *   − lineShippingLoss
 *   − lineRefundImpact
 *
 * lineRevenue is gross (pre-discount) — discountAllocated is subtracted as its own
 * term so the two never double-count.
 *
 * shippingLoss is shippingCost − shippingCharged (not the other way round): when a
 * merchant charges $10 for shipping that costs $7, that's a $3 gain, so the loss
 * term is −3 and subtracting it *adds* $3 back to margin. When cost exceeds charge,
 * the loss term is positive and correctly reduces margin.
 *
 * Gateway fee is computed on what the payment processor actually settles — net line
 * revenue plus shipping charged — then allocated back across lines by revenue share,
 * since the fee really is a percentage of the dollar amount processed.
 *
 * Shipping loss is split evenly across line items instead: it tracks package
 * weight/bulk, not price, and this model has no weight field to allocate by, so an
 * even split is the more honest of the two options the cost ladder allows.
 *
 * Tax never enters this calculation; it's excluded from both revenue and margin.
 */
export function calculateOrderMargin(
  lines: LineItemInput[],
  order: OrderCostInputs,
): LineMargin[] {
  if (lines.length === 0) return [];

  const netRevenues = lines.map((l) => l.revenue - l.discountAllocated);
  const chargeableAmount =
    netRevenues.reduce((a, b) => a + b, 0) + order.shippingCharged;
  const gatewayFeeTotal = Math.round(
    chargeableAmount * order.gatewayFeePercent + order.gatewayFeeFlat,
  );
  const gatewayFeeByLine = allocateProportionally(gatewayFeeTotal, netRevenues);

  const shippingLossTotal = order.shippingCost - order.shippingCharged;
  const evenWeights = lines.map(() => 1);
  const shippingLossByLine = allocateProportionally(shippingLossTotal, evenWeights);

  return lines.map((line, i) => {
    const gatewayFee = gatewayFeeByLine[i];
    const shippingLoss = shippingLossByLine[i];
    const contributionMargin: Cents =
      line.revenue -
      line.discountAllocated -
      line.cogs -
      gatewayFee -
      shippingLoss -
      line.refunded;

    return {
      lineItemId: line.id,
      revenue: line.revenue,
      discountAllocated: line.discountAllocated,
      cogs: line.cogs,
      gatewayFee,
      shippingLoss,
      refundImpact: line.refunded,
      contributionMargin,
      estimated:
        line.cogsEstimated ||
        order.shippingCostEstimated ||
        order.gatewayFeeEstimated,
    };
  });
}
