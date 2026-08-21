import prisma from "../db.server";
import type { ShopCostConfig } from "../ingestion/dbToDomain";
import {
  aggregateByProduct,
  applyReportOptions,
  MARGIN_ORDER_INCLUDE,
  type LoadedOrder,
  type ProductMarginReport,
  type ReportOptions,
} from "./productMargin";

/**
 * The database half of the product margin report.
 *
 * Split out of productMargin.ts because that module is reachable from client code:
 * a component needs `ProductMarginRow` and the refund-reason label, and importing
 * anything from a module that also imports `db.server` drags the Prisma client into
 * the browser bundle. React Router's production build rejects that outright, while
 * the dev server lets it through — so the failure only appeared when building for
 * deployment. The `.server` suffix now makes an accidental client import fail loudly
 * instead of silently tainting the graph.
 */

export async function loadOrdersForMargin(
  shopId: string,
  since?: Date,
): Promise<LoadedOrder[]> {
  return prisma.order.findMany({
    where: {
      shopId,
      ...(since ? { createdAtShopify: { gte: since } } : {}),
    },
    include: MARGIN_ORDER_INCLUDE,
  });
}

export async function buildProductMarginReport(
  shopId: string,
  config: ShopCostConfig,
  options: ReportOptions = {},
  since?: Date,
): Promise<ProductMarginReport> {
  const orders = await loadOrdersForMargin(shopId, since);
  const rows = aggregateByProduct(orders, config);
  return applyReportOptions(rows, options);
}
