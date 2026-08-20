import prisma from "../db.server";
import type {
  RawOrderNode,
  RawProductNode,
  RawRefundNode,
  RawVariantNode,
} from "./types";

function toCents(amount: string): number {
  return Math.round(parseFloat(amount) * 100);
}

export async function upsertShop(domain: string) {
  return prisma.shop.upsert({
    where: { domain },
    update: {},
    create: { domain },
  });
}

export async function upsertProduct(shopId: string, product: RawProductNode) {
  const row = await prisma.product.upsert({
    where: { shopId_shopifyGid: { shopId, shopifyGid: product.id } },
    update: { title: product.title, vendor: product.vendor },
    create: {
      shopId,
      shopifyGid: product.id,
      title: product.title,
      vendor: product.vendor,
    },
  });

  for (const variant of product.variants) {
    await upsertVariant(row.id, variant);
  }

  return row;
}

async function upsertVariant(productId: string, variant: RawVariantNode) {
  const priceCents = toCents(variant.price);
  const nativeCogsCents = variant.nativeCogsCents ?? null;
  return prisma.variant.upsert({
    where: { productId_shopifyGid: { productId, shopifyGid: variant.id } },
    update: { sku: variant.sku, priceCents, nativeCogsCents },
    create: {
      productId,
      shopifyGid: variant.id,
      sku: variant.sku,
      priceCents,
      nativeCogsCents,
    },
  });
}

/**
 * Orders can arrive referencing a variant the catalog backfill hasn't seen yet
 * (webhooks don't guarantee ordering) — create a minimal placeholder so ingestion
 * never fails on a missing FK, and let the real product/variant upsert enrich it later.
 */
async function findOrCreatePlaceholderVariant(shopId: string, variantGid: string, priceCents: number) {
  const existing = await prisma.variant.findFirst({ where: { shopifyGid: variantGid, product: { shopId } } });
  if (existing) return existing;

  const placeholderProduct = await prisma.product.upsert({
    where: { shopId_shopifyGid: { shopId, shopifyGid: `placeholder:${variantGid}` } },
    update: {},
    create: { shopId, shopifyGid: `placeholder:${variantGid}`, title: "(unresolved product)", vendor: null },
  });

  return prisma.variant.upsert({
    where: { productId_shopifyGid: { productId: placeholderProduct.id, shopifyGid: variantGid } },
    update: {},
    create: { productId: placeholderProduct.id, shopifyGid: variantGid, sku: null, priceCents },
  });
}

export async function upsertOrder(shopId: string, order: RawOrderNode) {
  const shippingChargedCents = toCents(order.totalShippingPriceSet.shopMoney.amount);
  const discountTotalCents = toCents(order.currentTotalDiscountsSet.shopMoney.amount);

  const paymentTransaction = order.transactions.find((t) => t.fees.length > 0);
  const gatewayName = order.transactions[0]?.gateway ?? null;
  const gatewayFeeCents = paymentTransaction
    ? paymentTransaction.fees.reduce((sum, f) => sum + toCents(f.amount.amount), 0)
    : null;

  const discountCodes = (order.discountApplications?.nodes ?? [])
    .map((application) => application.code)
    .filter((code): code is string => typeof code === "string" && code.trim() !== "");

  const orderRow = await prisma.order.upsert({
    where: { shopId_shopifyGid: { shopId, shopifyGid: order.id } },
    update: {
      name: order.name,
      currencyCode: order.currencyCode,
      test: order.test,
      shippingChargedCents,
      discountTotalCents,
      discountCodes,
      gatewayName,
      gatewayFeeCents,
    },
    create: {
      shopId,
      shopifyGid: order.id,
      name: order.name,
      currencyCode: order.currencyCode,
      test: order.test,
      createdAtShopify: new Date(order.createdAt),
      shippingChargedCents,
      discountTotalCents,
      discountCodes,
      gatewayName,
      gatewayFeeCents,
    },
  });

  for (const line of order.lineItems.nodes) {
    const originalTotalCents = toCents(line.originalTotalSet.shopMoney.amount);
    const discountAllocatedCents = line.discountAllocations.reduce(
      (sum, a) => sum + toCents(a.allocatedAmountSet.shopMoney.amount),
      0,
    );

    let variantId: string | null = null;
    if (line.variant) {
      const variant = await findOrCreatePlaceholderVariant(
        shopId,
        line.variant.id,
        toCents(line.variant.price),
      );
      variantId = variant.id;
    }

    await prisma.orderLine.upsert({
      where: { orderId_shopifyGid: { orderId: orderRow.id, shopifyGid: line.id } },
      update: {
        title: line.title,
        sku: line.sku,
        quantity: line.quantity,
        originalTotalCents,
        discountAllocatedCents,
        variantId,
      },
      create: {
        orderId: orderRow.id,
        shopifyGid: line.id,
        variantId,
        title: line.title,
        sku: line.sku,
        quantity: line.quantity,
        originalTotalCents,
        discountAllocatedCents,
      },
    });
  }

  for (const refund of order.refunds) {
    await applyRefund(orderRow.id, refund);
  }

  return orderRow;
}

/** Standalone path for a `refunds/create` webhook, which arrives without the full order. */
export async function applyRefund(orderId: string, refund: RawRefundNode) {
  // Reasons live on the Return, keyed by line item, and only exist when the refund
  // went through the Returns flow at all.
  const reasonByLineItemGid = new Map<string, string>();
  for (const returnLine of refund.return?.returnLineItems.nodes ?? []) {
    const lineGid = returnLine.fulfillmentLineItem?.lineItem.id;
    const reason =
      returnLine.returnReasonDefinition?.name ?? returnLine.returnReasonNote ?? null;
    if (lineGid && reason) reasonByLineItemGid.set(lineGid, reason);
  }

  for (const item of refund.refundLineItems.nodes) {
    const orderLine = await prisma.orderLine.findFirst({
      where: { orderId, shopifyGid: item.lineItem.id },
    });
    if (!orderLine) continue; // line not ingested yet — nothing to attach the refund to

    const fields = {
      quantity: item.quantity,
      subtotalCents: toCents(item.subtotalSet.shopMoney.amount),
      refundedAt: new Date(refund.createdAt),
      reason: reasonByLineItemGid.get(item.lineItem.id) ?? null,
      note: refund.note ?? null,
    };

    await prisma.refund.upsert({
      where: {
        orderLineId_shopifyRefundGid: { orderLineId: orderLine.id, shopifyRefundGid: refund.id },
      },
      update: fields,
      create: {
        orderId,
        orderLineId: orderLine.id,
        shopifyRefundGid: refund.id,
        ...fields,
      },
    });
  }
}
