import type { Cents } from "../margin/types";
import type { ProductMarginRow } from "./productMargin";
import { dayWord } from "../text";

/**
 * "The 10 products losing you money" — the view the app is for.
 *
 * The hard part isn't ranking by margin, it's saying *why* in one sentence a
 * merchant can act on. Naming the largest cost is useless: cost of goods is the
 * largest cost on almost everything, so every product would blame COGS and the
 * view would say nothing.
 *
 * Instead each cost is measured as a share of that product's revenue and compared
 * against the same share across the rest of the catalog. The driver is whichever
 * cost is most out of line with how this store normally operates — that's the one
 * worth a merchant's attention.
 */

export type LossDriver = "cogs" | "shipping" | "discounts" | "refunds" | "low_price";

export interface LossLeader {
  row: ProductMarginRow;
  driver: LossDriver;
  /** One plain-English sentence explaining the loss, amount and period included. */
  explanation: string;
  /**
   * The same explanation without the "this product lost £X in N days" opener, for
   * surfaces that already show the amount — repeating it there is noise.
   */
  diagnosis: string;
  /**
   * Loss per unit sold. The total says which product to fix first; this says whether
   * it's structurally broken or just selling in volume, which are different problems
   * with different fixes. Null when nothing was kept after refunds.
   */
  lossPerUnit: Cents | null;
  /** How far this cost's revenue share exceeds the catalog norm, in percentage points. */
  excessPoints: number;
}

export interface HeroReport {
  /** Negative-margin products, worst first. Empty when nothing loses money. */
  losers: LossLeader[];
  /**
   * Shown instead of an empty list: the thinnest margins, so the view still says
   * something useful to a healthy store.
   */
  thinnest: ProductMarginRow[];
  /**
   * Products whose cost data looks wrong rather than whose economics look bad.
   * Held out of the ranking so one bad spreadsheet cell can't define the view.
   */
  suspect: ProductMarginRow[];
  periodDays: number;
  totalLost: Cents;
}

/** Cost share of revenue, guarded against products with no revenue to divide by. */
function share(cost: Cents, revenue: Cents): number {
  return revenue > 0 ? cost / revenue : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatMoney(cents: Cents, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/**
 * A cost above three times revenue is not a business problem, it's a data problem —
 * the same threshold the CSV importer warns on. Left in the ranking, one mistyped
 * cost outranks every genuine loss-maker and the view becomes untrustworthy.
 */
export function isSuspect(row: ProductMarginRow): boolean {
  return row.revenue > 0 && row.cogs > row.revenue * 3;
}

export function buildHeroReport(
  allRows: ProductMarginRow[],
  options: { periodDays: number; currency: string; limit?: number },
): HeroReport {
  const { periodDays, currency, limit = 10 } = options;

  const suspect = allRows.filter(isSuspect);
  const trustworthy = allRows.filter((row) => !isSuspect(row));

  // Catalog norms come from products that are actually selling; products with no
  // revenue would drag every median toward zero and make everything look abnormal.
  const selling = trustworthy.filter((row) => row.revenue > 0);
  const norms = {
    cogs: median(selling.map((r) => share(r.cogs, r.revenue))),
    shipping: median(selling.map((r) => share(r.shippingDelta, r.revenue))),
    discounts: median(selling.map((r) => share(r.discounts, r.revenue))),
    refunds: median(selling.map((r) => share(r.refunds, r.revenue))),
  };

  const losers = trustworthy
    .filter((row) => row.contributionMargin < 0)
    .sort((a, b) => a.contributionMargin - b.contributionMargin)
    .slice(0, limit)
    .map((row) => explainLoss(row, norms, periodDays, currency));

  const thinnest = trustworthy
    .filter((row) => row.contributionMargin >= 0 && row.revenue > 0)
    .sort((a, b) => (a.marginPercent ?? 0) - (b.marginPercent ?? 0))
    .slice(0, 3);

  return {
    losers,
    thinnest,
    suspect,
    periodDays,
    totalLost: losers.reduce((sum, l) => sum + l.row.contributionMargin, 0),
  };
}

function explainLoss(
  row: ProductMarginRow,
  norms: { cogs: number; shipping: number; discounts: number; refunds: number },
  periodDays: number,
  currency: string,
): LossLeader {
  const excesses: Array<{ driver: LossDriver; points: number }> = [
    { driver: "cogs", points: share(row.cogs, row.revenue) - norms.cogs },
    { driver: "shipping", points: share(row.shippingDelta, row.revenue) - norms.shipping },
    { driver: "discounts", points: share(row.discounts, row.revenue) - norms.discounts },
    { driver: "refunds", points: share(row.refunds, row.revenue) - norms.refunds },
  ];
  excesses.sort((a, b) => b.points - a.points);
  const worst = excesses[0];

  const lost = formatMoney(Math.abs(row.contributionMargin), currency);
  const opening = `This product lost ${lost} in ${periodDays} ${dayWord(
    periodDays,
  )}.`;
  const lossPerUnit =
    row.unitsSold > 0 ? Math.round(row.contributionMargin / row.unitsSold) : null;

  // Nothing stands out against the catalog: the product simply isn't priced above
  // what it costs to sell. Saying "cost of goods is normal" would be true and useless.
  if (worst.points <= 0) {
    const diagnosis =
      "Nothing here is unusual on its own — the price just doesn't cover what it " +
      "costs to sell.";
    return {
      row,
      driver: "low_price",
      excessPoints: 0,
      diagnosis,
      lossPerUnit,
      explanation: `${opening} ${diagnosis}`,
    };
  }

  const excessPoints = worst.points * 100;
  let diagnosis: string;

  switch (worst.driver) {
    case "cogs": {
      diagnosis =
        `Cost of goods eats ${(share(row.cogs, row.revenue) * 100).toFixed(0)}% ` +
        `of its revenue, against ${(norms.cogs * 100).toFixed(0)}% across your other products.`;
      break;
    }
    case "shipping": {
      const perOrder = row.orderCount > 0 ? row.shippingDelta / row.orderCount : 0;
      diagnosis =
        `Shipping costs exceed what you charge by an average of ` +
        `${formatMoney(perOrder, currency)} per order.`;
      break;
    }
    case "discounts": {
      diagnosis =
        `Discounts take ${(share(row.discounts, row.revenue) * 100).toFixed(0)}% ` +
        `of its revenue, against ${(norms.discounts * 100).toFixed(0)}% across your other products.`;
      break;
    }
    case "refunds": {
      // Refunds can legitimately exceed revenue in the reporting window: an order
      // placed before the window and refunded inside it contributes a refund with
      // no matching revenue. Printing "123% of its revenue" there reads as a bug,
      // so say what actually happened instead.
      diagnosis =
        row.refunds > row.revenue
          ? `More was refunded than this product took in over the period — ` +
            `some of those refunds are against orders placed earlier.`
          : `${(share(row.refunds, row.revenue) * 100).toFixed(0)}% of its revenue ` +
            `came back as refunds, against ${(norms.refunds * 100).toFixed(0)}% elsewhere.`;
      break;
    }
    default: {
      diagnosis = "";
    }
  }

  return {
    row,
    driver: worst.driver,
    excessPoints,
    diagnosis,
    lossPerUnit,
    explanation: diagnosis ? `${opening} ${diagnosis}` : opening,
  };
}

export const DRIVER_LABELS: Record<LossDriver, string> = {
  cogs: "Cost of goods",
  shipping: "Shipping",
  discounts: "Discounts",
  refunds: "Refunds",
  low_price: "Price too low",
};
