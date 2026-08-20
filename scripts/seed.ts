import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createRng } from "../app/seed/rng";
import { generateCatalog } from "../app/seed/catalog";
import { generateOrders } from "../app/seed/orders";
import { mapOrderToDomainInputs } from "../app/seed/toDomain";
import { calculateOrderMargin } from "../app/margin/calculate";

const SEED = 42;
const rng = createRng(SEED);

const catalog = generateCatalog(rng, 62, 8);
const { rawOrders, groundTruth } = generateOrders(rng, catalog, 500, 90);

// Aggregate contribution margin per product across every order it appears in.
const marginByProduct = new Map<string, number>();
const revenueByProduct = new Map<string, number>();
const occurrencesByProduct = new Map<string, number>();

rawOrders.forEach((rawOrder, i) => {
  const gt = groundTruth[i];
  const { lines, order } = mapOrderToDomainInputs(rawOrder, gt);
  const results = calculateOrderMargin(lines, order);
  const productByLineId = new Map(gt.lines.map((l) => [l.lineItemId, l.productId]));

  for (const result of results) {
    const productId = productByLineId.get(result.lineItemId);
    if (!productId) continue;
    marginByProduct.set(
      productId,
      (marginByProduct.get(productId) ?? 0) + result.contributionMargin,
    );
    revenueByProduct.set(
      productId,
      (revenueByProduct.get(productId) ?? 0) + result.revenue,
    );
    occurrencesByProduct.set(productId, (occurrencesByProduct.get(productId) ?? 0) + 1);
  }
});

const productById = new Map(catalog.map((p) => [p.id, p]));
const ranked = [...marginByProduct.entries()]
  .map(([productId, margin]) => ({
    product: productById.get(productId)!,
    margin,
    revenue: revenueByProduct.get(productId) ?? 0,
  }))
  .sort((a, b) => a.margin - b.margin);

const negativeMargin = ranked.filter((r) => r.margin < 0);
const plantedLosers = catalog.filter((p) => p.isPlantedLoser);
const detectedLoserIds = new Set(negativeMargin.map((r) => r.product.id));
const missedPlantedLosers = plantedLosers.filter((p) => !detectedLoserIds.has(p.id));

console.log(`Catalog: ${catalog.length} products, ${plantedLosers.length} planted losers`);
console.log(`Orders: ${rawOrders.length}`);
console.log(`Products with negative contribution margin: ${negativeMargin.length}\n`);

console.log("Worst 10 by contribution margin:");
for (const r of ranked.slice(0, 10)) {
  const flag = r.product.isPlantedLoser ? `PLANTED (${r.product.lossDriver})` : "organic";
  console.log(
    `  ${(r.margin / 100).toFixed(2).padStart(9)}  ${r.product.variant.sku}  ${r.product.title.padEnd(28)} ${flag}`,
  );
}

console.log("\nAll planted losers (by sku, unambiguous even when titles collide):");
for (const p of plantedLosers) {
  const r = ranked.find((x) => x.product.id === p.id)!;
  const rank = ranked.indexOf(r) + 1;
  const occurrences = occurrencesByProduct.get(p.id) ?? 0;
  console.log(
    `  ${p.variant.sku}  ${(r.margin / 100).toFixed(2).padStart(9)}  rank ${rank}/${ranked.length}  n=${occurrences}  (${p.lossDriver})  ${p.title}`,
  );
}

console.log();
if (missedPlantedLosers.length === 0) {
  console.log(`✓ All ${plantedLosers.length} planted losers came back with negative margin.`);
} else {
  console.log(
    `✗ ${missedPlantedLosers.length} planted losers were NOT detected: ${missedPlantedLosers
      .map((p) => p.title)
      .join(", ")}`,
  );
}

const outPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../app/seed/fixtures/seed-dataset.json",
);
writeFileSync(
  outPath,
  JSON.stringify({ catalog, rawOrders, groundTruth }, null, 2),
);
console.log(`\nWrote fixture: ${outPath}`);

if (missedPlantedLosers.length > 0) {
  process.exit(1);
}
