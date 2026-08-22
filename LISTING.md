# App Store listing — Redline

Draft for submission. Every claim here is checked against what the app actually
does; see the notes at the bottom for the ones that were tempting but false.

---

## App name (30 char limit)

**Redline**

Seven characters, no descriptor. The previous entry, "Profitkit — True Profit Per
Product", was 35 and would have been rejected — Shopify caps the name at 30 and wants
a distinctive brand leading, not a keyword string.

Renamed away from Profitkit because three apps in this category had near-identical
names: a different company's tool at `profitkit.app`, and "Profiti: Profit Analytics",
which already ranked for a Profitkit search. Shopify's rule is that a name must not be
"similar enough that merchants could mistake it for another app", so the collision was
a submission risk rather than only a marketing one.

Redline also carries the product: to be in the red, and to redline a problem. It is
the one accent colour this app uses.

## Tagline (100 char limit)

> See which products lose you money.

Was "…, in three minutes." Removed: App Store requirement 4.3.3 forbids
"unsubstantiated claims" in the listing, and a setup-time promise is exactly that —
nothing in the app guarantees three minutes, and a store with a slow backfill would
make it false on its face.

## Short description

Revenue isn't profit. Redline subtracts what Shopify doesn't — cost of goods,
payment fees, the gap between shipping charged and shipping paid, discounts and
refunds — and tells you which products cost you money.

## Long description

**The product you sell most of might be the one costing you money.**

Shopify shows you revenue. It doesn't show you what each sale actually cost you.
Cost of goods sits in a spreadsheet, payment fees land in a payout summary,
shipping costs never appear at all, and refunds quietly undo weeks of margin.
Add them up and the ranking changes.

Redline is a P&L engine, not a dashboard. It answers one question: **which
products lose you money, and why.**

**Three views. One screen.**

- **Products losing you money** — ranked worst first, each with the single
  reason it's losing. Not "cost of goods is high" on every row, but the cost
  that's actually out of line for that product — naming the amount lost over the
  period, and by how much shipping or fees exceed what you charge.
- **Product margin** — every product, sortable, with revenue, COGS, fees,
  shipping variance, refunds and contribution margin.
- **Discounts & refunds** — where profit leaks month to month, by discount code
  and refund reason.

**You don't need your costs ready.**

Most merchants have never entered cost of goods, and an app that opens with
"enter the cost for your 62 products" is an app you close. Redline starts with
one number — roughly what percentage of price a product costs you — and gives
you a complete answer in under a minute. Refine by vendor when you want to.
Import exact costs from a spreadsheet when you're ready. Every estimated figure
is labelled as an estimate, so you always know which numbers are firm.

**Honest about what it can't know.**

Shopify's API doesn't expose what shipping actually cost you, and only reports
payment fees for Shopify Payments. Redline models those instead of pretending
otherwise — and tells you which figures are modelled.

**It never sees your customers.**

Redline reads the money on an order, not the person who placed it. Customer
names, email addresses, phone numbers and postal addresses are never requested
from Shopify and never stored — and that isn't a promise, it's a test: the suite
fails if a customer-identifying field is ever added to the database schema.

Read-only, four permissions, no write access of any kind. It cannot change
anything in your store.

This is also why Redline doesn't connect to Meta, Google or TikTok. Attributing
profit to an ad campaign means tracking which shopper came from which ad, and
that requires exactly the customer-level data above. Ad spend is a real cost, and
a real omission — Redline measures the costs sitting inside your orders, and
leaves your shoppers out of it.

## Pricing

**Free** — Every product's margin for the last 90 days. Complete, not crippled:
the same engine, the same cause attribution, all three views, no row limits.

**Pro, $29/month** — **Your history stops expiring.** Shopify's API only hands
over 60 days of orders when you install; from that day on, Redline keeps every
order it sees. On Free you always see the most recent 90 days and older months
fall off the back. On Pro nothing falls off — month six shows you six months,
month eighteen shows eighteen, and seasonal comparison becomes possible for the
first time. Includes an accountant-ready CSV export of the whole history.

## Feature bullets

- Contribution margin per product, not just revenue
- Ranked list of loss-making products, each with its actual cause
- Cost of goods by global estimate, by vendor, or imported from CSV
- Payment fee modelling for gateways Shopify doesn't report
- Discount and refund erosion by code and reason
- Every estimated figure clearly labelled
- No customer data: names, emails, phone numbers and addresses are never
  requested or stored, enforced by an automated test
- Read-only. Four permissions, no write access to your store

## Screenshots (in order)

1. **Products losing you money** — the ranked list with plain-English reasons.
   This is the one that sells the app; it goes first.
2. **The one-number onboarding** — "Start here", showing how little is required
   to get an answer.
3. **Product margin table** — full breakdown, sorted worst-first.
4. **Discounts & refunds** — monthly erosion with code breakdown.

