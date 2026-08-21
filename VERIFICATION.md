# Verification checklist — what mock tests cannot prove

Everything in `app/shopify/`, `app/privacy/` and `app/billing/` is unit-tested
against recorded response shapes. Mocks prove the code handles the shapes it was
given; they cannot prove the shapes are right, that Shopify sends what we expect,
or that a webhook ever arrives. This is the list of things that must be checked
against a real store before submission.

Status legend: `[ ]` not yet verified · `[x]` verified against a live store ·
`[~]` partially verified, with the remaining gap noted.

---

## 1. Install and backfill

- [x] Fresh install on a store with existing orders completes OAuth without error.
      *2026-08-21, first-test-zenmt2u1 against Railway. Two traps: a truncated client
      secret fails as a silent 401 retry loop rather than an error, and a leftover dev
      preview pins the app URL to a dead tunnel until `shopify app dev clean`.*
- [x] `backfillShop` runs at install and ingests products before orders.
      *17 products, 9 orders. `afterAuth` alone was not enough — embedded sessions are
      minted by token exchange, which never calls it, so app/routes/app.tsx triggers it
      too.*
- [x] Backfill pulls **60 days** and no more. Confirm the oldest ingested order is
      within the window, and that Shopify does not error on the `created_at:>=`
      query syntax.
      *Window start logged as 2026-06-22 for a 2026-08-21 install; the `created_at:>=`
      syntax was accepted.*
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
- [~] Refunds created through the Returns flow carry
      `returnLineItems.returnReasonDefinition.name`; refunds issued from the order
      page carry none.
      *Second half confirmed on live data. A refund issued from the order page with
      "Damaged in transit" typed into Shopify's own "Reason for refund" field produced
      no structured reason: the app reports "$654.90 — 100% of refunded money — was
      refunded straight from the order page, where Shopify stores no reason at all."
      So that admin field is not `returnReasonDefinition` and is not exposed as one.
      The first half — that a Returns-flow refund does carry the name — still needs a
      return processed through the Returns flow, which is also the only way to
      exercise the `read_returns` selection added on 2026-08-21.*

## 3. Webhooks

- [x] Each subscription in `shopify.app.profitkit.toml` actually registers on
      deploy (check the Partner dashboard webhook list, not just the toml).
      *App version profitkit-8. Verified in `.shopify/deploy-bundle/manifest.json`:
      the `privacy_compliance_webhooks` module plus 6 `webhook_subscription` modules,
      all at the Railway domain. Shopify's own Dev Console lists the privacy module
      independently. The previous deploy had no privacy module and only 2
      subscriptions, all pointing at the scaffold placeholder URL.*
- [x] `app/scopes_update` fires and is accepted, not merely registered.
      *Granting `read_returns` produced `Received APP_SCOPES_UPDATE webhook` →
      `POST /webhooks/app/scopes_update 200`. A 200 rather than 401 also proves HMAC
      verification passes in production with the deployed secret.*
- [x] `orders/create` fires and the order appears with correct margin.
      *Order #1010, $24.95 product + $12.00 shipping. `POST /webhooks/orders 200`.
      Revenue rose by exactly $24.95 — not $36.95 — so charged shipping is correctly
      excluded from product revenue, and margin rose $24.95 with no shipping cost set,
      confirming an unknown shipping cost is no longer booked as profit on live data.*
- [x] `orders/updated` fires on an edit and updates rather than duplicating.
      *Quantity 1 → 2 on #1010. Third `POST /webhooks/orders 200`; the product view
      then showed **one** row at 2 units / $49.90, not two rows.*
- [x] `refunds/create` fires and the refund lands on the right line.
      *1 of 2 units refunded on #1010 at $24.95. `POST /webhooks/refunds/create 200`.
      The Ski Wax row went to $49.90 revenue / $24.95 refunds / $24.95 margin (50.0%)
      and the waterfall grew a Refunds segment — the refund attached to the right line,
      not the order as a whole. The refund also fired `orders/updated` and
      `products/update` (the restock); all three returned 200 and the refund was
      counted once, not three times.*
      *Worth knowing: units then read "1 units · $49.90 revenue", which looks
      inconsistent but is deliberate — units count what the customer kept, revenue
      stays gross, and refunds are a separate term. `lossPerUnit` guards the
      fully-refunded case by returning null rather than dividing by zero.*
- [~] `products/update` fires on a title, price, vendor **and** cost change.
      *Partial. Two `POST /webhooks/products/update 200` arrived unprompted while
      order #1010 was being edited — inventory movement triggered them — so the
      subscription delivers and the handler accepts. The four specific field changes
      have not been made individually, and `nativeCogsCents` in particular is the one
      that matters for the cost ladder.*
