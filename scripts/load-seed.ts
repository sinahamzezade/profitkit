import prisma from "../app/db.server";
import { createRng } from "../app/seed/rng";
import { generateCatalog } from "../app/seed/catalog";
import { generateOrders } from "../app/seed/orders";
import { runBackfill } from "../app/ingestion/backfill";
import { loadShopCostConfig, mapDbOrderToDomainInputs } from "../app/ingestion/dbToDomain";
import { calculateOrderMargin } from "../app/margin/calculate";
import {
  setFeeRule,
  setGlobalCogsPercent,
  setGlobalShippingCostCents,
  setVendorCogsPercent,
} from "../app/costs/repository";
import type { RawOrderNode, RawProductNode } from "../app/ingestion/types";

/**
 * Defaults to a synthetic domain so seeded data never silently mingles with a real
 * store's. Pass a domain to load it under an actual dev store instead:
 *   npm run load-seed -- first-test-zenmt2u1.myshopify.com
 */
const SHOP_DOMAIN = process.argv[2] ?? "seed-dev-store.myshopify.com";
const SEED = 42;

async function tableCounts() {
  const [shops, products, variants, orders, orderLines, refunds] = await Promise.all([
    prisma.shop.count(),
    prisma.product.count(),
    prisma.variant.count(),
    prisma.order.count(),
    prisma.orderLine.count(),
    prisma.refund.count(),
  ]);
  return { shops, products, variants, orders, orderLines, refunds };
}

async function main() {
  const rng = createRng(SEED);
  const catalog = generateCatalog(rng, 62, 8);
  const { rawOrders } = generateOrders(rng, catalog, 500, 90);

  const products: RawProductNode[] = catalog.map((p) => ({
    id: p.id,
    title: p.title,
    vendor: p.vendor,
    imageUrl: null,
    variants: [
      {
        id: p.variant.id,
        sku: p.variant.sku,
        price: (p.variant.price / 100).toFixed(2),
        nativeCogsCents: p.variant.nativeCogs,
      },
    ],
  }));
  const orders = rawOrders as unknown as RawOrderNode[];

  console.log("First backfill run...");
  console.log(await runBackfill(SHOP_DOMAIN, { products, orders }));
  const countsAfterFirst = await tableCounts();
  console.log("Row counts:", countsAfterFirst);

  console.log("\nReplaying the identical payload (should be a no-op)...");
  console.log(await runBackfill(SHOP_DOMAIN, { products, orders }));
  const countsAfterSecond = await tableCounts();
  console.log("Row counts:", countsAfterSecond);

  const unchanged = JSON.stringify(countsAfterFirst) === JSON.stringify(countsAfterSecond);
  console.log(
    unchanged
      ? "\n✓ Replay was a no-op — idempotency holds."
      : "\n✗ Replay changed row counts — idempotency broken.",
  );

  // Margin computed off Postgres, not off the in-memory seed objects.
  const shop = await prisma.shop.findUniqueOrThrow({ where: { domain: SHOP_DOMAIN } });
  const dbOrders = await prisma.order.findMany({
    where: { shopId: shop.id },
    select: { id: true },
  });

  // Cost config persists between runs, so without this the "before any cost data"
  // stage below would silently report last run's ladder and every stage would
  // print the same numbers. Demo script against the seeded shop only.
  const cleared = await prisma.$transaction([
    prisma.cogsEntry.deleteMany({ where: { shopId: shop.id } }),
    prisma.feeRule.deleteMany({ where: { shopId: shop.id } }),
  ]);
  console.log(
    `\nReset cost config for ${SHOP_DOMAIN}: ` +
      `${cleared[0].count} COGS entries, ${cleared[1].count} fee rules removed.`,
  );

  async function rankProductsByMargin() {
    const config = await loadShopCostConfig(shop.id);
    const marginByProductId = new Map<string, number>();
    let estimatedLines = 0;
    let totalLines = 0;

    for (const { id: orderId } of dbOrders) {
      const { lines, order } = await mapDbOrderToDomainInputs(orderId, config);
      const results = calculateOrderMargin(lines, order);

      const dbLines = await prisma.orderLine.findMany({
        where: { orderId },
        select: { shopifyGid: true, variant: { select: { product: { select: { id: true } } } } },
      });
      const productByLineGid = new Map(dbLines.map((l) => [l.shopifyGid, l.variant?.product.id]));

      for (const r of results) {
        totalLines++;
        if (r.estimated) estimatedLines++;
        const productId = productByLineGid.get(r.lineItemId);
        if (!productId) continue;
        marginByProductId.set(
          productId,
          (marginByProductId.get(productId) ?? 0) + r.contributionMargin,
        );
      }
    }

    const productRows = await prisma.product.findMany({
      where: { id: { in: [...marginByProductId.keys()] } },
      select: { id: true, title: true },
    });
    const titleById = new Map(productRows.map((p) => [p.id, p.title]));

    const ranked = [...marginByProductId.entries()]
      .map(([productId, margin]) => ({ productId, margin, title: titleById.get(productId) ?? "?" }))
      .sort((a, b) => a.margin - b.margin);

    return { ranked, estimatedLines, totalLines };
  }

  function report(label: string, result: Awaited<ReturnType<typeof rankProductsByMargin>>) {
    const negative = result.ranked.filter((r) => r.margin < 0).length;
    console.log(`\n${label}`);
    console.log(
      `  ${negative} products with negative margin · ` +
        `${result.estimatedLines}/${result.totalLines} lines carry an estimated figure`,
    );
    for (const r of result.ranked.slice(0, 5)) {
      console.log(`  ${(r.margin / 100).toFixed(2).padStart(10)}  ${r.title}`);
    }
  }

  report("Before any cost data — the ladder is empty:", await rankProductsByMargin());

  // Rung 1: one global percentage, the sub-60-second path to a first insight.
  await setGlobalCogsPercent(shop.id, 0.45);
  await setGlobalShippingCostCents(shop.id, 650);
  await setFeeRule(shop.id, "manual", 0.029, 30);
  await setFeeRule(shop.id, "cod", 0.02, 200);
  await setFeeRule(shop.id, "bank_transfer", 0.01, 100);
  report("After rung 1 (global 45% COGS estimate, $6.50 shipping, modeled fees):", await rankProductsByMargin());

  // Rung 2: a vendor override outranks the global estimate for that vendor's products.
  const topVendor = await prisma.product.groupBy({
    by: ["vendor"],
    where: { shopId: shop.id, vendor: { not: null } },
    _count: { vendor: true },
    orderBy: { _count: { vendor: "desc" } },
    take: 1,
  });
  const vendorName = topVendor[0]?.vendor;
  if (vendorName) {
    await setVendorCogsPercent(shop.id, vendorName, 0.75);
    report(`After rung 2 (${vendorName} overridden to 75% COGS):`, await rankProductsByMargin());
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
