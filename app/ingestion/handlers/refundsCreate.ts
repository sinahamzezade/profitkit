import prisma from "../../db.server";
import { applyRefund, upsertShop } from "../upsert";
import type { RawRefundNode } from "../types";

/**
 * Shopify's real refunds/create webhook carries the refund plus an order_id
 * reference, not the whole order — this looks the order up rather than
 * assuming it was ingested as part of a bigger payload.
 */
export async function handleRefundsCreate(
  shopDomain: string,
  orderShopifyGid: string,
  refund: RawRefundNode,
) {
  const shop = await upsertShop(shopDomain);
  const order = await prisma.order.findUnique({
    where: { shopId_shopifyGid: { shopId: shop.id, shopifyGid: orderShopifyGid } },
  });
  if (!order) return null; // order hasn't been ingested yet — nothing to attach to

  await applyRefund(order.id, refund);
  return order;
}
