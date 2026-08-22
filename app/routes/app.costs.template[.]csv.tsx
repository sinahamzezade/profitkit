import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { toCsv } from "../import/csv";
import { MAX_ROWS, TEMPLATE_HEADERS } from "../import/request";

/**
 * A cost sheet pre-filled with this store's own products.
 *
 * Not a blank example. Every variant is already listed with its SKU, its variant id
 * and its title, so the merchant fills one column and uploads — no looking up SKUs,
 * no guessing at a format, and no column mapping to correct, because the headers are
 * the exact names `suggestColumnMapping` recognises:
 *
 *   sku        -> matched exactly by SKU_HINTS
 *   variant_id -> normalises to "variantid", matched by VARIANT_ID_HINTS
 *   cost       -> matched exactly by COST_HINTS
 *   product    -> matches no hint, so it is ignored by the importer
 *
 * `product` exists only for the human filling it in; the importer never matches on a
 * title, because titles repeat and a wrong match writes a wrong cost silently.
 *
 * Both identifier columns are included on purpose. A variant with no SKU cannot be
 * matched by SKU at all, and without its id those rows would come back as errors the
 * merchant could do nothing about.
 *
 * Rows with the cost left blank come back as "missing cost" rather than importing as
 * zero. That is the honest outcome — a blank is not a claim that something is free —
 * so the screen tells merchants to delete the rows they cannot fill.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return new Response("No data for this store yet.", { status: 404 });

  const variants = await prisma.variant.findMany({
    where: { product: { shopId: shop.id } },
    select: {
      shopifyGid: true,
      sku: true,
      product: { select: { title: true } },
    },
    orderBy: [{ product: { title: "asc" } }, { sku: "asc" }],
    // Capped at the same limit the importer accepts, so the file this hands out can
    // always be handed straight back.
    take: MAX_ROWS,
  });

  const csv = toCsv(
    [...TEMPLATE_HEADERS],
    variants.map((variant) => [
      variant.sku ?? "",
      variant.shopifyGid,
      variant.product.title,
      "",
    ]),
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="redline-cost-template.csv"',
      // The file reflects the catalogue at the moment of download; a stale copy from
      // a cache would be missing products added since.
      "Cache-Control": "no-store",
    },
  });
};
