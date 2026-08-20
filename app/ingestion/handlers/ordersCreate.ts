import { upsertOrder, upsertShop } from "../upsert";
import type { RawOrderNode } from "../types";

export async function handleOrdersCreate(shopDomain: string, order: RawOrderNode) {
  const shop = await upsertShop(shopDomain);
  return upsertOrder(shop.id, order);
}
