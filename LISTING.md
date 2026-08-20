# App Store listing — Profitkit

Draft for submission. Every claim here is checked against what the app actually
does; see the notes at the bottom for the ones that were tempting but false.

---

## App name

**Profitkit — True Profit Per Product**

## Tagline (100 char limit)

> See which products lose you money, in three minutes.

## Short description

Revenue isn't profit. Profitkit subtracts what Shopify doesn't — cost of goods,
payment fees, the gap between shipping charged and shipping paid, discounts and
refunds — and tells you which products cost you money.

## Long description

**Your best-selling product might be your worst.**

Shopify shows you revenue. It doesn't show you what each sale actually cost you.
Cost of goods sits in a spreadsheet, payment fees land in a payout summary,
shipping costs never appear at all, and refunds quietly undo weeks of margin.
Add them up and the ranking changes.

Profitkit is a P&L engine, not a dashboard. It answers one question: **which
products lose you money, and why.**

**Three views. One screen.**

- **Products losing you money** — ranked worst first, each with the single
  reason it's losing. Not "cost of goods is high" on every row, but the cost
  that's actually out of line for that product: *"This product lost $340 in 90
  days. Shipping costs exceed what you charge by an average of $7.20 per order."*
- **Product margin** — every product, sortable, with revenue, COGS, fees,
  shipping variance, refunds and contribution margin.
- **Discounts & refunds** — where profit leaks month to month, by discount code
  and refund reason.

**You don't need your costs ready.**

Most merchants have never entered cost of goods, and an app that opens with
"enter the cost for your 62 products" is an app you close. Profitkit starts with
one number — roughly what percentage of price a product costs you — and gives
you a complete answer in under a minute. Refine by vendor when you want to.
Import exact costs from a spreadsheet when you're ready. Every estimated figure
is labelled as an estimate, so you always know which numbers are firm.

**Honest about what it can't know.**

Shopify's API doesn't expose what shipping actually cost you, and only reports
payment fees for Shopify Payments. Profitkit models those instead of pretending
otherwise — and tells you which figures are modelled.

## Pricing

**Free** — Product-level margin for the last 90 days. Complete, not crippled.

**Pro, $29/month** — Full history, and an accountant-ready CSV export.

## Feature bullets

- Contribution margin per product, not just revenue
- Ranked list of loss-making products, each with its actual cause
- Cost of goods by global estimate, by vendor, or imported from CSV
- Payment fee modelling for gateways Shopify doesn't report
- Discount and refund erosion by code and reason
- Every estimated figure clearly labelled

## Screenshots (in order)

1. **Products losing you money** — the ranked list with plain-English reasons.
   This is the one that sells the app; it goes first.
2. **The one-number onboarding** — "Start here", showing how little is required
   to get an answer.
3. **Product margin table** — full breakdown, sorted worst-first.
4. **Discounts & refunds** — monthly erosion with code breakdown.

## Support

- Support email: **support@profitkit.app** *(not yet provisioned — see below)*
- Privacy policy: **https://profitkit.app/privacy** *(not yet published)*

---

## Claims deliberately not made

Written down so nobody adds them later without checking:

- **"90 days of history on install."** False on install. `read_orders` only
  exposes 60 days without `read_all_orders`, which needs a written application to
  Shopify. History accumulates forward from install via webhooks, so the free
  tier's 90-day window fills in over time rather than being there on day one.
  The listing says "last 90 days" for the free tier because that is the window
  the tier permits — but do not write "see your last 90 days immediately".
- **"Accurate shipping costs."** The API does not expose them. They are a
  merchant input or an estimate, always.
- **"All payment fees."** Only Shopify Payments reports real fees. Everything
  else is modelled from rules the merchant sets.
- **"AI-powered."** Nothing here is. If removing the word changes nothing, the
  word was the pitch.
- **Refund reasons for every refund.** Only refunds processed through Shopify's
  Returns flow carry a reason; refunds issued from the order page carry none.

## Before submission

- [ ] Provision `support@profitkit.app` and confirm it receives mail.
- [ ] Publish the privacy policy at a public URL.
- [ ] Capture the four screenshots at 1600×900 from a seeded store.
- [ ] Record the 60-second demo: install → cost estimate → loss-making products.
- [ ] Complete every item in `VERIFICATION.md`.
