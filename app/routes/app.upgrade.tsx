import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { BillingError } from "@shopify/shopify-api";

import { authenticate } from "../shopify.server";
import { PRO_PLAN, PRO_PLAN_NAME } from "../billing/plan";

/**
 * Starts the Shopify-hosted subscription flow. Kept as its own route so the
 * charge is only ever created by a deliberate POST — a loader that billed on
 * page load would charge merchants who merely navigated here.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  try {
    // `request` redirects to Shopify's confirmation page; the merchant approves the
    // charge there, not in this app.
    return await billing.request({
      plan: PRO_PLAN_NAME,
      // eslint-disable-next-line no-undef
      isTest: process.env.NODE_ENV !== "production",
      // eslint-disable-next-line no-undef
      returnUrl: new URL("/app", process.env.SHOPIFY_APP_URL).toString(),
    });
  } catch (error) {
    /*
     * The success path throws too.
     *
     * `billing.request` never returns on success: the adapter signals the hop to
     * Shopify's confirmation page by throwing a redirect Response. So this catch
     * has to put anything that is a Response straight back, or approving a charge
     * would be swallowed here and read as a failure.
     */
    if (error instanceof Response) throw error;

    if (error instanceof BillingError) {
      /*
       * `BillingError.message` is the fixed string "Error while billing the store"
       * for every possible cause — a rejected mutation, an ineligible store, an app
       * whose pricing Shopify manages itself. Everything that identifies the actual
       * cause is in `errorData`, which nothing was reading, so a failure here was
       * a stack trace with no information in it.
       */
      // eslint-disable-next-line no-undef, no-console
      console.error(
        "[billing] Shopify rejected the subscription request:",
        JSON.stringify(error.errorData, null, 2),
      );

      return {
        error: "Shopify would not start the subscription. Nothing has been charged.",
        /*
         * Shopify's own wording, passed through verbatim.
         *
         * It is sometimes aimed at the developer rather than the merchant — the
         * first real failure here was "Apps without a public distribution cannot use
         * the Billing API", which is a Partner Dashboard setting no merchant can act
         * on. Showing it anyway is still the right call: it is accurate, it gives
         * support something exact to work from, and paraphrasing Shopify's refusals
         * into friendlier text would mean guessing at causes this code cannot see.
         */
        detail: describeBillingErrors(error.errorData),
      };
    }

    throw error;
  }
};

/**
 * Flattens Shopify's `userErrors` into one readable line.
 *
 * Shape is `{field, message}` per entry, but `errorData` is typed loosely enough
 * to hold GraphQL errors too, so this reads defensively rather than trusting it.
 */
function describeBillingErrors(errorData: unknown): string | null {
  if (!Array.isArray(errorData) || errorData.length === 0) return null;

  const messages = errorData
    .map((entry) =>
      entry && typeof entry === "object" && "message" in entry
        ? String((entry as { message: unknown }).message)
        : null,
    )
    .filter((message): message is string => Boolean(message));

  return messages.length > 0 ? messages.join(" ") : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app");
};

export const PRO_PRICE_LABEL = `$${PRO_PLAN.amount}/month`;
