# HANDOVER — Profitkit

Context transfer from a planning session. Read this before touching anything.

---

## What we're building

A Shopify app that answers one question: **which products lose money.**

It looks like analytics. It is actually a P&L engine — cost of goods, gateway fees, shipping cost vs. shipping charged, discounts, refunds → contribution margin per order, product, and channel.

**Positioning:** *Profit margin for stores that don't need Triple Whale.*
**Target:** stores under 50K monthly visits. Median profile is 62 products at a $50 median price.
**Pricing:** free tier = product-level margin, trailing window, genuinely complete. Paid tier = $29/mo for full history, channel breakdown, accountant export.

The free tier is a commitment, not a disguised trial. The entire market thesis rests on 36% of apps in `analytics-reporting` faking a free tier and locking everything behind ~$147. If we rebuild that, we've rebuilt the failure we exist to exploit.

---

## Current state

**Exists:**
- Shopify Partner org: `Profitkit` (org id `231656675`)
- App in Dev Dashboard: `Profitkit`, handle `profitkit-1`, app id `412509667329`, 0 installs, no distribution method selected
- Dev store: `first-test-zenmt2u1` — Shopify quickstart, ~15 snowboard products at $699.95, multi-variant, includes useful edge cases (out-of-stock, draft, hidden, multi-location)

**Does not exist:**
- Any local code
- Any access scopes on the app — the active version `profitkit-1` declares none
- Any orders in the dev store — the orders page is an empty state
- Any real `application_url` — currently the placeholder `https://example.com`

Active version config: `embedded = true`, webhook `api_version = 2026-07`.

Credentials (Client ID, secret) live in Dev Dashboard → Settings. Not reproduced here. Do not commit them.

---

## Task 1 — Scaffold and wire up scopes

```bash
npm install -g @shopify/cli@latest
shopify app init            # Remix template
cd <app-dir>
shopify app config link     # link to existing "Profitkit" app
```

Then in `shopify.app.toml`:

```toml
[access_scopes]
scopes = "read_orders,read_products,read_inventory"
```

```bash
shopify app deploy
shopify app dev             # select first-test-zenmt2u1, install when prompted
```

`read_inventory` is the one that gets forgotten. Without it `InventoryItem.unitCost` — Shopify's native cost field, our COGS rung 0 — is invisible.

Leave `application_url` alone; `shopify app dev` overwrites it with a tunnel URL.

**Use the Remix template.** Not Next.js. It ships auth, session storage, App Bridge and billing scaffolding. The owner's background is Next.js and the transfer takes a few hours; fighting the template costs days.

---

## Task 2 — Run the field audit

Query file: `profitkit-field-audit.graphql` (two queries — margin field audit, and COGS fill rate).

Needs orders to exist first. Create test orders through the admin, shaped to exercise every branch:
1. Multi-line order
2. Order with a discount code applied
3. Order to partially refund afterward
4. Order with shipping charged

Record results in the table at the bottom of the query file. **Any field that returns null or is absent becomes a merchant input, and therefore a rung on the cost-assumptions ladder.** That table drives the schema.

---

## Known constraints — do not rediscover these

**Orders API is capped at 60 days.** `read_orders` only exposes the last 60 days. Full history needs `read_all_orders`, which requires a written application to Shopify and approval time.

→ **Decision: backfill 60 days at install, then accumulate forward via webhooks.** History grows over time. This works from day one, is honest, and creates a retention hook — uninstalling costs the merchant their accumulated history. Any listing copy promising "90 days" is wrong and must be corrected to 60.

**Actual shipping cost does not exist in the API.** Only shipping *charged*. Merchant input, always.

**Gateway fees exist only for Shopify Payments.** `transactions.fees` comes back empty for Telr, PayTabs, Tap, COD, and every third-party gateway. Since Shopify Payments has no native AED/SAR settlement, *every* GCC merchant is in this bucket. Modeled fee rules are not a fallback there — they are the only path.

