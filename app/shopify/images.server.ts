import prisma from "../db.server";
import { fetchProductImageUrls, type GraphqlClient } from "./adapter";

/**
 * Fill featured-image URLs for the rows the dashboard actually draws.
 *
 * `imageUrl` is a new column. The dev server caches Prisma on `globalThis`, so a
 * process that booted before the generate still rejects `select: { imageUrl }`
 * even though the migration is applied. Fall back to id + GID, then Shopify;
 * a missing field must not 500 the page.
 */
export async function hydrateProductImages(
  graphql: GraphqlClient,
  shopId: string,
  productIds: string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(productIds)];
  const result = new Map<string, string | null>();
  if (unique.length === 0) return result;

  const rows = await loadImageRows(shopId, unique);
  for (const row of rows) result.set(row.id, row.imageUrl ?? null);

  const missing = rows.filter((row) => !row.imageUrl);
  if (missing.length === 0) return result;

  let urls: Map<string, string>;
  try {
    urls = await fetchProductImageUrls(
      graphql,
      missing.map((row) => row.shopifyGid),
    );
  } catch {
    return result;
  }

  await Promise.all(
    missing.map(async (row) => {
      const url = urls.get(row.shopifyGid);
      if (!url) return;
      result.set(row.id, url);
      try {
        await prisma.product.update({
          where: { id: row.id },
          data: { imageUrl: url },
        });
      } catch {
        // Stale client or missing column. The URL is already on the page.
      }
    }),
  );

  return result;
}

type ImageRow = { id: string; shopifyGid: string; imageUrl?: string | null };

async function loadImageRows(
  shopId: string,
  ids: string[],
): Promise<ImageRow[]> {
  const where = { shopId, id: { in: ids } };
  try {
    return await prisma.product.findMany({
      where,
      select: { id: true, shopifyGid: true, imageUrl: true },
    });
  } catch (error) {
    if (!isUnknownImageUrl(error)) throw error;
    return prisma.product.findMany({
      where,
      select: { id: true, shopifyGid: true },
    });
  }
}

function isUnknownImageUrl(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Unknown field `imageUrl`")
  );
}