- [~] Delivering the same webhook twice changes nothing (idempotency holds against
      real Shopify retries, not just replayed fixtures).
      *Partial. Three deliveries for order #1010 (create, then two updates) produced
      one product row with the correct unit count, so repeated delivery does not
      double-count. A genuine Shopify **retry** of the identical delivery id has still
      not been observed — that needs a forced failure, not a happy path.*
- [ ] A webhook arriving for an order whose products were never ingested still
      succeeds via the placeholder-variant path.
- [x] HMAC rejection: send a request with a bad signature and confirm a 401.
      `authenticate.webhook` should handle this — verify, don't assume.
      *A forged `X-Shopify-Hmac-Sha256` with otherwise complete Shopify headers returns
      **401**; a request with no HMAC header at all returns **400**. Neither reached
      the handler, so no forged order was ingested.*

## 4. Privacy webhooks (App Store review requirement)

All three delivered live via `shopify app webhook trigger` against the Railway
deployment, so the HMAC was real and the routes were reached through Shopify's own
signing path — not a hand-rolled request.

- [x] `customers/data_request` returns 200.
      *`CUSTOMERS_DATA_REQUEST for shop.myshopify.com` → 200, and the response carries
      the explanation rather than a bare acknowledgement.*
- [x] `customers/redact` returns 200.
      *`CUSTOMERS_REDACT` → 200: "No customer-identifying fields are stored, so there
      is nothing to redact."*
- [x] `shop/redact` returns 200 **and** actually deletes every row for that shop.
      Confirm in the database, not just by the response code.
      *Two halves. Live: `SHOP_REDACT for shop.myshopify.com: no data held` → 200 —
      the CLI sends a placeholder domain, which exercises the no-op branch and left
      the real store untouched. Deletion itself was proved against Postgres with row
      counts on a throwaway shop: 1 row in each of shops, products, variants, orders,
      order_lines, refunds, cogs_entries, fee_rules and sessions → all 0. A second
      shop belonging to a different domain kept all nine rows, so the delete is
      scoped rather than a blanket wipe, and a second redact returned
      `{deleted: false}`, proving the row is gone rather than the handler merely
      claiming success.*
      **Not done:** `shop/redact` for the real store's own domain against the Railway
      database. It would wipe the ingested data and the session, forcing a re-consent;
      the local proof covers the same code path.
- [x] Re-confirm no customer identity has crept into the schema since — the
      privacy responses claim we store none, and `app/privacy/gdpr.test.ts`
      asserts it, but a reviewer will check the real database.
      *The test greps the live schema for customerId, email, phone, address, firstName
      and lastName across every domain model — excluding Shopify's own Session model,
      which holds merchant auth and is deleted on shop/redact — and asserts at least
      six `onDelete: Cascade` declarations. Passing as of 205 tests.*

## 5. Billing

> **Blocked, and not by code.** Every check below is unreachable until the app has
> **public distribution** set in the Partner Dashboard. Pressing "Upgrade to Pro" on
> 2026-08-21 returned the userError *"Apps without a public distribution cannot use
> the Billing API"* — Shopify authenticated the mutation and refused it on that rule
> alone. Nothing in this repo can lift it: `AppDistribution.AppStore` in
> `app/shopify.server.ts` configures the SDK's auth behaviour, not the Dashboard's
> distribution setting, and the two are unrelated despite the similar name.
>
> **Choosing a distribution method is irreversible.** Shopify does not allow it to be
> changed once set, so it is a deliberate decision for the app owner, not a step to
> take in passing while chasing a billing bug. Until it is set, treat this whole
> section as untestable rather than failing.
>
> The failure path itself is now handled: the refusal renders as a critical banner
> quoting Shopify's own wording and logs the full `userErrors` under `[billing]`,
> instead of throwing a bare 500 the way it did when first pressed.

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

- [x] Installed scopes are exactly
      `read_orders,read_products,read_inventory,read_returns`. `write_orders` was
      added temporarily during development and must not reappear — this app never
      writes to a merchant's store.
      *Deployed manifest reads `read_inventory,read_orders,read_products,read_returns`
      — no write scope. The consent screen offered exactly "View orders" and
      "Returns". `read_returns` was added on 2026-08-21 because the order query needs
      it for refund reasons; the adapter now retries without that selection if a shop
      declines, so the scope is not load-bearing for margin.*
- [ ] Protected customer data access is approved for the app, or every order query
      fails with `ACCESS_DENIED`.
- [x] Confirm behaviour when the merchant declines a scope upgrade.
      *Covered in code rather than by a live decline: Shopify refuses the whole order
      query over one ungranted field, so a declined `read_returns` used to mean no
      products and no orders at all. `isReturnsAccessDenied` now retries without the
      Returns selection, and a missing `read_orders` is deliberately still fatal
      rather than silently returning empty data. Live decline not yet exercised.*

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
