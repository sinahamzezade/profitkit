import prisma from "../db.server";
import { resolveCogs } from "../costs/cogs";
import type { CogsSource } from "../costs/types";
import { resolveFee, resolveShippingCost } from "../costs/fees";
import type { ShopCostConfig } from "../ingestion/dbToDomain";
import { calculateOrderMargin } from "../margin/calculate";
import type { Cents, LineItemInput, OrderCostInputs } from "../margin/types";

export interface ProductMarginRow {
  productId: string;
  title: string;
  vendor: string | null;
  unitsSold: number;
  /** Orders this product appeared in — the denominator for per-order averages. */
  orderCount: number;
  /** Net of line-level discount allocation. Discount impact gets its own view. */
  revenue: Cents;
  /** Discount allocated to this product's lines, already netted out of revenue. */
  discounts: Cents;
  cogs: Cents;
  fees: Cents;
  /** shippingCost − shippingCharged. Positive means shipping ate margin. */
  shippingDelta: Cents;
  refunds: Cents;
  contributionMargin: Cents;
  /** Null when a product has no revenue to divide by, rather than a fake 0%. */
  marginPercent: number | null;
  /** True when any figure behind this row came from the cost ladder rather than real data. */
  estimated: boolean;
  /** Which rung of the cost ladder supplied this product's cost, at its least precise. */
  costSource: CogsSource;
}

export type SortKey =
  | "title"
  | "unitsSold"
  | "revenue"
  | "cogs"
  | "fees"
  | "shippingDelta"
  | "refunds"
  | "contributionMargin"
  | "marginPercent";

