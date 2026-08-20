import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
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
