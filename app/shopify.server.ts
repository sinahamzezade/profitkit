import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BillingInterval } from "@shopify/shopify-api";
import { startInstallBackfill } from "./shopify/install";

const shopify = shopifyApp({
  // Written out literally rather than spread from PRO_PLAN: the billing config is a
  // discriminated union keyed on `interval`, and a widened/readonly object makes
  // TypeScript pick the one-time variant. The values are asserted against PRO_PLAN
  // in app/billing/plan.test.ts so the two can't drift apart silently.
  // Recurring plans use the line-item shape; a flat `amount`/`interval` object is
  // the one-time variant and silently fails to type-check against Every30Days.
  // Values are asserted against PRO_PLAN in app/billing/plan.test.ts so the
  // constant used in UI copy can't drift from what Shopify actually charges.
  billing: {
    Pro: {
      lineItems: [
        {
          amount: 29,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // The fast path, not the only one. This fires on the OAuth authorization-code
      // flow, but an embedded app mints most of its sessions through token exchange,
      // which never runs afterAuth — so app/routes/app.tsx also calls this on load.
      // Both go through the same atomic claim, so whichever arrives first wins and
      // the other does nothing.
      //
      // Webhook subscriptions are declared in shopify.app.profitkit.toml and
      // registered by `shopify app deploy`. That makes them app-specific, so
      // `registerWebhooks` — which exists for shop-specific subscriptions — would
      // add nothing here.
      startInstallBackfill(admin.graphql, session.shop);
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
