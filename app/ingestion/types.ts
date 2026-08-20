/** Shapes ingestion accepts — same fields as the field-audit query and the seed generator emit. */

export interface RawVariantNode {
  id: string;
  sku: string | null;
  price: string;
  nativeCogsCents?: number | null;
}

export interface RawProductNode {
  id: string;
  title: string;
  vendor: string | null;
  variants: RawVariantNode[];
}

export interface RawLineItemNode {
  id: string;
  title: string;
  sku: string | null;
  quantity: number;
  originalTotalSet: { shopMoney: { amount: string } };
  discountAllocations: Array<{ allocatedAmountSet: { shopMoney: { amount: string } } }>;
  variant: {
    id: string;
    sku: string | null;
    price: string;
    inventoryItem: { unitCost: { amount: string } | null } | null;
  } | null;
}

export interface RawRefundLineItemNode {
  quantity: number;
  subtotalSet: { shopMoney: { amount: string } };
  lineItem: { id: string; sku: string | null };
}

export interface RawRefundNode {
  id: string;
  createdAt: string;
  note?: string | null;
  refundLineItems: { nodes: RawRefundLineItemNode[] };
  /**
   * Present only when the refund came through the Returns flow. Reasons are per
   * return line item; the order's line ids let us attach them to the right rows.
   */
  return?: {
    returnLineItems: {
      nodes: Array<{
        returnReasonDefinition?: { name?: string | null } | null;
        returnReasonNote?: string | null;
        fulfillmentLineItem?: { lineItem: { id: string } } | null;
      }>;
    };
  } | null;
}

/** A discount applied to an order. Only code discounts carry a code. */
export interface RawDiscountApplicationNode {
  code?: string | null;
}

export interface RawOrderNode {
  id: string;
  name: string;
  currencyCode: string;
  test: boolean;
  createdAt: string;
  totalShippingPriceSet: { shopMoney: { amount: string } };
  currentTotalDiscountsSet: { shopMoney: { amount: string } };
  discountApplications?: { nodes: RawDiscountApplicationNode[] };
  lineItems: { nodes: RawLineItemNode[] };
  refunds: RawRefundNode[];
  transactions: Array<{
    gateway: string;
    fees: Array<{ amount: { amount: string } }>;
  }>;
}
