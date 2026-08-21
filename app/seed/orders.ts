import { allocateProportionally } from "../margin/allocate";
import type { Rng } from "./rng";
import { SHIPPING_RATES, type SeedProduct } from "./catalog";

const DISCOUNT_CODES = [
  { code: "SAVE10", percentage: 10 },
  { code: "WELCOME15", percentage: 15 },
  { code: "BFRIDAY20", percentage: 20 },
];


/** Mirrors Shopify's ReturnReason enum, which only applies to Returns-flow refunds. */
const RETURN_REASONS = [
  "Unwanted",
  "Not as described",
  "Defective",
  "Size too small",
  "Size too large",
  "Wrong item",
] as const;

/** Ground truth the generator knows but the Shopify API would never expose. */
export interface OrderGroundTruth {
  orderId: string;
  shippingCost: number;
  gatewayFeePercent: number;
  gatewayFeeFlat: number;
  gatewayFeeInPayload: boolean;
  lines: Array<{ lineItemId: string; productId: string; cogs: number }>;
}

export interface GeneratedDataset {
  rawOrders: unknown[];
  groundTruth: OrderGroundTruth[];
}

function pickLineCount(rng: Rng): number {
  return rng.weighted([
    { value: 1, weight: 60 },
    { value: 2, weight: 30 },
    { value: 3, weight: 10 },
  ]);
}

function randomDateWithinDays(rng: Rng, days: number): Date {
  const now = Date.now();
  const msAgo = rng.int(0, days * 24 * 60 * 60) * 1000;
  return new Date(now - msAgo);
}

