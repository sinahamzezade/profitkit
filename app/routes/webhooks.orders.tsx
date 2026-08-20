import type { ActionFunctionArgs } from "react-router";

import { authenticate, unauthenticated } from "../shopify.server";
import { fetchOrder } from "../shopify/adapter";
import { handleOrdersCreate } from "../ingestion/handlers/ordersCreate";
import { handleOrdersUpdated } from "../ingestion/handlers/ordersUpdated";

/**
 * orders/create and orders/updated.
 *
 * `authenticate.webhook` verifies the HMAC before returning; an unsigned or
 * tampered request throws there and never reaches this code. We deliberately do
 * not hand-roll that check.
 *
 * The webhook payload is REST-shaped and thinner than what the margin engine
 * needs, so we re-fetch the order through the same GraphQL document the backfill
 * uses. One ingestion shape, one code path, no drift between install-time and
 * live data.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, session } = await authenticate.webhook(request);

  if (!session) {
    // App was uninstalled, or this is a replay after uninstall. Nothing to write,
    // and returning 200 stops Shopify retrying forever.
    return new Response();
  }

  const legacyId = (payload as { admin_graphql_api_id?: string; id?: number })
    .admin_graphql_api_id;
  const orderGid = legacyId ?? `gid://shopify/Order/${(payload as { id: number }).id}`;

  const { admin } = await unauthenticated.admin(shop);
  const order = await fetchOrder(admin.graphql, orderGid);
  if (!order) return new Response();

  if (topic === "ORDERS_UPDATED") {
    await handleOrdersUpdated(shop, order);
  } else {
    await handleOrdersCreate(shop, order);
  }

  return new Response();
};
