import { handleOrdersCreate } from "./ordersCreate";
import type { RawOrderNode } from "../types";

/**
 * Identical body to orders/create — the upsert is already idempotent and update-safe,
 * so there's nothing update-specific to do. Kept as its own named entry point because
 * that's the real webhook topic, and a future difference (e.g. audit logging) shouldn't
 * have to be smuggled into the create path.
 */
export async function handleOrdersUpdated(shopDomain: string, order: RawOrderNode) {
  return handleOrdersCreate(shopDomain, order);
}
