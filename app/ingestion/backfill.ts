import { handleOrdersCreate } from "./handlers/ordersCreate";
import { handleProductsUpdate } from "./handlers/productsUpdate";
import type { RawOrderNode, RawProductNode } from "./types";

/**
 * The backfill path is deliberately just a loop over the same handlers a webhook
 * would call — no separate ingestion logic to keep in sync. Products first, then
 * orders, so variants exist before order lines try to reference them (though the
 * upsert layer tolerates either order via placeholder variants).
 */
export async function runBackfill(
  shopDomain: string,
  data: { products: RawProductNode[]; orders: RawOrderNode[] },
) {
  let productsIngested = 0;
  for (const product of data.products) {
    await handleProductsUpdate(shopDomain, product);
    productsIngested++;
  }

  let ordersIngested = 0;
  for (const order of data.orders) {
    await handleOrdersCreate(shopDomain, order);
    ordersIngested++;
  }

  return { productsIngested, ordersIngested };
}