export function generateOrders(
  rng: Rng,
  catalog: SeedProduct[],
  count = 500,
  windowDays = 90,
): GeneratedDataset {
  const rawOrders: unknown[] = [];
  const groundTruth: OrderGroundTruth[] = [];

  for (let i = 0; i < count; i++) {
    const orderId = `gid://shopify/Order/${8000000 + i}`;
    const orderName = `#${1001 + i}`;
    const createdAt = randomDateWithinDays(rng, windowDays).toISOString();

    const lineCount = pickLineCount(rng);
    const chosen: Array<{ product: SeedProduct; quantity: number }> = [];
    for (let j = 0; j < lineCount; j++) {
      const product = rng.pick(catalog);
      chosen.push({ product, quantity: rng.int(1, 3) });
    }

    /*
     * A product planted to lose on shipping has to ship on its own.
     *
     * The engine splits an order's shipping evenly across its lines — it tracks
     * weight and there is no weight field — so in a three-line basket this product
     * carries only a third of the shortfall its own bulk created, and the rest lands
     * on whatever it was bought with. A high-margin planted loser survives that
     * dilution and reads as profitable, while its innocent basket-mates absorb the
     * loss. Raising the shipping cost cannot fix it: the more expensive the product,
     * the more gross margin there is to cushion a third of the loss.
     *
     * Shipping it alone is also what a bulky item actually does.
     *
     * What this does *not* do is make the app blame shipping for the loss. The app
     * never sees these per-unit shipping costs — they are the generator's ground
     * truth, and Shopify has no such field. It models shipping as one global figure
     * per order, so a per-product shipping plant is invisible to it however large.
     * The plant proves the engine's arithmetic against known costs, which is what
     * `npm run seed` checks; it is not a fixture for the app's loss attribution.
     *
     * Same shape as the discount/refund plant below, which likewise needs the order
     * generator's cooperation for the catalog flag to mean anything.
     */
    const shippingLoserIndex = chosen.findIndex(
      (c) => c.product.lossDriver === "shipping",
    );
    if (shippingLoserIndex !== -1 && chosen.length > 1) {
      const alone = chosen[shippingLoserIndex];
      chosen.length = 0;
      chosen.push(alone);
    }

    const lineOriginalTotals = chosen.map((c) => c.product.variant.price * c.quantity);
    const orderSubtotal = lineOriginalTotals.reduce((a, b) => a + b, 0);

    // Products planted as discount/refund losers actually need elevated discount and
    // refund rates on their own orders — the flag alone does nothing without this.
    const discountRefundLoserIndex = chosen.findIndex(
      (c) => c.product.lossDriver === "discount_refund",
    );
    const hasDiscountRefundLoser = discountRefundLoserIndex !== -1;

    const applyDiscount = rng.bool(hasDiscountRefundLoser ? 0.75 : 0.15);
    const discount = applyDiscount ? rng.pick(DISCOUNT_CODES) : null;
    const discountTotal = discount
      ? Math.round((orderSubtotal * discount.percentage) / 100)
      : 0;
    const discountByLine = discount
      ? allocateProportionally(discountTotal, lineOriginalTotals)
      : lineOriginalTotals.map(() => 0);

    const freeShipping = rng.bool(0.3);
    const shippingCharged = freeShipping ? 0 : rng.pick(SHIPPING_RATES);
    const trueShippingCost = chosen.reduce(
      (sum, c) => sum + c.product.variant.trueShippingCostPerUnit * c.quantity,
      0,
    );

    const isShopifyPayments = rng.bool(0.65);
    const gatewayFeePercent = 0.029;
    const gatewayFeeFlat = 30;

    const lineItemIds = chosen.map(
      (_, j) => `gid://shopify/LineItem/${orderId.split("/").pop()}${j}`,
    );

    const lineItemNodes = chosen.map((c, j) => {
      const originalTotal = lineOriginalTotals[j];
      const discountAllocated = discountByLine[j];
      return {
        id: lineItemIds[j],
        title: c.product.title,
        sku: c.product.variant.sku,
        quantity: c.quantity,
        currentQuantity: c.quantity,
        originalTotalSet: { shopMoney: { amount: centsToAmount(originalTotal) } },
        discountedTotalSet: {
          shopMoney: { amount: centsToAmount(originalTotal - discountAllocated) },
        },
        discountAllocations: discount
          ? [{ allocatedAmountSet: { shopMoney: { amount: centsToAmount(discountAllocated) } } }]
          : [],
        taxLines: [],
        variant: {
          id: c.product.variant.id,
          sku: c.product.variant.sku,
          price: centsToAmount(c.product.variant.price),
          inventoryItem: {
            id: `gid://shopify/InventoryItem/${c.product.variant.id.split("/").pop()}`,
            unitCost:
              c.product.variant.nativeCogs !== null
                ? { amount: centsToAmount(c.product.variant.nativeCogs), currencyCode: "USD" }
                : null,
          },
        },
      };
    });

    // Refunds: elevated for discount/refund-loser orders, otherwise a background rate.
    const refunds: unknown[] = [];
    const refundedByLine = chosen.map(() => 0);
    if (rng.bool(hasDiscountRefundLoser ? 0.55 : 0.08)) {
      const fullRefund = rng.bool(hasDiscountRefundLoser ? 0.6 : 0.4);

      // Only refunds routed through the Returns flow carry a structured reason.
      // Most small-merchant refunds are issued straight from the admin and have
      // none at all, so the majority here deliberately produce no `return` block.
      const viaReturnsFlow = rng.bool(0.4);
      const buildReturn = (lineIndexes: number[]) =>
        viaReturnsFlow
          ? {
              returnLineItems: {
                nodes: lineIndexes.map((j) => ({
                  returnReasonDefinition: { name: rng.pick(RETURN_REASONS) },
                  returnReasonNote: null,
                  fulfillmentLineItem: { lineItem: { id: lineItemIds[j] } },
                })),
              },
            }
          : null;
      if (fullRefund) {
        chosen.forEach((c, j) => {
          refundedByLine[j] = lineOriginalTotals[j] - discountByLine[j];
        });
        refunds.push({
          id: `gid://shopify/Refund/${orderId.split("/").pop()}0`,
          createdAt,
          totalRefundedSet: {
            shopMoney: { amount: centsToAmount(refundedByLine.reduce((a, b) => a + b, 0)) },
          },
          refundLineItems: {
            nodes: chosen.map((c, j) => ({
              quantity: c.quantity,
              subtotalSet: { shopMoney: { amount: centsToAmount(refundedByLine[j]) } },
              lineItem: { id: lineItemIds[j], sku: c.product.variant.sku },
            })),
          },
          return: buildReturn(chosen.map((_, j) => j)),
        });
      } else {
        const j = hasDiscountRefundLoser ? discountRefundLoserIndex : rng.int(0, chosen.length - 1);
        const refundQty = hasDiscountRefundLoser
          ? chosen[j].quantity
          : Math.min(chosen[j].quantity, rng.int(1, chosen[j].quantity));
        const perUnitNet =
          (lineOriginalTotals[j] - discountByLine[j]) / chosen[j].quantity;
        refundedByLine[j] = Math.round(perUnitNet * refundQty);
        refunds.push({
          id: `gid://shopify/Refund/${orderId.split("/").pop()}0`,
          createdAt,
          totalRefundedSet: { shopMoney: { amount: centsToAmount(refundedByLine[j]) } },
          refundLineItems: {
            nodes: [
              {
                quantity: refundQty,
                subtotalSet: { shopMoney: { amount: centsToAmount(refundedByLine[j]) } },
                lineItem: { id: lineItemIds[j], sku: chosen[j].product.variant.sku },
              },
            ],
          },
          return: buildReturn([j]),
        });
      }
    }

    const netRevenue = orderSubtotal - discountTotal;
    const chargeableAmount = netRevenue + shippingCharged;
    const trueGatewayFee = Math.round(chargeableAmount * gatewayFeePercent + gatewayFeeFlat);

    const transactions: unknown[] = [
      {
        id: `gid://shopify/OrderTransaction/${orderId.split("/").pop()}`,
        kind: "SALE",
        status: "SUCCESS",
        gateway: isShopifyPayments ? "shopify_payments" : rng.pick(["manual", "cod", "bank_transfer"]),
        amountSet: { shopMoney: { amount: centsToAmount(netRevenue + shippingCharged) } },
        fees: isShopifyPayments
          ? [
              {
                id: `gid://shopify/OrderTransactionFee/${orderId.split("/").pop()}`,
                type: "SERVICE",
                rate: gatewayFeePercent,
                rateName: "Standard",
                flatFee: { amount: centsToAmount(gatewayFeeFlat), currencyCode: "USD" },
                amount: { amount: centsToAmount(trueGatewayFee), currencyCode: "USD" },
              },
            ]
          : [],
      },
    ];

    rawOrders.push({
      id: orderId,
      name: orderName,
      createdAt,
      currencyCode: "USD",
      test: true,
      currentSubtotalPriceSet: { shopMoney: { amount: centsToAmount(netRevenue), currencyCode: "USD" } },
      currentTotalPriceSet: { shopMoney: { amount: centsToAmount(netRevenue + shippingCharged) } },
      currentTotalTaxSet: { shopMoney: { amount: "0.0" } },
      netPaymentSet: { shopMoney: { amount: centsToAmount(netRevenue + shippingCharged) } },
      totalShippingPriceSet: { shopMoney: { amount: centsToAmount(shippingCharged) } },
      shippingLines: freeShipping
        ? { nodes: [] }
        : {
            nodes: [
              {
                title: "Standard Shipping",
                carrierIdentifier: null,
                originalPriceSet: { shopMoney: { amount: centsToAmount(shippingCharged) } },
              },
            ],
          },
      currentTotalDiscountsSet: { shopMoney: { amount: centsToAmount(discountTotal) } },
      discountApplications: discount
        ? {
            nodes: [
              {
                code: discount.code,
                allocationMethod: "ACROSS",
                targetSelection: "ALL",
                targetType: "LINE_ITEM",
                value: { percentage: discount.percentage },
              },
            ],
          }
        : { nodes: [] },
      lineItems: { nodes: lineItemNodes },
      refunds,
      transactions,
    });

    groundTruth.push({
      orderId,
      shippingCost: trueShippingCost,
      gatewayFeePercent,
      gatewayFeeFlat,
      gatewayFeeInPayload: isShopifyPayments,
      lines: chosen.map((c, j) => ({
        lineItemId: lineItemIds[j],
        productId: c.product.id,
        cogs: c.product.variant.trueCogs * c.quantity,
      })),
    });
  }

  return { rawOrders, groundTruth };
}

function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}
