# True Profit Per Order — Shopify App Product Brief

**Working name:** Margin (placeholder)
**Category:** Analytics & Reporting
**Target segment:** Shopify stores under 50K monthly visits
**Positioning line:** *Profit margin for stores that don't need Triple Whale.*

---

## 1. The Idea in One Paragraph

Most small Shopify merchants do not know which of their products lose money. They see revenue in the Shopify dashboard, but revenue is not profit — cost of goods, payment processing fees, the gap between shipping charged and shipping paid, discounts, and refunds all sit outside that number. This app ingests those inputs and returns one thing: contribution margin per order, per product, per channel. The headline view is a list titled *"The 10 products losing you money."* Nothing else in v1.

This is not a machine learning product. It is a P&L engine with a Shopify connector.

---

## 2. Why This Market

Four data points, in order of importance.

### 2.1 The gap is enormous

98.1% of Shopify stores have no dedicated analytics app installed — 935,382 stores out of the 953,062 analyzed by StoreInspect (August 2026). "Dedicated analytics" here means tools like Triple Whale or Lifetimely, not GA4 or GTM, which are counted separately as pixels. Nearly every store has tracking. Almost none has profit reporting.

### 2.2 The category has the highest revenue ceiling on the platform

Per GapQuery's revenue modeling, a top-10 app in `analytics-reporting` can clear $500K/month, while a top-10 app in `document-management` caps out closer to $30K. The spread across categories is roughly 5x on pricing alone, and it is fixed before a single line of code is written. Category selection is the highest-leverage decision in this project.

### 2.3 There is a specific, named pricing failure to exploit

In `analytics-reporting`, 36% of apps advertise a free tier that locks every meaningful feature behind a ~$147 plan. Merchants install, hit the paywall in week one, churn, and leave a one-star review. The ecosystem average app price is about $92/month.

The opening: a genuinely free tier that solves one use case *completely*, with a $29 paid tier that adds depth rather than unlocking basic usability.

### 2.4 The long tail is unserved by design

- 67.4% of stores get under 50K monthly visits
- Median catalog: 62 products
- Median product price: $50

Triple Whale, Lifetimely and similar tools are priced and built for merchants an order of magnitude larger. The long tail is not underserved by accident — it is deliberately skipped because the ARPU does not justify enterprise-style support. A solo developer with low overhead has the opposite cost structure.

---

## 3. Why This Founder

The product looks like analytics. It is actually accounting:

- Cost of goods at the variant level
- Payment gateway fee modeling per method and per region
- Shipping charged vs. shipping cost reconciliation
- Discount and refund attribution back to the originating order
- Contribution margin roll-up across order → product → collection → channel

Fifteen years in payments, installment and lease-to-own systems means this logic is native, not something to be learned. For most competitors in this category, financial correctness is a feature bolted onto a marketing dashboard. Here it is the entire product.

---

## 4. MVP Scope

### In scope

**Data ingestion**
- Orders, line items, refunds, discounts
- Shipping charged (from order) vs. shipping cost (merchant-supplied or carrier-rate estimate)
- Payment processing fees
- COGS at variant level

**Three views. Only three.**

1. **Product margin table** — true contribution margin per product, sortable
2. **"The 10 products losing you money"** — the view that sells the app
3. **Discount & refund impact** — monthly profit erosion from promotions and returns

### Explicitly out of scope for v1

- Ad spend attribution (a rabbit hole; every competitor drowns here)
- Multi-channel / marketplace consolidation
- Forecasting or predictions
- Any AI feature
- A configurable dashboard

If v1 does not fit on one screen, the scope is wrong.

---

## 5. Pricing

| Tier | Price | Contents |
|---|---|---|
| Free | $0 | Product-level margin, trailing 90 days. Complete, not crippled. |
| Pro | $29/mo | Full history, channel breakdown, accountant-ready CSV/Xero export |

Two tiers at launch. The free tier is a commitment, not a trial — if it is a disguised trial, it will produce the exact one-star reviews this app exists to exploit.

$29 against a $92 ecosystem average is a deliberate pricing wedge, not underpricing.

---

## 6. The Real Product Risk: COGS Entry

**This is where the product lives or dies, and it is not the reporting.**

Shopify does not reliably store cost of goods, and most small merchants have never entered it. An onboarding flow that opens with *"please enter the cost for your 62 products"* will kill activation before the merchant ever sees a chart.

Required onboarding ladder, in order of decreasing effort:

1. **CSV import** — for merchants who already track cost in a spreadsheet
2. **Bulk set by collection or vendor** — one number applied across a group
3. **Percentage-of-price estimate** — a single global assumption, refinable later

The merchant must reach the "10 products losing you money" view within 3 minutes of install, even if the numbers are approximate. Precision comes later; the insight has to land first.

**Build this before building any report.**

---

## 7. Competitive Reality

Existing players include BeProfit, Lifetimely, Sellerboard and Triple Whale. This app does not win on features.

The differentiation dimensions, in order:

1. **Price** — $29 vs. $99–$300
2. **Scope** — three views vs. a configurable dashboard nobody configures
3. **Onboarding** — minutes to first insight vs. a data-entry project

If the positioning line — *"profit margin for stores that don't need Triple Whale"* — cannot be defended in a conversation with a real merchant, do not build this.

---

## 8. Validation Protocol (before writing code)

Both steps are pure research and require no Shopify account or developer access.

**Step 1 — Review mining (2 hours).**
Read 50 one-star and three-star reviews across BeProfit, Lifetimely and Sellerboard. Hypothesis to test: the repeated complaints cluster on (a) price and (b) COGS data entry. If confirmed, the thesis holds. If the complaints are mostly about support quality with no feature pattern, the category cannot be beaten on product — abandon.

**Step 2 — Five merchant conversations (4–6 hours over a week).**
Mock the single "10 products losing you money" view in Figma. Show it. Ask exactly one question:

> *"How do you currently figure out which of your products lose money?"*

If the answer is "I don't" or "a spreadsheet," the market exists. If merchants describe a tool they are happy with, pick a different category.

**Advance criterion:** both steps clearly positive. Rationalizing a weak signal at this stage is the most expensive mistake available.

---

## 9. Operating Prerequisite

Shopify lists Iran among its unsupported countries. Individuals and businesses located there are prohibited from creating accounts, and account access from those countries is blocked. The Shopify Partner Program Agreement defines a "Sanctioned Person" to include anyone resident in a comprehensively sanctioned territory.

Practical consequence for sequencing:

- **Sections 8 (validation) and 7 (competitive research)** can begin immediately from anywhere. They involve reading public listings only.
- **Everything from Shopify Partner account onward** requires a legal entity, residency and banking outside Iran to be in place first.

Do not attempt to work around this. The failure mode is account termination with forfeiture of accrued payouts, and it typically triggers at the point where revenue has become material.

---

## 10. Sources

- StoreInspect, *State of Shopify 2026* (953,790 stores; updated 17 August 2026)
- GapQuery, *Shopify App Ideas in 2026: 13,786 Apps Analyzed* (data as of 20 May 2026)
- GapQuery, *How Much Do Shopify Apps Make?*
- Shopify Help Center, *Unsupported countries and regions*
- Shopify Partner Program Agreement
