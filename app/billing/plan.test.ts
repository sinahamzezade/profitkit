import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BillingInterval } from "@shopify/shopify-api";
import { PRO_PLAN, PRO_PLAN_NAME } from "./plan";

/**
 * The billing config in shopify.server.ts has to be written as literals for the
 * library's discriminated union to resolve, so it can't import PRO_PLAN. That
 * makes silent drift possible: UI copy says $29 while Shopify charges something
 * else. These assertions read the real config and fail if the two disagree.
 */
const shopifyServerSource = readFileSync(
  new URL("../shopify.server.ts", import.meta.url),
  "utf8",
);

describe("Pro plan", () => {
  it("is the $29 wedge the positioning depends on", () => {
    expect(PRO_PLAN.amount).toBe(29);
    expect(PRO_PLAN.currencyCode).toBe("USD");
    expect(PRO_PLAN.interval).toBe(BillingInterval.Every30Days);
  });

  it("bills monthly with no trial — the free tier is the trial", () => {
    expect(PRO_PLAN.trialDays).toBe(0);
  });

  it("matches the amount actually registered with Shopify", () => {
    expect(shopifyServerSource).toMatch(new RegExp(`amount:\\s*${PRO_PLAN.amount}\\b`));
    expect(shopifyServerSource).toMatch(
      new RegExp(`currencyCode:\\s*"${PRO_PLAN.currencyCode}"`),
    );
  });

  it("matches the plan name the tier check looks up", () => {
    expect(PRO_PLAN_NAME).toBe("Pro");
    expect(shopifyServerSource).toMatch(new RegExp(`\\b${PRO_PLAN_NAME}:\\s*\\{`));
  });

  it("is registered as a recurring plan, not a one-time charge", () => {
    expect(shopifyServerSource).toContain("BillingInterval.Every30Days");
    expect(shopifyServerSource).toContain("lineItems");
  });
});
