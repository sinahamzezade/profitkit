import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { startInstallBackfill } from "../shopify/install";
import { PK_TOKENS } from "../styles";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // The safety net for the install backfill. `afterAuth` is the fast path, but it
  // only runs on the OAuth authorization-code flow — an embedded app mints most of
  // its sessions through token exchange, which does not call it. A first backfill
  // that failed also releases its claim so it can be retried, and without a trigger
  // here nothing ever would: the shop would sit empty forever.
  //
  // Safe to call on every page load. The claim inside is a conditional UPDATE, so
  // once the backfill has succeeded this costs one indexed query and does nothing.
  startInstallBackfill(admin.graphql, session.shop);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/* Palette and the two or three helpers every page uses, rendered once here
          rather than repeated inside each route's own style block. Page-specific
          rules stay with their page. */}
      <style>{PK_TOKENS}</style>

      {/* Merchant-facing views only. /app/audit still exists and is reachable by URL —
          it's a developer diagnostic for checking which Shopify fields a store
          actually returns, and VERIFICATION.md depends on it, but it is not
          something a merchant should be navigating to. */}
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/products">Product margin</s-link>
        <s-link href="/app/leaks">Discounts &amp; refunds</s-link>
        <s-link href="/app/settings">Cost settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
