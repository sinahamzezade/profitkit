import prisma from "../db.server";
import { resolveCogs } from "../costs/cogs";
import { resolveFee, resolveShippingCost } from "../costs/fees";
import {
  loadCogsEntries,
  loadFeeRules,
  loadShippingCostConfig,
} from "../costs/repository";
import type { CogsEntry, FeeRule, ShippingCostConfig } from "../costs/types";
import type { LineItemInput, OrderCostInputs } from "../margin/types";

export interface ShopCostConfig {
  cogsEntries: CogsEntry[];
  feeRules: FeeRule[];
  shipping: ShippingCostConfig;
}

/**
 * Loaded once per report run, not once per order — a 500-order shop would otherwise
 * issue 1,500 config queries to compute a single table.
 */
export async function loadShopCostConfig(shopId: string): Promise<ShopCostConfig> {
  const [cogsEntries, feeRules, shipping] = await Promise.all([
    loadCogsEntries(shopId),
    loadFeeRules(shopId),
    loadShippingCostConfig(shopId),
  ]);
  return { cogsEntries, feeRules, shipping };
}

/**
 * Reads one order back out of Postgres and maps it to Day-1 domain inputs, running
 * every cost that Shopify can't tell us through the cost-assumptions ladder.
 */
export async function mapDbOrderToDomainInputs(
  orderId: string,
  config: ShopCostConfig,
): Promise<{ lines: LineItemInput[]; order: OrderCostInputs }> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      lines: {
        include: {
          refunds: true,
          variant: { include: { product: true } },
        },
      },
    },
  });

  const lines: LineItemInput[] = order.lines.map((line) => {
    const refunded = line.refunds.reduce((sum, r) => sum + r.subtotalCents, 0);
    const variant = line.variant;

    const resolved = variant
      ? resolveCogs(
          {
            variantGid: variant.shopifyGid,
            priceCents: variant.priceCents,
            nativeCogsCents: variant.nativeCogsCents,
            vendor: variant.product.vendor,
            // Collection membership isn't ingested yet, so the collection rung can
            // never fire from the database path — vendor is the working group rung.
            collectionIds: [],
          },
          config.cogsEntries,
        )
      : { cents: 0, estimated: true, source: "none" as const };

    // The ladder resolves cost per unit; the line carries a quantity.
    const cogsForLine = resolved.cents * line.quantity;

    return {
      id: line.shopifyGid,
      revenue: line.originalTotalCents,
      discountAllocated: line.discountAllocatedCents,
      cogs: cogsForLine,
      cogsEstimated: resolved.estimated,
      refunded,
    };
  });

  const fee = resolveFee(order.gatewayName, order.gatewayFeeCents, config.feeRules);
  const shipping = resolveShippingCost(config.shipping);

  const orderCost: OrderCostInputs = {
    shippingCharged: order.shippingChargedCents,
    shippingCost: shipping.cents,
    shippingCostEstimated: shipping.estimated,
    shippingCostKnown: shipping.source !== "none",
    gatewayFeePercent: fee.percent,
    gatewayFeeFlat: fee.flatCents,
    gatewayFeeEstimated: fee.estimated,
  };

  return { lines, order: orderCost };
}
