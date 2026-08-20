import prisma from "../db.server";
import type { CatalogEntry, ValidationSummary } from "./cogsImport";
import { importableRows } from "./cogsImport";

/** The catalog the importer matches against — variant gid plus SKU, nothing else. */
export async function loadCatalogForMatching(shopId: string): Promise<CatalogEntry[]> {
  const variants = await prisma.variant.findMany({
    where: { product: { shopId } },
    select: { shopifyGid: true, sku: true, priceCents: true },
  });
  return variants.map((v) => ({
    variantGid: v.shopifyGid,
    sku: v.sku,
    priceCents: v.priceCents,
  }));
}

/**
 * Writes the matched rows as variant-level entries — the top rung, so an imported
 * cost outranks every group estimate for that variant.
 *
 * Runs in one transaction: a merchant who uploads 900 costs should end up with all
 * 900 or none, never a half-applied file they can't reason about. Partial import
 * means bad *rows* are skipped, not that a crash leaves the ladder half-written.
 */
export async function commitCogsImport(shopId: string, summary: ValidationSummary) {
  const rows = importableRows(summary);
  if (rows.length === 0) return { written: 0 };

  await prisma.$transaction(
    rows.map((row) =>
      prisma.cogsEntry.upsert({
        where: {
          shopId_scope_scopeKey: { shopId, scope: "variant", scopeKey: row.variantGid },
        },
        update: { costCents: row.costCents, costPercent: null },
        create: {
          shopId,
          scope: "variant",
          scopeKey: row.variantGid,
          costCents: row.costCents,
          costPercent: null,
        },
      }),
    ),
  );

  return { written: rows.length };
}
