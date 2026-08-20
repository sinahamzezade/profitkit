# Profitkit — 10-Day Build Roadmap

**Scope:** A working, demonstrable margin engine with all three v1 views, a complete COGS onboarding ladder, and a Shopify adapter written and unit-tested against mocks.

**Not in scope:** A published App Store listing. See §0.

**Assumption:** ~8 focused hours/day, single developer, TypeScript throughout.

---

## §0 — Read This First: What 10 Days Can and Cannot Buy

A Shopify Partner account is required before you can create a development store, and the Partner Program Agreement excludes residents of comprehensively sanctioned territories. That gate sits before day one, and it is not an engineering problem.

So this roadmap is built around a deliberate architectural choice: **the Shopify connector is an adapter behind an interface, and everything else is built and tested against seeded data.** This is not a workaround hack — it is how you would want to build this anyway. The margin engine should never know it is talking to Shopify.

Consequence: when the entity, residency and Partner account are in place, connecting to a real store is roughly 2–3 days of integration work, not a restart. Everything valuable is already built and tested.

Also note: Shopify app review adds calendar time after development is complete. Plan around that separately.

---

## Day 1 — Listing Copy, Then Domain Model

**Morning (1 hour): write the App Store listing before any code.**
App name, tagline, the three bullet points, and the "what this app does" paragraph. If you cannot write copy that would make you install it, the idea is not sharp enough yet and you should stop here rather than spend nine more days.

**Rest of day: the margin domain model.**

Define the calculation as pure TypeScript functions with no I/O:

```
contributionMargin(line) =
    lineRevenue
  − lineDiscountAllocated
  − lineCOGS
  − lineGatewayFee
  − allocatedShippingDelta
  − refundImpact
```

Decisions to lock today, because reversing them on day 6 is expensive:

- **Order-level discount allocation** — proportional to line revenue, and refunds must reverse using the same allocation
- **Shipping delta** — `shippingCharged − shippingCost`, allocated across lines by weight or evenly; pick one and document it
- **Gateway fees** — percentage + fixed, configurable per payment method
- **Tax** — excluded from both revenue and margin. Say so in the UI.
- **Currency** — store currency only. Multi-currency is out of v1, explicitly.
- **Partial refunds** — a refund reduces margin on the specific lines refunded, not pro-rata across the order

**Done when:** the margin functions exist with unit tests covering full refund, partial refund, order-level discount, and free-shipping-promotion cases. No database, no UI.

---

## Day 2 — Seeded Data Generator

Build a generator that emits realistic Shopify Admin API GraphQL payload shapes: orders, line items, refunds, discount applications, shipping lines, transactions.

Target a store that mirrors the real median: **62 products, $50 median price, ~500 orders over 90 days**, with a deliberately planted subset of products that lose money once COGS and shipping are accounted for.

**Done when:** `npm run seed` produces a dataset you can run the day-1 functions against, and you can hand-verify that the planted loss-making products are correctly identified.

This dataset is your development store for the next eight days. Time spent making it realistic pays back every single day after.

---

## Day 3 — Persistence and Ingestion

Postgres schema, plus an ingestion pipeline shaped like webhook handling from the start.

- Tables: `shops`, `products`, `variants`, `orders`, `order_lines`, `refunds`, `cogs_entries`, `fee_rules`
- Idempotent upserts keyed on Shopify GIDs — webhooks are delivered more than once, always
- Ingestion entry points named for the real events: `orders/create`, `orders/updated`, `refunds/create`, `products/update`
- A backfill path separate from the webhook path

**Done when:** the seeded dataset loads end-to-end, replaying the same payload twice changes nothing, and margin computes off the database rather than off memory.

---

## Day 4 — COGS Ladder, Rungs 1 and 2

Per the brief, this is where the product lives or dies. Two days are allocated to it on purpose.

**Rung 1 — Percentage of price.** One global number, applied to everything. This is the escape hatch that gets a merchant to their first insight in under 60 seconds. Store it as an explicit `estimated` flag so every downstream number can be labeled as an estimate.

**Rung 2 — Bulk set by collection or vendor.** One number applied across a group, overriding the global default. Most merchants have three to five natural cost tiers, not 62 individual ones.

Precedence: `variant-level > collection/vendor > global estimate`.

**Done when:** a merchant with zero cost data can produce a complete margin report, and every estimated figure is visibly marked as such in the data layer.

---

## Day 5 — COGS Ladder, Rung 3 (CSV Import)

