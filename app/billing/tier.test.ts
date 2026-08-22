import { afterEach, describe, expect, it } from "vitest";
import { resolveActiveSubscription, resolveTierForShop } from "./tier";

const originalNodeEnv = process.env.NODE_ENV;
const originalOverride = process.env.REDLINE_FORCE_TIER;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalOverride === undefined) delete process.env.REDLINE_FORCE_TIER;
  else process.env.REDLINE_FORCE_TIER = originalOverride;
});

describe("resolveTierForShop", () => {
  it("defaults every shop to free until billing exists", async () => {
    delete process.env.REDLINE_FORCE_TIER;
    await expect(resolveTierForShop("shop.myshopify.com")).resolves.toBe("free");
  });

  it("honours the development override", async () => {
    process.env.NODE_ENV = "development";
    process.env.REDLINE_FORCE_TIER = "pro";
    await expect(resolveTierForShop("shop.myshopify.com")).resolves.toBe("pro");
  });

  it("refuses to grant Pro from an env var in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.REDLINE_FORCE_TIER = "pro";
    await expect(resolveTierForShop("shop.myshopify.com")).resolves.toBe("free");
  });
});

describe("resolveActiveSubscription", () => {
  it("returns null when nothing is paying, so no cancel control is offered", async () => {
    const billing = {
      check: async () => ({ hasActivePayment: false, appSubscriptions: [] }),
    };
    await expect(resolveActiveSubscription(billing)).resolves.toBeNull();
  });

  it("returns the subscription id, which is the only handle cancel has", async () => {
    const billing = {
      check: async () => ({
        hasActivePayment: true,
        appSubscriptions: [{ id: "gid://shopify/AppSubscription/1" }],
      }),
    };
    await expect(resolveActiveSubscription(billing)).resolves.toEqual({
      id: "gid://shopify/AppSubscription/1",
    });
  });

  it("returns null when the check throws, rather than a control that cannot work", async () => {
    const billing = {
      check: async () => {
        throw new Error("billing is down");
      },
    };
    await expect(resolveActiveSubscription(billing)).resolves.toBeNull();
  });

  it("returns null when payment is active but Shopify names no subscription", async () => {
    // Defensive: `appSubscriptions` is optional on the interface, and reading [0]
    // off an absent array would throw inside a path whose whole job is to degrade
    // quietly. A one-off purchase with no subscription lands here too.
    const billing = { check: async () => ({ hasActivePayment: true }) };
    await expect(resolveActiveSubscription(billing)).resolves.toBeNull();
  });
});