**Dev stores cannot process real transactions.** So the dev store will never produce realistic fees, shipping costs, or refund patterns. It gives us schema shapes, not data. A seeded generator is required regardless — this is not a workaround.

**Legacy custom apps are dead.** As of 1 Jan 2026 merchants can't create them. Don't follow any tutorial that says Settings → Apps → Develop apps → copy token. Scopes live in `shopify.app.toml` and deploy via CLI; there is no scopes UI in Dev Dashboard.

---

## Architecture decisions already locked

**The Shopify connector is an adapter behind an interface.** The margin engine must never know it's talking to Shopify. Everything is built and tested against seeded data; the integration layer is written last, against recorded mock responses.

This is not only good practice — the owner is currently in Iran, and Shopify's Partner Program Agreement excludes residents of comprehensively sanctioned territories. Payout KYC is where that surfaces, not signup. The adapter boundary means that when entity/residency/banking are resolved elsewhere, connecting is 2–3 days of integration, not a restart. Keep that boundary clean.

**Margin formula:**

```
contributionMargin(line) =
    lineRevenue
  − lineDiscountAllocated
  − lineCOGS
  − lineGatewayFee
  − allocatedShippingDelta
  − refundImpact
```

Locked decisions:
- Order-level discount allocation: proportional to line revenue. **Check whether Shopify's `discountAllocations` already does this correctly — if so, delete our implementation.**
- Shipping delta: `shippingCharged − shippingCost`, allocated across lines. Pick one method, document it.
- Gateway fees: percentage + fixed, configurable per payment method
- Tax: excluded from both revenue and margin. Say so in the UI.
- Currency: store currency only. Multi-currency explicitly out of v1.
- Partial refunds: reduce margin on the specific lines refunded, **not** pro-rata across the order.

**Cost assumptions ladder** — three inputs the merchant must supply (COGS, fee rules, shipping cost), one shared pattern:
1. Global estimate (percentage of price) — gets to first insight in under 60 seconds
2. Group-level override (by collection or vendor)
3. Precise import (CSV, with column mapping, SKU matching, validation pass, partial import allowed)

Precedence: `variant-level > collection/vendor > global estimate`. Every estimated figure carries an `estimated` flag and is labeled as such in the UI.

**Build the ladder before building any report.** This is where the product lives or dies. An onboarding flow that opens with "enter the cost for your 62 products" kills activation before the merchant sees a chart.

---

## v1 scope — three views, one screen

1. **Product margin table** — sortable, paginated, handles a 1,000-product catalog
2. **"The 10 products losing you money"** — the hero view. Each entry: how much lost, over what period, the single largest cost driver, and one plain-English sentence. Good empty state: if nothing loses money, show the three thinnest margins instead.
3. **Discount & refund impact** — monthly profit erosion by discount code and refund reason

**Acceptance test:** fresh install → global COGS estimate → hero view, in **under 3 minutes**. If it isn't, fix onboarding, not the view.

### Do not build
- Ad spend attribution (every competitor drowns here)
- Multi-channel / marketplace consolidation
- Forecasting
- Any AI feature — if removing "AI" from the pitch makes the value vanish, AI was the pitch
- A configurable dashboard ← **the main risk to this project**

Around the time the margin table works there will be a strong pull toward adding a chart, then a date comparison, then widget layout. Every competitor built that. It's why merchants install them, get overwhelmed, and churn. Three views. One screen.

---

## Also required before submission

- Mandatory GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact` — review requirement, not optional
- Webhook HMAC verification
- Idempotent upserts keyed on Shopify GIDs — webhooks are delivered more than once
- Billing API wiring for the $29 tier
- Tier gating at the data-fetch layer, not the UI

---

## Companion files

- `shopify-margin-app-brief.md` — market evidence, competitive reality, validation protocol
- `profitkit-10-day-roadmap.md` — day-by-day build plan, plus what to cut if behind
- `profitkit-field-audit.graphql` — the audit queries and results table

---

## First thing to do

Task 1. Then create the four test orders. Then Task 2 and fill in the audit table — the schema depends on its results, so don't write migrations before it's done.