**Rung 3 — CSV import** for merchants who already track cost in a spreadsheet.

- Column mapping UI — never assume header names
- Match on SKU first, variant ID second, product title never
- Validation pass before commit, with a downloadable error report listing unmatched rows
- Partial import allowed; do not reject the whole file over three bad rows

**Done when:** you can import a deliberately messy CSV — wrong column order, missing SKUs, currency symbols in the cost column, blank rows — and get a clean result plus a usable error report.

---

## Day 6 — View 1: Product Margin Table

The workhorse view. Sortable, filterable, paginated to handle a 1,000-product catalog without choking.

Columns: product, units sold, revenue, COGS, fees, shipping delta, refunds, contribution margin, margin %.

Use Polaris. Do not design a custom component library — you have four days left and this is not where differentiation lives.

**Done when:** the table renders the seeded dataset correctly and every number reconciles against a manual spreadsheet check of ten sample products.

---

## Day 7 — View 2: "The 10 Products Losing You Money"

The hero view. Polish this one disproportionately — it is what appears in the App Store screenshot and what sells the app.

- Ranked list of negative-margin products, worst first
- For each: how much it lost, over what period, and the single largest cost driver (COGS, shipping, discounts, or refunds)
- One plain-English sentence per product: *"This product lost $340 in 90 days. Shipping costs exceed what you charge by an average of $7.20 per order."*
- Empty state that is genuinely good: if nothing loses money, show the three thinnest-margin products instead

**Acceptance test to run today:** fresh install → global COGS estimate → this view. **Under 3 minutes.** If it is not, fix the onboarding path, not the view.

---

## Day 8 — View 3, Tiering, and Export

- **Discount & refund impact** — monthly profit erosion, broken out by discount code and by refund reason
- **Tier gating** — free tier gets product-level margin at 90 days; Pro adds full history, channel breakdown and export. Gate at the data-fetch layer, not the UI, or it will be trivially bypassed.
- **Accountant export** — CSV, with a Xero/QuickBooks-friendly column layout

The free tier must be genuinely complete for its use case. If it reads as a crippled trial, you have rebuilt the exact failure the whole positioning is designed to exploit.

**Done when:** a free-tier account can complete the core job end-to-end without ever seeing an upgrade wall mid-task.

---

## Day 9 — Shopify Adapter

Now write the integration layer, against the interface the last eight days have been coding to.

- OAuth install flow and session storage
- GraphQL Admin API queries for orders, products, refunds — written against the documented schema
- Webhook registration and HMAC verification
- Billing API wiring for the $29 tier
- Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) — these are a review requirement, not optional

All of it unit-tested against recorded mock responses. You are writing this code so that it is ready, not so that it runs today.

**Strong recommendation:** use Shopify's official Remix app template rather than rolling your own with Next.js. It ships auth, session handling, App Bridge and billing scaffolding. Fighting the template to use a preferred framework costs 2–3 days you do not have in a 10-day budget — and your Next.js experience transfers to Remix in a few hours.

**Done when:** every Shopify-facing call is implemented and mock-tested, with a written checklist of what must be verified against a real dev store later.

---

## Day 10 — Listing Assets and Buffer

- Screenshots generated from the seeded dataset (it was built to look realistic for exactly this reason)
- A 60-second demo video: install → COGS estimate → loss-making products. That is the whole story.
- Finalize the listing copy drafted on day 1 — it will have improved now that the product exists
- Pricing page, privacy policy, support email

Realistically, half of this day is absorbed by overruns from days 6–8. That is planned, not a failure.

---

## If You Fall Behind — Cut In This Order

1. **Discount & refund breakdown** (day 8) — reduce to a single summary number
2. **CSV import** (day 5) — rungs 1 and 2 alone are enough to demonstrate the product
3. **Accountant export** — a Pro feature; can ship post-launch
4. **The product margin table** (day 6) — the hero view can stand alone

**Never cut:** the margin engine's correctness tests (day 1), the COGS estimate path (day 4), or the hero view (day 7). Those three are the product.

---

## The Real Risk

It is not the timeline. Ten days is achievable for this scope with fifteen years of backend experience behind it.

The risk is **scope creep into a dashboard**. Around day 6 there will be a strong pull toward adding a chart, then a date-range comparison, then a configurable widget layout. Every competitor in this category built that, and it is precisely why merchants install them, get overwhelmed, and churn.

Three views. One screen. Ship it.
