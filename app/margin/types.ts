/** Money in integer minor units (cents) — avoids floating-point drift in P&L math. */
export type Cents = number;

export interface LineItemInput {
  id: string;
  /** Gross revenue for the line, pre-discount (Shopify's originalTotalSet). */
  revenue: Cents;
  /**
   * Discount allocated to this line by Shopify's own discountAllocations.
   * Shopify already does proportional-to-revenue allocation correctly — trust it, don't recompute.
   */
  discountAllocated: Cents;
  /**
   * Per-unit COGS × quantity, already resolved by the cost-assumptions ladder
   * (variant-level > collection/vendor > global estimate) before it reaches this function.
   */
  cogs: Cents;
  /** Amount refunded against this specific line (Shopify's refundLineItems.subtotalSet), not a pro-rata share. */
  refunded: Cents;
  /** True if cogs came from an estimate rung rather than a merchant-entered or Shopify-native value. */
  cogsEstimated: boolean;
}

export interface OrderCostInputs {
  /** totalShippingPriceSet — what the merchant charged the customer for shipping. */
  shippingCharged: Cents;
  /** Merchant-supplied or estimated actual shipping cost. Shopify never exposes this. */
  shippingCost: Cents;
  shippingCostEstimated: boolean;
  /** Percentage fee rate, e.g. 0.029 for 2.9%. */
  gatewayFeePercent: number;
  gatewayFeeFlat: Cents;
  gatewayFeeEstimated: boolean;
}

export interface LineMargin {
  lineItemId: string;
  revenue: Cents;
  discountAllocated: Cents;
  cogs: Cents;
  gatewayFee: Cents;
  /** Shipping cost allocated to this line minus the shipping revenue allocated to it. Positive = subsidized loss. */
  shippingLoss: Cents;
  refundImpact: Cents;
  contributionMargin: Cents;
  /** True if any input feeding this line's margin was an estimate rather than a real figure. */
  estimated: boolean;
}
