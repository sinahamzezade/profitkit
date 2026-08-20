import { upsertProduct, upsertShop } from "../upsert";
import type { RawProductNode } from "../types";

export async function handleProductsUpdate(shopDomain: string, product: RawProductNode) {
  const shop = await upsertShop(shopDomain);
  return upsertProduct(shop.id, product);
}
