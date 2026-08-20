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
