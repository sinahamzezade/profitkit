import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { resolveTierForShop, resolveTierLimits, TierRequiredError } from "../billing/tier";
import { loadShopCostConfig } from "../ingestion/dbToDomain";
import { buildProductMarginReport } from "../reports/productMargin";
import { accountantCsvFilename, buildAccountantCsv } from "../reports/accountantExport";

/**
 * Accountant CSV download. The tier check runs before any data is read, so a free
 * plan can't reach the file by guessing the URL — the gate isn't a hidden button.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const tier = await resolveTierForShop(session.shop, billing);
  const limits = resolveTierLimits(tier, new Date());

  try {
    if (!limits.canExport) throw new TierRequiredError("Accountant export");
  } catch (error) {
    if (error instanceof TierRequiredError) {
      return new Response(error.message, { status: 402 });
    }
    throw error;
  }

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return new Response("No data for this store yet.", { status: 404 });

  const config = await loadShopCostConfig(shop.id);
  const report = await buildProductMarginReport(
    shop.id,
    config,
    { pageSize: 100_000, sortKey: "contributionMargin", sortDirection: "asc" },
    limits.since ?? undefined,
  );

  const anyOrder = await prisma.order.findFirst({
    where: { shopId: shop.id },
    select: { currencyCode: true },
  });

  const csv = buildAccountantCsv(report.rows, {
    currency: anyOrder?.currencyCode ?? "USD",
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${accountantCsvFilename(
        session.shop,
        new Date(),
      )}"`,
    },
  });
};
