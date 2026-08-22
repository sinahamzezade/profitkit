import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { BillingError } from "@shopify/shopify-api";

import { authenticate } from "../shopify.server";
import { resolveActiveSubscription } from "../billing/tier";

/**
 * Cancels the Pro subscription and returns the shop to free.
 *
 * Required by App Store requirement 1.2.3, "Allow pricing plan changes": merchants
 * must be able to change plan in both directions without contacting support or
 * reinstalling. Only the upgrade half existed.
 *
 * **Nothing here writes a tier.** The app stores none — `resolveTierForShop` asks
 * the Billing API on every request, so the moment Shopify records the cancellation
 * the next page load resolves to free on its own. There is no local row to update,
 * no webhook to handle and no reconciliation step, which is why this route is as
 * short as it is.
 *
 * POST-only for the same reason as the upgrade route: a loader that cancelled on
 * page load would downgrade a merchant who merely navigated here.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  const subscription = await resolveActiveSubscription(billing);
  if (!subscription) {
    // Not an error worth a banner: the shop is already on free, which is the state
    // the merchant was asking for. Idempotent by design — a double-submit, or a
    // cancellation made in Shopify's own settings first, both land here.
    return { ok: true, alreadyFree: true };
  }

  try {
    await billing.cancel({
      subscriptionId: subscription.id,
      /*
       * Must match how the subscription was created, or the cancel silently targets
       * nothing. The upgrade route derives `isTest` exactly this way, and the two
       * have to agree — a test subscription cancelled as a live one, or the reverse,
       * fails to find its target rather than erroring usefully.
       */
      // eslint-disable-next-line no-undef
      isTest: process.env.NODE_ENV !== "production",
      /*
       * No proration, stated deliberately rather than inherited.
       *
       * Passing `prorate: true` would credit the merchant the unused part of the
       * cycle and deduct that from the Partner account. Off is Shopify's default and
       * is the ordinary arrangement for a $29 monthly plan: the merchant keeps Pro
       * until the period they already paid for ends. The UI says so, because the
       * alternative is a merchant discovering it on a statement.
       */
      prorate: false,
    });

    return { ok: true, alreadyFree: false };
  } catch (error) {
    if (error instanceof Response) throw error;

    if (error instanceof BillingError) {
      // Same reasoning as the upgrade route: `BillingError.message` is a fixed
      // string for every cause, and everything identifying is in `errorData`.
      // eslint-disable-next-line no-undef, no-console
      console.error(
        "[billing] Shopify rejected the cancellation:",
        JSON.stringify(error.errorData, null, 2),
      );

      return {
        error:
          "Shopify would not cancel the subscription. Your plan has not changed.",
        detail: describeBillingErrors(error.errorData),
      };
    }

    throw error;
  }
};

/** Shared with the upgrade route in shape, kept local so neither imports the other. */
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
