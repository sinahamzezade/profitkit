import { toCsv } from "../import/csv";
import type { Cents } from "../margin/types";
import type { ProductMarginRow } from "./productMargin";

/**
 * Accountant-ready CSV.
 *
 * Column names are the ones Xero and QuickBooks import mappers expect to see, and
 * money is written as plain decimals with no currency symbols or thousands
 * separators — both choke on "$1,234.56". The currency is stated once in its own
 * column instead, which is what those importers actually read.
 */

// No SKU column: this report aggregates at product grain and a product can carry
// many variants, so any single SKU here would be misleading.
const HEADERS = [
  "Product",
  "Vendor",
  "Units sold",
  "Currency",
  "Gross revenue",
  "Discounts",
  "Net revenue",
  "Cost of goods",
  "Payment fees",
  "Shipping variance",
  "Refunds",
  "Contribution margin",
  "Margin %",
  "Figures include estimates",
];

function amount(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export function buildAccountantCsv(
  rows: ProductMarginRow[],
  options: { currency: string },
): string {
  const body = rows.map((row) => [
    row.title,
    row.vendor ?? "",
    String(row.unitsSold),
    options.currency,
    // Net revenue is what the table shows; gross is it plus the discounts taken off,
    // so an accountant can reconcile against a sales report that includes discounts.
    amount(row.revenue + row.discounts),
    amount(row.discounts),
    amount(row.revenue),
    amount(row.cogs),
    amount(row.fees),
    amount(row.shippingDelta),
    amount(row.refunds),
    amount(row.contributionMargin),
    row.marginPercent == null ? "" : (row.marginPercent * 100).toFixed(1),
    row.estimated ? "yes" : "no",
  ]);

  return toCsv(HEADERS, body);
}

export function accountantCsvFilename(shopDomain: string, now: Date): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  const stamp = now.toISOString().slice(0, 10);
  return `redline-margin-${store}-${stamp}.csv`;
}
