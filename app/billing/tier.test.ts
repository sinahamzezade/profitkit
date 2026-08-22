import { afterEach, describe, expect, it } from "vitest";
import { resolveTierForShop } from "./tier";

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
