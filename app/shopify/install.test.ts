import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInstallBackfill, type InstallStore } from "./install";
import type { GraphqlClient } from "./adapter";

/**
 * Empty connections for both paths, so `backfillShop` completes without touching
 * Postgres — `runBackfill` only reaches the database once there are nodes to ingest.
 * That keeps these tests about the claim sequencing, which is the part that was easy
 * to get wrong.
 */
function emptyGraphql(): GraphqlClient {
  const page = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  return () =>
    Promise.resolve({
      json: () => Promise.resolve({ data: { products: page, orders: page } }),
    });
}

function throwingGraphql(message = "ACCESS_DENIED"): GraphqlClient {
  return () => Promise.reject(new Error(message));
}

/** In-memory stand-in for the Postgres claim. */
function fakeStore(alreadyClaimed = false) {
  const state = { claimed: alreadyClaimed, releases: 0 };
  const store: InstallStore = {
    claimBackfill: async () => {
      if (state.claimed) return false;
      state.claimed = true;
      return true;
    },
    releaseBackfill: async () => {
      state.claimed = false;
      state.releases++;
    },
  };
  return { store, state };
}

describe("runInstallBackfill", () => {
  it("backfills a shop that has never been backfilled", async () => {
    const { store } = fakeStore();
    const result = await runInstallBackfill(emptyGraphql(), "shop.myshopify.com", { store });

    expect(result.ran).toBe(true);
    if (result.ran) {
      expect(result.productsIngested).toBe(0);
      expect(result.ordersIngested).toBe(0);
    }
  });

  it("skips a shop that already has, so a token refresh doesn't re-pull 60 days", async () => {
    // afterAuth fires on every OAuth completion, not only on install.
    const { store } = fakeStore(true);
    const result = await runInstallBackfill(emptyGraphql(), "shop.myshopify.com", { store });

    expect(result).toEqual({ ran: false, reason: "already-backfilled" });
  });

  it("runs once across repeated auths", async () => {
    const { store } = fakeStore();
    const first = await runInstallBackfill(emptyGraphql(), "shop.myshopify.com", { store });
    const second = await runInstallBackfill(emptyGraphql(), "shop.myshopify.com", { store });

    expect(first.ran).toBe(true);
    expect(second.ran).toBe(false);
  });

  it("reports a failure instead of throwing, so OAuth still completes", async () => {
    // A backfill that throws through afterAuth would leave the merchant unable to
    // reach the app at all — including the page that would explain the problem.
    const { store } = fakeStore();
    const result = await runInstallBackfill(throwingGraphql(), "shop.myshopify.com", { store });

    expect(result.ran).toBe(false);
    if (!result.ran && result.reason === "failed") {
      expect((result.error as Error).message).toBe("ACCESS_DENIED");
    }
  });

  it("releases the claim on failure so a later auth retries", async () => {
    const { store, state } = fakeStore();
    await runInstallBackfill(throwingGraphql(), "shop.myshopify.com", { store });

    expect(state.releases).toBe(1);
    expect(state.claimed).toBe(false);

    // The retry is the whole point of releasing: webhooks only carry history
    // forward, so a shop stuck marked-as-done would never see its back catalogue.
    const retry = await runInstallBackfill(emptyGraphql(), "shop.myshopify.com", { store });
    expect(retry.ran).toBe(true);
  });

  it("keeps the claim after a successful run", async () => {
    const { store, state } = fakeStore();
    await runInstallBackfill(emptyGraphql(), "shop.myshopify.com", { store });

    expect(state.releases).toBe(0);
    expect(state.claimed).toBe(true);
  });
});

/**
 * The hook is configured in shopify.server.ts, which can't be imported here without
 * standing up the whole app. `backfillShop` sat uncalled for a long time; these
 * assertions fail if the wiring is removed again.
 */
const shopifyServerSource = readFileSync(new URL("../shopify.server.ts", import.meta.url), "utf8");

describe("install wiring", () => {
  it("calls the backfill from afterAuth", () => {
    expect(shopifyServerSource).toMatch(/afterAuth/);
    expect(shopifyServerSource).toMatch(/runInstallBackfill\(\s*admin\.graphql,\s*session\.shop/);
  });

  it("does not await the backfill, which would hold the install redirect open", () => {
    expect(shopifyServerSource).toMatch(/void runInstallBackfill\(/);
    expect(shopifyServerSource).not.toMatch(/await runInstallBackfill\(/);
  });
});
