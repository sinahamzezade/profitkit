import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BillingInterval } from "@shopify/shopify-api";
import { runInstallBackfill } from "./shopify/install";

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
      // Not awaited. The backfill pulls 60 days of orders across paginated
      // requests; awaiting it here would hold the install redirect open for as
      // long as that takes and leave the merchant looking at a hung page. The
      // dashboard already has an empty state, so it fills in as this progresses.
      //
      // `runInstallBackfill` never throws, so this cannot become an unhandled
      // rejection that takes the server down mid-install. The `.catch` is a
      // belt-and-braces guard for anything thrown before its own try block.
      //
      // Webhook subscriptions are declared in shopify.app.profitkit.toml and
      // registered by `shopify app deploy`. That makes them app-specific, so
      // `registerWebhooks` — which exists for shop-specific subscriptions — would
      // add nothing here.
      void runInstallBackfill(admin.graphql, session.shop)
        .then((result) => {
          if (result.ran) {
            console.log(
              `[install] backfilled ${session.shop}: ${result.productsIngested} products, ` +
                `${result.ordersIngested} orders since ${result.windowStart.toISOString()}`,
            );
          } else if (result.reason === "failed") {
            console.error(`[install] backfill failed for ${session.shop}:`, result.error);
          }
        })
        .catch((error) => {
          console.error(`[install] backfill crashed for ${session.shop}:`, error);
        });
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
