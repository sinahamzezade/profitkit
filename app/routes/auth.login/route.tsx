import { AppProvider } from "@shopify/shopify-app-react-router/react";
import type { LoaderFunctionArgs } from "react-router";

import { login } from "../../shopify.server";

/**
 * The non-embedded entry point, with no shop-domain field.
 *
 * App Store requirement 2.3.1 — "Initiate installation from a Shopify-owned
 * surface" — prohibits asking a merchant to type their own `myshopify.com`
 * domain. The scaffold this route came from did exactly that: a text field
 * bound to `shop` with `example.myshopify.com` as the hint. Shopify's own
 * template ships it and plenty of listed apps carry it, because it only serves
 * the non-embedded path — but the requirement is written flatly, and a reviewer
 * who opens /auth/login sees a prompt the rule forbids.
 *
 * The route is kept rather than deleted. `authenticate.admin` redirects here
 * when it cannot resolve a shop from the request, and the library's default
 * `loginPath` is this path, so removing the file turns that redirect into a 404.
 *
 * `login(request)` is still called in the loader, and that is the part that
 * matters: a request arriving from Shopify with a `shop` parameter is handed
 * straight into OAuth exactly as before. Only the manual-entry field is gone.
 * A person who reaches this page without a shop now gets told where to install
 * from instead of being asked to supply a domain.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Throws a redirect into OAuth when the request carries a valid shop, which is
  // the Shopify-originated case. Returns errors otherwise, which are deliberately
  // not rendered — there is no field for them to attach to.
  await login(request);
  return null;
};

export default function Auth() {
  return (
    <AppProvider embedded={false}>
      <s-page heading="Redline">
        <s-section heading="Install Redline from the Shopify App Store">
          <s-paragraph>
            Redline is installed from your Shopify admin, not from this page.
            Search the Shopify App Store for Redline, or open the listing and
            choose Install.
          </s-paragraph>
          <s-paragraph>
            <s-text tone="neutral">
              Already installed? Open it from Apps in your Shopify admin.
            </s-text>
          </s-paragraph>
          <s-button
            variant="primary"
            href="https://redlineapp.tech"
            target="_blank"
          >
            About Redline
          </s-button>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
