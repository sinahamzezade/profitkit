import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleCustomerDataRequest, handleCustomerRedact } from "./gdpr";

describe("customer privacy webhooks", () => {
  it("reports that no personal data is held", () => {
    expect(handleCustomerDataRequest().storesPersonalData).toBe(false);
    expect(handleCustomerRedact().storesPersonalData).toBe(false);
  });

  it("explains what is stored instead of returning a bare acknowledgement", () => {
    const { note } = handleCustomerDataRequest();
    expect(note).toMatch(/order financials/i);
    expect(note).toMatch(/no customer name, email/i);
  });
});

/**
 * The privacy answers above are only true while the schema stays free of customer
 * identity. This asserts that directly against the Prisma schema, so adding an
 * email or customer id to a model fails here rather than quietly making the
 * webhook responses false.
 */
describe("schema holds no customer identity", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

  // The Session model is Shopify's own and legitimately stores the merchant's
  // details for auth; it is not customer data and is deleted on shop/redact.
  const domainSchema = schema.slice(schema.indexOf("model Shop"));

  it.each([
    ["customerId", /customerId/i],
    ["email", /\bemail\b/i],
    ["phone", /\bphone\b/i],
    ["address", /address/i],
    ["firstName", /firstName/i],
    ["lastName", /lastName/i],
  ])("has no %s field on any domain model", (_label, pattern) => {
    expect(domainSchema).not.toMatch(pattern);
  });

  it("cascades deletes from Shop so shop/redact really erases everything", () => {
    const cascades = domainSchema.match(/onDelete: Cascade/g) ?? [];
    expect(cascades.length).toBeGreaterThanOrEqual(6);
  });
});
