# Privacy Policy — Redline

**Last updated:** 20 August 2026

Redline is a profit-analysis app for Shopify stores. This policy describes what
it stores, why, and for how long.

---

## What Redline stores

Redline analyses the money in your orders, not the people who placed them.

**From your store, it stores:**

- Products and variants: title, vendor, SKU, price, and Shopify's cost field
- Orders: order number, date, currency, shipping charged, discount total and
  discount codes, payment gateway name, and reported payment fees
- Order line items: title, SKU, quantity, line total, and discount allocated
- Refunds: amount, quantity, date, and — where Shopify provides one — the return
  reason and refund note
- Cost settings you enter: cost estimates, per-vendor overrides, imported costs,
  payment-fee rules and shipping-cost assumptions

**It does not store:**

- Customer names, email addresses, phone numbers or postal addresses
- Customer identifiers of any kind
- Payment card details or any payment credentials
- IP addresses or browsing behaviour of your shoppers

Redline does not request these fields from Shopify's API at all. This is
enforced by an automated test that fails if a customer-identifying field is ever
added to the database schema.

## What it requests access to

Four read-only permissions:

- `read_orders` — order totals, discounts, refunds and payment fees
- `read_products` — product titles, vendors, SKUs and prices
- `read_inventory` — Shopify's per-variant unit cost field
- `read_returns` — the reason recorded against a return, where one exists

Redline has no write access. It cannot change anything in your store.

## Access to protected customer data

Shopify classifies order data as protected customer data. Redline requests
access to it in order to read order financials. It does not request access to
protected *customer fields* — name, email, phone, address — because it does not
use them.

## How your data is used

Only to produce the reports you see in the app: contribution margin per product,
loss-making products, and discount and refund erosion. Your data is never sold,
never shared with third parties, and never used to train anything.

## Where data is held

Order and product records are stored in a Postgres database operated solely for
running Redline, and are transmitted over TLS.

## Retention and deletion

- **While installed:** records are retained so history accumulates over time.
- **On uninstall:** Shopify sends a shop redaction request 48 hours later. On
  receiving it, Redline deletes every record belonging to your store —
  products, orders, refunds, your cost settings, and the session — permanently.
- **Customer data requests and customer redaction:** Redline responds to both,
  reporting that it holds no personal data for the customer, because it does not.

To request deletion sooner, uninstall the app or email the address below.

## Your merchant data

The email address associated with your Shopify session is stored by Shopify's own
app library for authentication. It is deleted when your shop's data is deleted.

## Changes

Material changes will be reflected here with an updated date, and where the
change affects what is stored, communicated to installed merchants.

## Contact

**profitkitapp@gmail.com**

---

*Deployment note: published at **https://profitkit.vercel.app/privacy**, which is the
URL to enter in the App Store listing. The rendered page lives in the separate
`marketing/` project, so this file and that page have to be kept in step by hand. Both
previously named `support@profitkit.app` — a domain belonging to a different Shopify
app in the same category, so merchants emailing support reached a competitor. Both now
read `profitkitapp@gmail.com`; the marketing change needs deploying for the live page
to agree with this file. `vercel.app` subdomains cannot receive mail, which is why the
address is a mailbox rather than one on the published domain.*
