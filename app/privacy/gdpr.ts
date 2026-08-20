import prisma from "../db.server";

/**
 * The three mandatory privacy webhooks.
 *
 * What makes these easy here is a decision made on day 3: this app never stores
 * customer identity. Orders are ingested for their money — line totals, discounts,
 * refunds, gateway fees — and no name, email, address or customer id is written to
 * any table. So a data request has nothing personal to return, and a customer
 * redaction has nothing personal to erase.
 *
 * That is worth stating explicitly rather than silently returning 200, because a
 * reviewer will ask, and because if a future change starts storing customer data
 * these functions must change with it.
 */

export interface CustomerDataRequestResult {
  storesPersonalData: false;
  note: string;
}

export function handleCustomerDataRequest(): CustomerDataRequestResult {
  return {
    storesPersonalData: false,
    note:
      "Profitkit stores order financials only — line totals, discounts, refunds and " +
      "fees. It holds no customer name, email, address, phone or customer identifier, " +
      "so there is no personal data to return for this customer.",
  };
}

export function handleCustomerRedact(): CustomerDataRequestResult {
  return {
    storesPersonalData: false,
    note:
      "No customer-identifying fields are stored, so there is nothing to redact. " +
      "Order-level financial records are retained as shop data, not personal data.",
  };
}

/**
 * shop/redact fires 48 hours after uninstall and does have work to do: everything
 * belonging to the shop must go. Deleting the Shop row cascades to products,
 * variants, orders, lines, refunds and the merchant's cost configuration.
 */
export async function handleShopRedact(shopDomain: string): Promise<{ deleted: boolean }> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });

  await prisma.$transaction([
    ...(shop ? [prisma.shop.delete({ where: { id: shop.id } })] : []),
    prisma.session.deleteMany({ where: { shop: shopDomain } }),
  ]);

  return { deleted: shop != null };
}
