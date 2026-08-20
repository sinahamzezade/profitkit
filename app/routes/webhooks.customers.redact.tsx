import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { handleCustomerRedact } from "../privacy/gdpr";

/** Mandatory privacy webhook. HMAC is verified by `authenticate.webhook`. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const result = handleCustomerRedact();

  console.log(`${topic} for ${shop}: ${result.note}`);

  return new Response();
};
