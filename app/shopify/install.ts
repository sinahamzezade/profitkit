import prisma from "../db.server";
import { upsertShop } from "../ingestion/upsert";
import type { GraphqlClient } from "./adapter";
import { backfillShop } from "./backfill";

/**
 * Install-time ingestion.
 *
 * `backfillShop` existed and was tested for a long time with no caller, which meant
 * a merchant installed the app and saw an empty dashboard until an order happened to
 * fire a webhook. This is the caller.
 *
 * Two things make it more than a function call. `afterAuth` fires on every OAuth
 * completion — token refresh, scope change, re-install — so the work has to be
 * claimed once per shop rather than repeated. And it must never break the install:
 * if the backfill throws, OAuth still has to complete, or the merchant cannot get
 * into the app at all to find out why.
 */

/** The persistence the claim needs, injected so the sequencing is testable. */
export interface InstallStore {
  /** True if this call won the right to backfill; false if it's already claimed. */
  claimBackfill(shopDomain: string): Promise<boolean>;
  /** Hands the claim back so a later auth retries. */
  releaseBackfill(shopDomain: string): Promise<void>;
}

export const prismaInstallStore: InstallStore = {
  async claimBackfill(shopDomain) {
    const shop = await upsertShop(shopDomain);
    // Conditional update rather than read-then-write: two concurrent auths would
    // both pass a `backfilledAt == null` check and both pull the whole window.
    // Postgres settles it here, and `count` says who won.
    const claimed = await prisma.shop.updateMany({
      where: { id: shop.id, backfilledAt: null },
      data: { backfilledAt: new Date() },
    });
    return claimed.count === 1;
  },

  async releaseBackfill(shopDomain) {
    await prisma.shop.updateMany({
      where: { domain: shopDomain },
      data: { backfilledAt: null },
    });
  },
};

/**
 * Fire-and-forget entry point, used by both triggers.
 *
 * Not awaited anywhere: the backfill pulls 60 days of orders across paginated
 * requests, and holding either the OAuth redirect or a page render open for that
 * long would look like a hang. `runInstallBackfill` never throws, so this cannot
 * become an unhandled rejection; the `.catch` guards anything thrown before its own
 * try block.
 */
export function startInstallBackfill(graphql: GraphqlClient, shopDomain: string): void {
  void runInstallBackfill(graphql, shopDomain)
    .then((result) => {
      if (result.ran) {
        console.log(
          `[install] backfilled ${shopDomain}: ${result.productsIngested} products, ` +
            `${result.ordersIngested} orders since ${result.windowStart.toISOString()}`,
        );
      } else if (result.reason === "failed") {
        console.error(`[install] backfill failed for ${shopDomain}:`, result.error);
      }
    })
    .catch((error) => {
      console.error(`[install] backfill crashed for ${shopDomain}:`, error);
    });
}

export type InstallResult =
  | { ran: false; reason: "already-backfilled" }
  | { ran: false; reason: "failed"; error: unknown }
  | { ran: true; productsIngested: number; ordersIngested: number; windowStart: Date };

/**
 * Backfills a shop unless it already has been. Never throws: a failure is returned,
 * having released the claim, so the caller can log it and let the install proceed.
 */
export async function runInstallBackfill(
  graphql: GraphqlClient,
  shopDomain: string,
  options: { store?: InstallStore; now?: Date } = {},
): Promise<InstallResult> {
  const store = options.store ?? prismaInstallStore;

  if (!(await store.claimBackfill(shopDomain))) {
    return { ran: false, reason: "already-backfilled" };
  }

  try {
    const result = await backfillShop(graphql, shopDomain, options.now ?? new Date());
    return { ran: true, ...result };
  } catch (error) {
    // Releasing matters more than reporting: a shop left marked as backfilled after
    // a failure would never try again, and webhooks only carry history forward.
    await store.releaseBackfill(shopDomain).catch(() => {});
    return { ran: false, reason: "failed", error };
  }
}
