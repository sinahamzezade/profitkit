import prisma from "../db.server";
import type { CogsEntry, CogsScope, FeeRule, ShippingCostConfig } from "./types";

/** Gateway name reserved for the per-order shipping cost estimate, which has no gateway of its own. */
const SHIPPING_COST_PSEUDO_GATEWAY = "__shipping_cost__";

export async function loadCogsEntries(shopId: string): Promise<CogsEntry[]> {
  const rows = await prisma.cogsEntry.findMany({ where: { shopId } });
  return rows.map((r) => ({
    scope: r.scope as CogsScope,
    // Global rows store "" rather than NULL: Postgres treats NULLs as distinct in a
    // unique index, so a nullable scopeKey would let duplicate globals accumulate.
    scopeKey: r.scopeKey === "" ? null : r.scopeKey,
    costCents: r.costCents,
    costPercent: r.costPercent,
  }));
}

export async function loadFeeRules(shopId: string): Promise<FeeRule[]> {
  const rows = await prisma.feeRule.findMany({ where: { shopId } });
  return rows
    .filter((r) => r.gatewayName !== SHIPPING_COST_PSEUDO_GATEWAY)
    .map((r) => ({ gatewayName: r.gatewayName, percent: r.percent, flatCents: r.flatCents }));
}

/**
 * Shipping cost has no natural home in the schema yet — it's a single per-order
 * number, not a per-gateway rule. Parking it in fee_rules under a reserved name
 * keeps Day 4 from growing a migration; it wants its own settings row once the
 * ladder gains per-variant weights.
 */
export async function loadShippingCostConfig(shopId: string): Promise<ShippingCostConfig> {
  const row = await prisma.feeRule.findUnique({
    where: { shopId_gatewayName: { shopId, gatewayName: SHIPPING_COST_PSEUDO_GATEWAY } },
  });
  return { globalPerOrderCents: row?.flatCents ?? null };
}

export async function setGlobalCogsPercent(shopId: string, percent: number) {
  return prisma.cogsEntry.upsert({
    where: { shopId_scope_scopeKey: { shopId, scope: "global", scopeKey: "" } },
    update: { costPercent: percent, costCents: null },
    create: { shopId, scope: "global", scopeKey: "", costPercent: percent, costCents: null },
  });
}

export async function setVendorCogsPercent(shopId: string, vendor: string, percent: number) {
  return prisma.cogsEntry.upsert({
    where: { shopId_scope_scopeKey: { shopId, scope: "vendor", scopeKey: vendor } },
    update: { costPercent: percent, costCents: null },
    create: { shopId, scope: "vendor", scopeKey: vendor, costPercent: percent, costCents: null },
  });
}

/**
 * Drops a group-level override so the products under it fall back to the global
 * estimate. Deleting is the only way back down the ladder — setting a vendor to the
 * same number as the global estimate looks identical in the report but keeps
 * claiming to be a deliberate per-vendor decision.
 */
export async function clearVendorCogs(shopId: string, vendor: string) {
  return prisma.cogsEntry.deleteMany({
    where: { shopId, scope: "vendor", scopeKey: vendor },
  });
}

export async function setVariantCogsCents(shopId: string, variantGid: string, cents: number) {
  return prisma.cogsEntry.upsert({
    where: { shopId_scope_scopeKey: { shopId, scope: "variant", scopeKey: variantGid } },
    update: { costCents: cents, costPercent: null },
    create: { shopId, scope: "variant", scopeKey: variantGid, costCents: cents, costPercent: null },
  });
}

export async function setFeeRule(
  shopId: string,
  gatewayName: string,
  percent: number,
  flatCents: number,
) {
  return prisma.feeRule.upsert({
    where: { shopId_gatewayName: { shopId, gatewayName } },
    update: { percent, flatCents },
    create: { shopId, gatewayName, percent, flatCents },
  });
}

export async function setGlobalShippingCostCents(shopId: string, cents: number) {
  return prisma.feeRule.upsert({
    where: { shopId_gatewayName: { shopId, gatewayName: SHIPPING_COST_PSEUDO_GATEWAY } },
    update: { percent: 0, flatCents: cents },
    create: { shopId, gatewayName: SHIPPING_COST_PSEUDO_GATEWAY, percent: 0, flatCents: cents },
  });
}

/**
 * Gateways this shop has actually taken money through, and how many of their orders
 * arrived without a fee from Shopify.
 *
 * Offering a free-text gateway field would be a trap: the name has to match what
 * Shopify sends (`shopify_payments`, `cod`, …) or the rule silently never applies.
 * Reading them from the orders means a merchant picks from their own data.
 *
 * `ordersMissingFee` is counted rather than inferred from a sum, because the fee is
 * resolved per order: `resolveFee` prefers a reported fee and only falls back to a
 * rule for the orders that have none. Shopify Payments reports fees, but not until a
 * payout settles — so even there a rule is a useful fallback, not a redundancy.
 */
export async function listGateways(
  shopId: string,
): Promise<Array<{ gateway: string; orders: number; ordersMissingFee: number }>> {
  const [totals, missing] = await Promise.all([
    prisma.order.groupBy({
      by: ["gatewayName"],
      where: { shopId, gatewayName: { not: null } },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ["gatewayName"],
      where: { shopId, gatewayName: { not: null }, gatewayFeeCents: null },
      _count: { _all: true },
    }),
  ]);

  const missingByGateway = new Map(
    missing.map((row) => [row.gatewayName as string, row._count._all]),
  );

  return totals
    .map((row) => ({
      gateway: row.gatewayName as string,
      orders: row._count._all,
      ordersMissingFee: missingByGateway.get(row.gatewayName as string) ?? 0,
    }))
    .sort((a, b) => b.orders - a.orders);
}

/** Vendors present in the catalog, most products first. */
export async function listVendors(
  shopId: string,
): Promise<Array<{ vendor: string; products: number }>> {
  const rows = await prisma.product.groupBy({
    by: ["vendor"],
    where: { shopId, vendor: { not: null } },
    _count: { _all: true },
  });

  return rows
    .filter((row) => (row.vendor ?? "").trim() !== "")
    .map((row) => ({ vendor: row.vendor as string, products: row._count._all }))
    .sort((a, b) => b.products - a.products);
}

/** Removes a modelled fee rule, falling the gateway back to reporting nothing. */
export async function clearFeeRule(shopId: string, gatewayName: string) {
  return prisma.feeRule.deleteMany({ where: { shopId, gatewayName } });
}
