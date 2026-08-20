import { runBackfill } from "../ingestion/backfill";
import { backfillSince, fetchAllProducts, fetchOrdersSince, type GraphqlClient } from "./adapter";

/**
 * Install-time backfill: pull the 60 days `read_orders` allows, then let webhooks
 * accumulate history forward. A merchant who uninstalls loses that accumulation,
 * which is honest rather than a dark pattern — we simply never had the older data.
 */
export async function backfillShop(
  graphql: GraphqlClient,
  shopDomain: string,
  now: Date = new Date(),
) {
  // Products first so order lines resolve to real variants rather than placeholders.
  const products = await fetchAllProducts(graphql);
  const orders = await fetchOrdersSince(graphql, backfillSince(now));

  const result = await runBackfill(shopDomain, { products, orders });
  return { ...result, windowStart: backfillSince(now) };
}
