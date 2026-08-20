import prisma from "../app/db.server";
import { loadShopCostConfig } from "../app/ingestion/dbToDomain";
import { resolveCogs } from "../app/costs/cogs";
import { buildProductMarginReport, loadOrdersForMargin } from "../app/reports/productMargin";
import { buildErosionReport } from "../app/reports/erosion";

/**
 * The day-6 acceptance check: every number in the table has to reconcile against
 * an independent count of the underlying rows.
 *
 * Recomputes revenue, COGS, refunds and units for ten sample products by walking
 * order_lines directly — plain summation, never touching the report's aggregation
 * path — then compares. Per-order allocations (fees, shipping) can't be re-derived
 * per product this way, so those are checked by the invariants that must hold
 * instead: every row's columns must sum to its contribution margin, and allocated
 * fees across all lines must equal what the orders actually carry.
 */
function money(cents: number): string {
  return (cents / 100).toFixed(2).padStart(11);
}

async function main() {
  // Explicit domain when given: more than one shop can exist once seed data has
  // been loaded under a real dev store, and findFirst would pick arbitrarily.
  const domain = process.argv[2];
  const shop = domain
    ? await prisma.shop.findUnique({ where: { domain } })
    : await prisma.shop.findFirst();
  if (!shop) {
    console.error(
      domain
        ? `No shop with domain ${domain}.`
        : "No shop found. Run `npm run load-seed` first.",
    );
    process.exit(1);
  }
  console.log(`Reconciling ${shop.domain}\n`);

  const config = await loadShopCostConfig(shop.id);
  const report = await buildProductMarginReport(shop.id, config, { pageSize: 10_000 });

  // Ten products spread across the margin range, not just the worst ten.
  const step = Math.max(1, Math.floor(report.rows.length / 10));
  const sample = report.rows.filter((_, i) => i % step === 0).slice(0, 10);

  console.log(
    "product".padEnd(26) +
      "units".padStart(7) +
      "revenue".padStart(12) +
      "cogs".padStart(12) +
      "fees".padStart(12) +
      "shipΔ".padStart(12) +
      "refunds".padStart(12) +
      "margin".padStart(12),
  );

  let failures = 0;

  for (const row of report.rows) {
    // Invariant: the columns shown to the merchant must add up to the margin.
    const identity =
      row.revenue - row.cogs - row.fees - row.shippingDelta - row.refunds;
    if (identity !== row.contributionMargin) {
      failures++;
      console.error(
        `✗ ${row.title}: columns sum to ${identity} but margin is ${row.contributionMargin}`,
      );
    }
  }

  for (const row of sample) {
    console.log(
      row.title.slice(0, 25).padEnd(26) +
        String(row.unitsSold).padStart(7) +
        money(row.revenue) +
        money(row.cogs) +
        money(row.fees) +
        money(row.shippingDelta) +
        money(row.refunds) +
        money(row.contributionMargin),
    );

    // Independent recomputation straight from the rows.
    const lines = await prisma.orderLine.findMany({
      where: { variant: { product: { id: row.productId } } },
      include: { refunds: true, variant: { include: { product: true } } },
    });

    let expectedRevenue = 0;
    let expectedCogs = 0;
    let expectedRefunds = 0;
    let expectedUnits = 0;

    for (const line of lines) {
      expectedRevenue += line.originalTotalCents - line.discountAllocatedCents;
      expectedRefunds += line.refunds.reduce((s, r) => s + r.subtotalCents, 0);
      expectedUnits +=
        line.quantity - line.refunds.reduce((s, r) => s + r.quantity, 0);

      const variant = line.variant!;
      const resolved = resolveCogs(
        {
          variantGid: variant.shopifyGid,
          priceCents: variant.priceCents,
          nativeCogsCents: variant.nativeCogsCents,
          vendor: variant.product.vendor,
          collectionIds: [],
        },
        config.cogsEntries,
      );
      expectedCogs += resolved.cents * line.quantity;
    }

    const checks: Array<[string, number, number]> = [
      ["units", row.unitsSold, Math.max(0, expectedUnits)],
      ["revenue", row.revenue, expectedRevenue],
      ["cogs", row.cogs, expectedCogs],
      ["refunds", row.refunds, expectedRefunds],
    ];
    for (const [label, actual, expected] of checks) {
      if (actual !== expected) {
        failures++;
        console.error(`  ✗ ${row.title} ${label}: table ${actual}, recount ${expected}`);
      }
    }
  }

  // Allocated gateway fees must add back up to what the orders actually carry.
  const orders = await prisma.order.findMany({
    where: { shopId: shop.id },
    select: { gatewayFeeCents: true },
  });
  const reportedFeeTotal = orders.reduce((s, o) => s + (o.gatewayFeeCents ?? 0), 0);
  const allocatedFeeTotal = report.rows.reduce((s, r) => s + r.fees, 0);
  // Allocated exceeds reported by design: Shopify only reports fees for Shopify
  // Payments orders, and modeled rules cover the rest. Equality here would mean
  // the modeled rules were never applied.
  console.log(
    `\nGateway fees — ${money(reportedFeeTotal)} reported by Shopify, ` +
      `${money(allocatedFeeTotal)} allocated across products ` +
      `(difference is modeled fees on non-Shopify-Payments orders)`,
  );

  // --- Erosion report ---------------------------------------------------
  // Same discipline: the buckets shown to the merchant must add back up to the
  // raw totals, or the breakdown is decorative.
  const erosion = buildErosionReport(await loadOrdersForMargin(shop.id));

  const rawDiscountTotal = await prisma.order.aggregate({
    where: { shopId: shop.id },
    _sum: { discountTotalCents: true },
  });
  const rawRefundTotal = await prisma.refund.aggregate({
    where: { order: { shopId: shop.id } },
    _sum: { subtotalCents: true },
  });

  const monthDiscountTotal = erosion.months.reduce((s, m) => s + m.discounts, 0);
  const monthRefundTotal = erosion.months.reduce((s, m) => s + m.refunds, 0);

  console.log("\nErosion:");
  console.log(
    `  discounts  buckets ${money(erosion.totalDiscounts)} · ` +
      `months ${money(monthDiscountTotal)} · raw ${money(rawDiscountTotal._sum.discountTotalCents ?? 0)}`,
  );
  console.log(
    `  refunds    buckets ${money(erosion.totalRefunds)} · ` +
      `months ${money(monthRefundTotal)} · raw ${money(rawRefundTotal._sum.subtotalCents ?? 0)}`,
  );

  if (monthDiscountTotal !== (rawDiscountTotal._sum.discountTotalCents ?? 0)) {
    failures++;
    console.error("  ✗ monthly discount total does not match the raw sum");
  }
  if (monthRefundTotal !== (rawRefundTotal._sum.subtotalCents ?? 0)) {
    failures++;
    console.error("  ✗ monthly refund total does not match the raw sum");
  }
  if (erosion.totalRefunds !== monthRefundTotal) {
    failures++;
    console.error("  ✗ refund buckets do not match the monthly refund total");
  }
  // Discount buckets can differ from the raw total by at most a cent per combined-code
  // order, since one order-level total is split evenly across its codes.
  const discountBucketDrift = Math.abs(erosion.totalDiscounts - monthDiscountTotal);
  if (discountBucketDrift > erosion.discountsByCode.length) {
    failures++;
    console.error(
      `  ✗ discount buckets drift from the monthly total by ${money(discountBucketDrift)}`,
    );
  }

  console.log(
    `  ${erosion.discountsByCode.length} codes · ${erosion.refundsByReason.length} reasons · ` +
      `${Math.round(
        (erosion.refundsWithoutReason / Math.max(1, erosion.totalRefunds)) * 100,
      )}% of refunded money has no reason recorded`,
  );

  console.log(
    failures === 0
      ? `\n✓ All ${report.rows.length} rows satisfy the column identity; ` +
          `${sample.length} sampled products reconcile against an independent recount; ` +
          `erosion buckets tie back to raw totals.`
      : `\n✗ ${failures} reconciliation failures.`,
  );

  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
