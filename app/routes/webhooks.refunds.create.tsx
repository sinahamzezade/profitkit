import type { ActionFunctionArgs } from "react-router";

import { authenticate, unauthenticated } from "../shopify.server";
import { fetchOrder } from "../shopify/adapter";
import { handleOrdersUpdated } from "../ingestion/handlers/ordersUpdated";

/**
 * refunds/create.
 *
 * The payload names the order but carries only a partial view of it, and a refund
 * changes figures across the whole order (line refunds, and the financial status
 * that feeds fees). Re-fetching the full order and running it through the normal
 * update path is simpler and less error-prone than patching a refund in isolation.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, session } = await authenticate.webhook(request);
  if (!session) return new Response();

  const orderId = (payload as { order_id?: number }).order_id;
  if (!orderId) return new Response();

  const { admin } = await unauthenticated.admin(shop);
  const order = await fetchOrder(admin.graphql, `gid://shopify/Order/${orderId}`);
  if (!order) return new Response();

  await handleOrdersUpdated(shop, order);
  return new Response();
};
