import { calculateOrderMargin } from "../margin/calculate";
import type { Cents } from "../margin/types";
import type { ShopCostConfig } from "../ingestion/dbToDomain";
import { toDomainInputs, type LoadedOrder } from "./productMargin";

/** Orders as loaded for the margin views; erosion needs no extra fields. */
export type ErosionOrder = LoadedOrder;

/**
 * View 3: where profit leaks month to month.
 *
 * Two honest limits shape this report. Shopify only names a discount when it came
 * from a code — automatic and manual discounts are real money with no label, so
 * they're reported under their own bucket rather than dropped or lumped into a
 * code. And a refund only carries a reason when it went through the Returns flow;
 * a refund issued straight from the admin has none, which for most small merchants
 * is the majority. Inventing a reason there would be worse than admitting the gap.
 */

/** Bucket for discounts that reduced an order without any code attached. */
export const UNCODED_DISCOUNT = "Automatic or manual discount";
/** Bucket for refunds issued outside the Returns flow, where Shopify records no reason. */
export const NO_REASON_RECORDED = "No reason recorded";

export interface ErosionBucket {
  /** Discount code, refund reason, or one of the buckets above. */
  label: string;
  amount: Cents;
  /** Orders (for discounts) or refund lines (for refunds) contributing. */
  count: number;
}

export interface ErosionMonth {
  /** ISO year-month, e.g. "2026-08". */
  month: string;
  discounts: Cents;
  refunds: Cents;
  total: Cents;
}

/**
 * What a discount code actually bought.
 *
 * The amount given away is only half the question — a code that cost $1,477 and
 * pulled in orders that each earned more than an undiscounted one paid for itself.
 * Comparing margin per order against the no-code baseline is the only way to tell
 * a working promotion from an expensive habit.
 */
export interface DiscountPerformance {
  code: string;
  orders: number;
  given: Cents;
  /** Contribution margin of the orders carrying this code. */
  margin: Cents;
  marginPerOrder: Cents;
  /** Margin per order minus the no-code baseline. Positive means it paid off. */
  versusBaseline: Cents;
}

export interface ErosionReport {
  months: ErosionMonth[];
  discountsByCode: ErosionBucket[];
  refundsByReason: ErosionBucket[];
  totalDiscounts: Cents;
  totalRefunds: Cents;
  /** Share of refunded money Shopify gave us no reason for. Drives the honesty note. */
  refundsWithoutReason: Cents;
  /** Per-code verdict, worst first. Empty when no code discounts were used. */
  discountPerformance: DiscountPerformance[];
  /** Margin per order on orders with no discount code — the comparison point. */
  baselineMarginPerOrder: Cents | null;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toBuckets(map: Map<string, { amount: Cents; count: number }>): ErosionBucket[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Takes orders already loaded for the margin views rather than re-querying them —
 * every page that shows erosion also shows margin, so a second read of the same
 * window would be pure waste. `config` is optional: without it the totals still
 * work and the per-code verdict is simply omitted.
 */
export function buildErosionReport(
  orders: ErosionOrder[],
  config?: ShopCostConfig,
): ErosionReport {
  const byMonth = new Map<string, ErosionMonth>();
  const byCode = new Map<string, { amount: Cents; count: number }>();
  const byReason = new Map<string, { amount: Cents; count: number }>();

  const bump = (
    map: Map<string, { amount: Cents; count: number }>,
    label: string,
    amount: Cents,
  ) => {
    const existing = map.get(label);
    if (existing) {
      existing.amount += amount;
      existing.count += 1;
    } else {
      map.set(label, { amount, count: 1 });
    }
  };

  const month = (key: string): ErosionMonth => {
    let entry = byMonth.get(key);
    if (!entry) {
      entry = { month: key, discounts: 0, refunds: 0, total: 0 };
      byMonth.set(key, entry);
    }
    return entry;
  };

  for (const order of orders) {
    if (order.discountTotalCents > 0) {
      month(monthKey(order.createdAtShopify)).discounts += order.discountTotalCents;

      if (order.discountCodes.length === 0) {
        bump(byCode, UNCODED_DISCOUNT, order.discountTotalCents);
      } else {
        // Combined codes share one order-level total; splitting evenly is the only
        // defensible option, since Shopify doesn't attribute the total per code.
        const perCode = Math.round(order.discountTotalCents / order.discountCodes.length);
        for (const code of order.discountCodes) bump(byCode, code, perCode);
      }
    }

    for (const line of order.lines) {
      for (const refund of line.refunds) {
        if (refund.subtotalCents <= 0) continue;
        month(monthKey(refund.refundedAt)).refunds += refund.subtotalCents;
        bump(byReason, refund.reason ?? NO_REASON_RECORDED, refund.subtotalCents);
      }
    }
  }

  const months = [...byMonth.values()]
    .map((entry) => ({ ...entry, total: entry.discounts + entry.refunds }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const discountsByCode = toBuckets(byCode);
  const refundsByReason = toBuckets(byReason);
  const { performance, baseline } = config
    ? measureDiscountCodes(orders, config)
    : { performance: [], baseline: null };

  return {
    months,
    discountsByCode,
    refundsByReason,
    totalDiscounts: discountsByCode.reduce((sum, b) => sum + b.amount, 0),
    totalRefunds: refundsByReason.reduce((sum, b) => sum + b.amount, 0),
    refundsWithoutReason:
      refundsByReason.find((b) => b.label === NO_REASON_RECORDED)?.amount ?? 0,
    discountPerformance: performance,
    baselineMarginPerOrder: baseline,
  };
}

/**
 * Scores each code against orders that used no code at all.
 *
 * An order carrying two codes counts in full for both. Splitting its margin between
 * them would understate each, and the question being asked is "how did orders
 * carrying this code perform", not "how much of this order belongs to this code".
 */
function measureDiscountCodes(
  orders: ErosionOrder[],
  config: ShopCostConfig,
): { performance: DiscountPerformance[]; baseline: Cents | null } {
  const byCode = new Map<string, { orders: number; given: Cents; margin: Cents }>();
  let baselineMargin = 0;
  let baselineOrders = 0;

  for (const order of orders) {
    const { lines, order: orderCost } = toDomainInputs(order, config);
    const margin = calculateOrderMargin(lines, orderCost).reduce(
      (sum, line) => sum + line.contributionMargin,
      0,
    );

    if (order.discountCodes.length === 0) {
      baselineMargin += margin;
      baselineOrders += 1;
      continue;
    }

    const perCode = Math.round(order.discountTotalCents / order.discountCodes.length);
    for (const code of order.discountCodes) {
      const entry = byCode.get(code) ?? { orders: 0, given: 0, margin: 0 };
      entry.orders += 1;
      entry.given += perCode;
      entry.margin += margin;
      byCode.set(code, entry);
    }
  }

  const baseline = baselineOrders === 0 ? null : Math.round(baselineMargin / baselineOrders);

  const performance = [...byCode.entries()]
    .map(([code, entry]) => {
      const marginPerOrder = Math.round(entry.margin / entry.orders);
      return {
        code,
        orders: entry.orders,
        given: entry.given,
        margin: entry.margin,
        marginPerOrder,
        versusBaseline: baseline == null ? 0 : marginPerOrder - baseline,
      };
    })
    .sort((a, b) => a.versusBaseline - b.versusBaseline);

  return { performance, baseline };
}
