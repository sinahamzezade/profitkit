import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { handleShopRedact } from "../privacy/gdpr";

/**
 * Mandatory privacy webhook, fired 48 hours after uninstall. Unlike the customer
 * ones this genuinely deletes: every row belonging to the shop, including the
 * merchant's own cost configuration.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  const { deleted } = await handleShopRedact(shop);
  console.log(`${topic} for ${shop}: ${deleted ? "shop data erased" : "no data held"}`);

  return new Response();
};
