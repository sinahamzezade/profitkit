# Verification checklist — what mock tests cannot prove

Everything in `app/shopify/`, `app/privacy/` and `app/billing/` is unit-tested
against recorded response shapes. Mocks prove the code handles the shapes it was
given; they cannot prove the shapes are right, that Shopify sends what we expect,
or that a webhook ever arrives. This is the list of things that must be checked
against a real store before submission.

Status legend: `[ ]` not yet verified · `[x]` verified against a live store.

---

## 1. Install and backfill

- [ ] Fresh install on a store with existing orders completes OAuth without error.
- [ ] `backfillShop` runs at install and ingests products before orders.
- [ ] Backfill pulls **60 days** and no more. Confirm the oldest ingested order is
      within the window, and that Shopify does not error on the `created_at:>=`
      query syntax.
- [ ] A store with more than 50 orders paginates correctly (cursor advances, no
      duplicates, no missing page). Mocks prove the loop logic; only a real store
      proves the cursor values.
- [ ] A store with more than 100 line items on one order — `lineItems(first: 100)`
      silently truncates beyond that. **Known gap:** line items are not paginated
      per order.
- [ ] A store with more than 20 refunds on one order — same truncation risk.

## 2. Field availability on a real merchant store

The day-2 audit ran against a quickstart dev store. Re-run `/app/audit` against a
store with genuine trading history and confirm:

- [ ] `inventoryItem.unitCost` fill rate — expected near zero, drives onboarding.
- [ ] `transactions.fees` present for Shopify Payments, absent for every other
      gateway. **This is the assumption the whole fee-modelling path rests on.**
- [ ] `discountApplications` returns `code` for code discounts and nothing for
      automatic ones.
- [ ] Refunds created through the Returns flow carry
      `returnLineItems.returnReasonDefinition.name`; refunds issued from the order
      page carry none.

## 3. Webhooks

- [ ] Each subscription in `shopify.app.profitkit.toml` actually registers on
      deploy (check the Partner dashboard webhook list, not just the toml).
- [ ] `orders/create` fires and the order appears with correct margin.
- [ ] `orders/updated` fires on an edit and updates rather than duplicating.
- [ ] `refunds/create` fires and the refund lands on the right line.
- [ ] `products/update` fires on a title, price, vendor **and** cost change.
- [ ] Delivering the same webhook twice changes nothing (idempotency holds against
      real Shopify retries, not just replayed fixtures).
- [ ] A webhook arriving for an order whose products were never ingested still
      succeeds via the placeholder-variant path.
- [ ] HMAC rejection: send a request with a bad signature and confirm a 401.
      `authenticate.webhook` should handle this — verify, don't assume.

## 4. Privacy webhooks (App Store review requirement)

- [ ] `customers/data_request` returns 200.
- [ ] `customers/redact` returns 200.
- [ ] `shop/redact` returns 200 **and** actually deletes every row for that shop.
      Confirm in the database, not just by the response code.
- [ ] Re-confirm no customer identity has crept into the schema since — the
      privacy responses claim we store none, and `app/privacy/gdpr.test.ts`
      asserts it, but a reviewer will check the real database.

## 5. Billing

- [ ] `/app/upgrade` redirects to Shopify's confirmation page.
- [ ] Approving a **test** charge on a dev store flips `billing.check` to
      `hasActivePayment: true`.
- [ ] Tier flips to `pro`: the 90-day window lifts and `/app/export.csv` returns a
      file instead of 402.
- [ ] Declining the charge leaves the shop on free.
- [ ] Cancelling an active subscription returns the shop to free.
- [ ] `isTest` is `false` in production. A test charge in production bills nobody
      and the app would hand out Pro for free.

## 6. Scopes and access

- [ ] Installed scopes are exactly `read_orders,read_products,read_inventory`.
      `write_orders` was added temporarily during development and must not
      reappear — this app never writes to a merchant's store.
- [ ] Protected customer data access is approved for the app, or every order query
      fails with `ACCESS_DENIED`.
- [ ] Confirm behaviour when the merchant declines a scope upgrade.

## 7. Known limits to state plainly, not paper over

- **60 days of history at install.** `read_orders` cannot see further back
  without `read_all_orders`, which needs a written application to Shopify. Any
  listing copy promising 90 days is wrong.
- **Actual shipping cost does not exist in the API.** Always a merchant input.
- **Gateway fees exist only for Shopify Payments.** For Telr, PayTabs, Tap, COD
  and every other gateway, modelled rules are the only path — not a fallback.
- **Refund reasons exist only via the Returns flow.** Refunds issued from the
  order page record none.
- **Line items and refunds are capped per order** at 100 and 20 respectively; see
  section 1.
- **Collection-level COGS never fires.** The ladder supports it and it is tested,
  but collection membership is not ingested, so vendor is the only working group
  rung.
