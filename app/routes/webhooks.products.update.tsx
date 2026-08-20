import type { ActionFunctionArgs } from "react-router";

import { authenticate, unauthenticated } from "../shopify.server";
import { fetchProduct } from "../shopify/adapter";
import { handleProductsUpdate } from "../ingestion/handlers/productsUpdate";

/**
 * products/update — keeps titles, vendors, prices and native unit costs current.
 * Vendor matters beyond display: it's the group rung of the cost ladder, so a
 * vendor rename silently changes which products inherit which estimate.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, session } = await authenticate.webhook(request);
  if (!session) return new Response();

  const gid =
    (payload as { admin_graphql_api_id?: string }).admin_graphql_api_id ??
    `gid://shopify/Product/${(payload as { id: number }).id}`;

  const { admin } = await unauthenticated.admin(shop);
  const product = await fetchProduct(admin.graphql, gid);
  if (!product) return new Response();

  await handleProductsUpdate(shop, product);
  return new Response();
};
