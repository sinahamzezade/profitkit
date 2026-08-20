import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { handleCustomerDataRequest } from "../privacy/gdpr";

/** Mandatory privacy webhook. HMAC is verified by `authenticate.webhook`. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const result = handleCustomerDataRequest();

  console.log(`${topic} for ${shop}: ${result.note}`);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