export interface ReportOptions {
  sortKey?: SortKey;
  sortDirection?: "asc" | "desc";
  /** Case-insensitive substring match on product title or vendor. */
  search?: string;
  onlyNegative?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ProductMarginReport {
  rows: ProductMarginRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  /** Totals across every row matching the filter, not just the current page. */
  totals: {
    revenue: Cents;
    cogs: Cents;
    contributionMargin: Cents;
    negativeProducts: number;
  };
}

/**
 * Orders with everything margin needs, in one query rather than one per order.
 * The naive shape here was 500 orders × 2 queries; at a 1,000-product catalog
 * that's what makes the table choke, not the arithmetic.
 */
export async function loadOrdersForMargin(shopId: string, since?: Date) {
  return prisma.order.findMany({
    where: {
      shopId,
      ...(since ? { createdAtShopify: { gte: since } } : {}),
    },
    include: {
      lines: {
        include: {
          refunds: true,
          variant: { include: { product: true } },
        },
      },
    },
  });
}

export type LoadedOrder = Awaited<ReturnType<typeof loadOrdersForMargin>>[number];

/** Maps a loaded order to domain inputs, resolving costs through the ladder. */
export function toDomainInputs(
  order: LoadedOrder,
  config: ShopCostConfig,
): {
  lines: LineItemInput[];
  order: OrderCostInputs;
  productIdByLineGid: Map<string, string>;
  costSourceByLineGid: Map<string, CogsSource>;
} {
  const productIdByLineGid = new Map<string, string>();
  const costSourceByLineGid = new Map<string, CogsSource>();

  const lines: LineItemInput[] = order.lines.map((line) => {
    const refunded = line.refunds.reduce((sum, r) => sum + r.subtotalCents, 0);
    const variant = line.variant;

    if (variant) productIdByLineGid.set(line.shopifyGid, variant.product.id);

    const resolved = variant
      ? resolveCogs(
          {
            variantGid: variant.shopifyGid,
            priceCents: variant.priceCents,
            nativeCogsCents: variant.nativeCogsCents,
            vendor: variant.product.vendor,
            collectionIds: [],
          },
          config.cogsEntries,
        )
      : { cents: 0, estimated: true, source: "none" as const };

    costSourceByLineGid.set(line.shopifyGid, resolved.source);

    return {
      id: line.shopifyGid,
      revenue: line.originalTotalCents,
      discountAllocated: line.discountAllocatedCents,
      cogs: resolved.cents * line.quantity,
      cogsEstimated: resolved.estimated,
      refunded,
    };
  });

  const fee = resolveFee(order.gatewayName, order.gatewayFeeCents, config.feeRules);
  const shipping = resolveShippingCost(config.shipping);

  return {
    lines,
    order: {
      shippingCharged: order.shippingChargedCents,
      shippingCost: shipping.cents,
      shippingCostEstimated: shipping.estimated,
      gatewayFeePercent: fee.percent,
      gatewayFeeFlat: fee.flatCents,
      gatewayFeeEstimated: fee.estimated,
    },
    productIdByLineGid,
    costSourceByLineGid,
  };
}

/**
 * Least-precise wins. A product whose cost is measured on one variant and guessed
 * on another is only as trustworthy as the guess, and saying otherwise would
 * overstate how solid the number is.
 */
const SOURCE_PRECISION: Record<CogsSource, number> = {
  variant_override: 0,
  native: 1,
  collection: 2,
  vendor: 3,
  global: 4,
  none: 5,
};

function leastPrecise(a: CogsSource, b: CogsSource): CogsSource {
  return SOURCE_PRECISION[b] > SOURCE_PRECISION[a] ? b : a;
}

export interface MarginMonth {
  /** ISO year-month, e.g. "2026-08". */
  month: string;
  revenue: Cents;
  contributionMargin: Cents;
  /** Null when a month took no revenue, rather than a fake 0%. */
  marginPercent: number | null;
  orderCount: number;
}

/**
 * Margin by calendar month, from the same loaded orders as the product view.
 *
 * The app could previously only answer "what is broken"; without this it can't
 * answer "is it getting better", which is the immediate next question once a
 * merchant has acted on anything.
 *
 * The first and last months are usually partial — the window rarely lands on a
 * month boundary — so callers should say so rather than letting a half-month read
 * as a collapse.
 */
export function aggregateByMonth(
  orders: LoadedOrder[],
  config: ShopCostConfig,
): MarginMonth[] {
  const byMonth = new Map<string, MarginMonth>();

  for (const order of orders) {
    const date = order.createdAtShopify;
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

    let entry = byMonth.get(key);
    if (!entry) {
      entry = { month: key, revenue: 0, contributionMargin: 0, marginPercent: null, orderCount: 0 };
      byMonth.set(key, entry);
    }

    const { lines, order: orderCost } = toDomainInputs(order, config);
    for (const result of calculateOrderMargin(lines, orderCost)) {
      entry.revenue += result.revenue - result.discountAllocated;
      entry.contributionMargin += result.contributionMargin;
    }
    entry.orderCount += 1;
  }

  return [...byMonth.values()]
    .map((m) => ({
      ...m,
      marginPercent: m.revenue === 0 ? null : m.contributionMargin / m.revenue,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface VendorMargin {
  vendor: string;
  products: number;
  revenue: Cents;
  contributionMargin: Cents;
  marginPercent: number | null;
}

/**
 * Margin rolled up by vendor.
 *
 * Vendor is a rung of the cost ladder, not just a label, so a vendor whose whole
 * range earns badly is one negotiation rather than twenty product decisions.
 * Products with no vendor are left out rather than pooled into a fake "Other",
 * which would look like a supplier that doesn't exist.
 */
export function aggregateByVendor(rows: ProductMarginRow[]): VendorMargin[] {
  const byVendor = new Map<string, VendorMargin>();

  for (const row of rows) {
    const vendor = row.vendor?.trim();
    if (!vendor) continue;

    let entry = byVendor.get(vendor);
    if (!entry) {
      entry = { vendor, products: 0, revenue: 0, contributionMargin: 0, marginPercent: null };
      byVendor.set(vendor, entry);
    }
    entry.products += 1;
    entry.revenue += row.revenue;
    entry.contributionMargin += row.contributionMargin;
  }

  return [...byVendor.values()]
    .map((v) => ({
      ...v,
      marginPercent: v.revenue === 0 ? null : v.contributionMargin / v.revenue,
    }))
    .sort((a, b) => a.contributionMargin - b.contributionMargin);
}

/** Aggregates every order into one row per product. Pure once the data is loaded. */
export function aggregateByProduct(
  orders: LoadedOrder[],
  config: ShopCostConfig,
): ProductMarginRow[] {
  const accumulator = new Map<string, ProductMarginRow>();
  // A product can occupy two lines of one order; count that order once.
  const ordersSeenByProduct = new Map<string, Set<string>>();

  for (const order of orders) {
    const { lines, order: orderCost, productIdByLineGid, costSourceByLineGid } =
      toDomainInputs(order, config);
    const results = calculateOrderMargin(lines, orderCost);
    const quantityByLineGid = new Map(order.lines.map((l) => [l.shopifyGid, l.quantity]));
    const refundedQtyByLineGid = new Map(
      order.lines.map((l) => [l.shopifyGid, l.refunds.reduce((s, r) => s + r.quantity, 0)]),
    );
    const productMeta = new Map(
      order.lines
        .filter((l) => l.variant)
        .map((l) => [l.shopifyGid, l.variant!.product]),
    );

    for (const result of results) {
      const productId = productIdByLineGid.get(result.lineItemId);
      if (!productId) continue; // line has no variant — nothing to attribute it to

      let row = accumulator.get(productId);
      if (!row) {
        const meta = productMeta.get(result.lineItemId);
        row = {
          productId,
          title: meta?.title ?? "(unknown product)",
          vendor: meta?.vendor ?? null,
          unitsSold: 0,
          orderCount: 0,
          revenue: 0,
          discounts: 0,
          cogs: 0,
          fees: 0,
          shippingDelta: 0,
          refunds: 0,
          contributionMargin: 0,
          marginPercent: null,
          estimated: false,
          costSource: "variant_override",
        };
        accumulator.set(productId, row);
      }

      // Units sold counts what the customer kept — a refunded unit was not a sale.
      const sold = quantityByLineGid.get(result.lineItemId) ?? 0;
      const returned = refundedQtyByLineGid.get(result.lineItemId) ?? 0;
      row.unitsSold += Math.max(0, sold - returned);

      let seen = ordersSeenByProduct.get(productId);
      if (!seen) {
        seen = new Set();
        ordersSeenByProduct.set(productId, seen);
      }
      if (!seen.has(order.id)) {
        seen.add(order.id);
        row.orderCount += 1;
      }

      row.revenue += result.revenue - result.discountAllocated;
      row.discounts += result.discountAllocated;
      row.cogs += result.cogs;
      row.fees += result.gatewayFee;
      row.shippingDelta += result.shippingLoss;
      row.refunds += result.refundImpact;
      row.contributionMargin += result.contributionMargin;
      row.estimated = row.estimated || result.estimated;
      const source = costSourceByLineGid.get(result.lineItemId);
      if (source) row.costSource = leastPrecise(row.costSource, source);
    }
  }

  for (const row of accumulator.values()) {
    row.marginPercent = row.revenue === 0 ? null : row.contributionMargin / row.revenue;
  }

  return [...accumulator.values()];
}

/**
 * Returns the comparison for the sort key, or null when the pair must be ordered
 * by null-ness instead. Kept separate from direction because "nulls last" has to
 * survive the descending flip — negating it would float them to the top.
 */
function compare(a: ProductMarginRow, b: ProductMarginRow, key: SortKey): number {
  if (key === "title") return a.title.localeCompare(b.title);
  return (a[key] as number) - (b[key] as number);
}

function nullRank(row: ProductMarginRow, key: SortKey): number {
  return row[key] == null ? 1 : 0;
}

export function applyReportOptions(
  allRows: ProductMarginRow[],
  options: ReportOptions,
): ProductMarginReport {
  const {
    sortKey = "contributionMargin",
    sortDirection = "asc",
    search = "",
    onlyNegative = false,
    page = 1,
    pageSize = 50,
  } = options;

  const needle = search.trim().toLowerCase();
  let filtered = allRows;
  if (needle !== "") {
    filtered = filtered.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        (r.vendor ?? "").toLowerCase().includes(needle),
    );
  }
  if (onlyNegative) {
    filtered = filtered.filter((r) => r.contributionMargin < 0);
  }

  const sorted = [...filtered].sort((a, b) => {
    // Products with no revenue carry a null margin %; they belong at the bottom
    // whichever way the column is sorted, so this runs outside the direction flip.
    const nullDifference = nullRank(a, sortKey) - nullRank(b, sortKey);
    if (nullDifference !== 0) return nullDifference;

    const result = compare(a, b, sortKey);
    return sortDirection === "asc" ? result : -result;
  });

  const totalRows = sorted.length;
  const lastPage = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), lastPage);
  const start = (safePage - 1) * pageSize;

  return {
    rows: sorted.slice(start, start + pageSize),
    totalRows,
    page: safePage,
    pageSize,
    totals: {
      revenue: filtered.reduce((s, r) => s + r.revenue, 0),
      cogs: filtered.reduce((s, r) => s + r.cogs, 0),
      contributionMargin: filtered.reduce((s, r) => s + r.contributionMargin, 0),
      negativeProducts: filtered.filter((r) => r.contributionMargin < 0).length,
    },
  };
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
