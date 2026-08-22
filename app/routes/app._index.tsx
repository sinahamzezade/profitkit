import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { hasAnyCogsConfigured } from "../costs/cogs";
import { resolveTierForShop, resolveTierLimits } from "../billing/tier";
import { listGateways, setGlobalCogsPercent } from "../costs/repository";
import { loadShopCostConfig } from "../ingestion/dbToDomain";
import { EmptyOverview } from "../overview/EmptyOverview";
import { OverviewPage } from "../overview/OverviewPage";
import { OVERVIEW_PREVIEW, type OverviewReady } from "../overview/types";
import { hydrateProductImages } from "../shopify/images.server";
import {
  aggregateByDay,
  aggregateByMonth,
  aggregateByProduct,
  aggregateByVendor,
  applyReportOptions,
} from "../reports/productMargin";
import { loadOrdersForMargin } from "../reports/productMargin.server";
import { buildErosionReport } from "../reports/erosion";
import { buildCostCoverage } from "../reports/costCoverage";
import { buildHeroReport } from "../reports/lossLeaders";

/** Days of order history the report covers, from the data itself rather than a guess. */
async function resolvePeriod(shopId: string, since: Date | null) {
  const where = {
    shopId,
    ...(since ? { createdAtShopify: { gte: since } } : {}),
  };
  const [oldest, newest] = await Promise.all([
    prisma.order.findFirst({
      where,
      orderBy: { createdAtShopify: "asc" },
      select: { createdAtShopify: true },
    }),
    prisma.order.findFirst({
      where,
      orderBy: { createdAtShopify: "desc" },
      select: { createdAtShopify: true },
    }),
  ]);
  if (!oldest || !newest) return { days: 0, from: null, to: null };

  const from = oldest.createdAtShopify;
  const to = newest.createdAtShopify;
  const days = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / 86_400_000),
  );
  return { days, from, to };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    return { state: "no-data" as const };
  }

  // Tier bound is applied to the query, not to what gets rendered.
  const limits = resolveTierLimits(
    await resolveTierForShop(session.shop, billing),
    new Date(),
  );

  const config = await loadShopCostConfig(shop.id);

  // Orders are loaded once and aggregated three ways. Each panel calling its own
  // builder would re-read the whole window per panel.
  const [orders, period, anyOrder] = await Promise.all([
    loadOrdersForMargin(shop.id, limits.since ?? undefined),
    resolvePeriod(shop.id, limits.since),
    prisma.order.findFirst({
      where: { shopId: shop.id },
      select: { currencyCode: true },
    }),
  ]);
  const periodDays = period.days;
  const erosion = buildErosionReport(orders);

  const rows = aggregateByProduct(orders, config);
  const report = applyReportOptions(rows, { pageSize: 100_000 });
  const currency = anyOrder?.currencyCode ?? "USD";

  /*
   * Setup-guide progress, computed rather than stored.
   *
   * Each step is a thing that makes the numbers less of an estimate, and each is
   * derived from real state — so the guide cannot claim a step is done when it
   * isn't, and it completes itself as the merchant works.
   *
   * The fee step is the subtle one. A shop taking payment only through Shopify
   * Payments needs no rule at all, so "every gateway that needs a rule has one"
   * is the test, not "any rule exists" — otherwise the step could never complete
   * for those shops and the guide would nag forever.
   */
  const gateways = await listGateways(shop.id);
  const gatewaysNeedingRule = gateways.filter((g) => g.ordersMissingFee > 0);
  const gatewaysWithRule = new Set(
    config.feeRules.map((r) => r.gatewayName.toLowerCase()),
  );
  const setup = {
    ordersImported: report.totalRows > 0,
    costEstimate: hasAnyCogsConfigured(config.cogsEntries),
    paymentFees: gatewaysNeedingRule.every((g) =>
      gatewaysWithRule.has(g.gateway.toLowerCase()),
    ),
    gatewaysNeedingRule: gatewaysNeedingRule.length,
    shippingCost: config.shipping.globalPerOrderCents != null,
  };

  /*
   * Previous-period comparison for the stat deltas.
   *
   * The comparison window is the same length as the current one, immediately
   * before it, and is only loaded when the tier's own query bound reaches that far
   * back. On free, a 90-day view would need 180 days to compare against, which the
   * bound forbids — so rather than quietly widen a paid boundary, the cards show no
   * delta and the caption says the period is uncompared.
   */
  const windowMs =
    period.from && period.to ? period.to.getTime() - period.from.getTime() : 0;
  const priorFrom =
    period.from && windowMs > 0
      ? new Date(period.from.getTime() - windowMs)
      : null;
  const canCompare =
    priorFrom !== null && (limits.since === null || priorFrom >= limits.since);

  const priorOrders =
    canCompare && period.from
      ? await loadOrdersForMargin(shop.id, priorFrom, period.from)
      : [];
  const priorTotals = applyReportOptions(
    canCompare ? aggregateByProduct(priorOrders, config) : [],
    { pageSize: 100_000 },
  ).totals;
  const priorErosion = canCompare ? buildErosionReport(priorOrders) : null;

  const stats = {
    from: period.from ? period.from.toISOString() : null,
    to: period.to ? period.to.toISOString() : null,
    days:
      period.from && period.to
        ? aggregateByDay(orders, config, period.from, period.to)
        : [],
    previous: canCompare
      ? {
          contributionMargin: priorTotals.contributionMargin,
          revenue: priorTotals.revenue,
          negativeProducts: priorTotals.negativeProducts,
          givenBack:
            (priorErosion?.totalDiscounts ?? 0) +
            (priorErosion?.totalRefunds ?? 0),
        }
      : null,
  };

  // Fallback when nothing sold at a loss — the product widget still needs a preview.
  const earners = [...rows]
    .filter((r) => r.contributionMargin > 0)
    .sort((a, b) => b.contributionMargin - a.contributionMargin)
    .slice(0, OVERVIEW_PREVIEW.products);

  const hero = buildHeroReport(rows, { periodDays, currency });
  const previewIds =
    hero.losers.length > 0
      ? hero.losers
          .slice(0, OVERVIEW_PREVIEW.products)
          .map((leader) => leader.row.productId)
      : earners.map((row) => row.productId);
  const images = await hydrateProductImages(admin.graphql, shop.id, previewIds);

  const vendors = aggregateByVendor(rows);

  return {
    state: "ready" as const,
    hero: {
      ...hero,
      losers: hero.losers.map((leader) => ({
        ...leader,
        row: {
          ...leader.row,
          imageUrl: images.get(leader.row.productId) ?? leader.row.imageUrl,
        },
      })),
    },
    coverage: buildCostCoverage(rows),
    // Whole-month rollup for the margin-over-time chart. Cheap: the orders are
    // already loaded for every other figure on this page.
    months: aggregateByMonth(orders, config),
    earners: earners.map((row) => ({
      ...row,
      imageUrl: images.get(row.productId) ?? row.imageUrl,
    })),
    vendors: vendors.slice(0, OVERVIEW_PREVIEW.vendors),
    vendorCount: vendors.length,
    totalRevenue: report.totals.revenue,
    erosion: {
      totalDiscounts: erosion.totalDiscounts,
      totalRefunds: erosion.totalRefunds,
      topCode: erosion.discountsByCode[0] ?? null,
      topReason: erosion.refundsByReason[0] ?? null,
    },
    currency,
    hasCostData: setup.costEstimate,
    setup,
    stats,
    productCount: report.totalRows,
    totalMargin: report.totals.contributionMargin,
  } satisfies OverviewReady;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const percent = Number(formData.get("percent"));

  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    return { error: "Enter a number between 1 and 99." };
  }

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) return { error: "No data for this store yet." };

  await setGlobalCogsPercent(shop.id, percent / 100);
  return { ok: true };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();

  if (data.state === "no-data") {
    return <EmptyOverview />;
  }

  return <OverviewPage data={data} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