## Support

- Privacy policy: **https://redlineapp.tech/privacy** — published and verified
  live. `profitkit.app` is **not ours**; it belongs to a different Shopify app in the
  same category, and every reference to it here was wrong.
- Support email: **profitkitapp@gmail.com** — the mailbox that already owns the Partner
  and Railway accounts, so it demonstrably receives mail. It was chosen because the
  published domain was then a `vercel.app` subdomain, which cannot take mail at all.
  **That constraint is gone:** `redlineapp.tech` is registered and its DNS is on
  Cloudflare, whose Email Routing forwards `support@redlineapp.tech` to this same
  inbox for free. Switch before submitting.

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
- **Any setup-time or results promise** — "in three minutes", "in one click",
  "find your losses today". Requirement 4.3.3 forbids unsubstantiated claims, and
  every one of these is a guarantee the app cannot make. The tagline carried
  "in three minutes" until this was checked against the requirement.
- **Sample figures presented as output** — *"This product lost $340 in 90 days.
  Shipping costs exceed what you charge by $7.20 per order."* Invented numbers
  that read as data, which 4.3.3 also forbids ("stats, data"). Describe the shape
  of the finding instead; the screenshots show the real thing.
- **The words "best", "first" and "only"** as claims about the app. 4.3.3 names
  them specifically. "Your best-selling product might be your worst" was about the
  merchant's product rather than the app, so it was arguably fine — it was
  reworded anyway, because a reviewer scanning for the word does not stop to
  parse whose superlative it is.
- **Refund reasons for every refund.** Only refunds processed through Shopify's
  Returns flow carry a reason; refunds issued from the order page carry none.
- **"No protected customer data."** Tempting next to the privacy bullet, and
  false. Shopify classifies *order data itself* as protected customer data, and
  Redline requests access to it — that is the whole app. The true and narrower
  claim is the one made above: no protected customer *fields* — name, email,
  phone, address — are requested or stored. Do not widen it. `PRIVACY.md` states
  the distinction the same way, and a reviewer will read both.
- **"Includes ad spend"**, in any form. There is no ad-platform integration and
  there deliberately isn't going to be one while the privacy claim stands, since
  campaign attribution needs per-shopper tracking. If that trade is ever
  revisited, the privacy bullet and the paragraph above both have to go — they are
  one decision, not two.

## Before submission

- [ ] Support address. Currently `profitkitapp@gmail.com`, an existing mailbox, and
      **reopened by the domain purchase.**
      *Not `support@profitkit.app` — someone else's domain. The old reasoning was
      that the published domain was a `vercel.app` subdomain, which cannot take mail
      at all; `redlineapp.tech` can, via Cloudflare Email Routing, which is free and
      forwards to the same inbox. `support@redlineapp.tech` reads better on a listing
      than a Gmail address and costs nothing to set up.*
- [x] Publish the privacy policy at a public URL.
      *https://redlineapp.tech/privacy, fetched and confirmed live.*
- [x] **Deploy the marketing site** so the live privacy page and footer show the new
      address.
      *Deployed. `/privacy` serves `profitkitapp@gmail.com`, `/guide` returns 200, and
      the monogram and favicon are live. Note that site publishes only via
      `vercel --prod` — pushing the repo deploys nothing.*
- [x] **App icon uploaded.** `public/brand/redline-icon-1200.png`, set in the Dev
      Dashboard under **App settings → App icon**. Confirmed live in the Dashboard
      sidebar, the App icon panel and the Shopify admin nav, which previously showed
      the default placeholder next to "Redline". The same icon serves the App Store
      tile whenever the app is listed.
      *The field states PNG or JPG, 1200×1200, 1MB max; the file is PNG, 1200×1200,
      fully opaque, ~22KB on upload, padded enough that the automatic corner rounding
      does not clip the glyph, and carries no text — which the branding guidelines ask
      you to avoid.*

      Two things worth recording, because both were got wrong first time:

      The icon is **not** in `shopify.app.toml` — there is no `[branding]` section, and
      no icon identifier exists anywhere in the installed CLI. So `shopify app deploy`
      carries the name, scopes and webhooks but never the icon, and a version release
      will not update it. That much held up.

      What did not hold up was calling it a step no tooling can perform, and filing it
      as a manual task. It is an ordinary file input on the settings page and uploads
      like any other. It is also **not** gated behind choosing a distribution method,
      which was a guess worth checking rather than repeating — it matters here, because
      distribution is deliberately still unset.
      Dashboard: https://dev.shopify.com/dashboard/231656675/apps/412546138113
- [ ] Capture the four screenshots at 1600×900 from a seeded store.
- [ ] Record the 60-second demo: install → cost estimate → loss-making products.
- [ ] Complete every item in `VERIFICATION.md`.
