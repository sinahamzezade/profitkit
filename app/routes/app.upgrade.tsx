import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticate } from "../shopify.server";
import { PRO_PLAN, PRO_PLAN_NAME } from "../billing/plan";

/**
 * Starts the Shopify-hosted subscription flow. Kept as its own route so the
 * charge is only ever created by a deliberate POST — a loader that billed on
 * page load would charge merchants who merely navigated here.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  // `request` redirects to Shopify's confirmation page; the merchant approves the
  // charge there, not in this app.
  return billing.request({
    plan: PRO_PLAN_NAME,
    // eslint-disable-next-line no-undef
    isTest: process.env.NODE_ENV !== "production",
    returnUrl: new URL("/app", process.env.SHOPIFY_APP_URL).toString(),
  });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app");
};

export const PRO_PRICE_LABEL = `$${PRO_PLAN.amount}/month`;
