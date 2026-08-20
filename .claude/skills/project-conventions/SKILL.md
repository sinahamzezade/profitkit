---
name: project-conventions
description: Profitkit domain rules, visual language and known traps. Background knowledge for any change to this app.
user-invocable: false
---

# Profitkit conventions

Decisions here are deliberate. Several look like bugs if you don't know why.

## Money

- **All money is integer cents** (`Cents` in `app/margin/types.ts`). Floats never
  reach storage. Parse at the edge, store cents.
- **Allocation across lines must sum exactly to the total.** Use
  `allocateProportionally` (largest-remainder), never naive per-line rounding.
- **Tax is excluded** from both revenue and margin, and the UI says so.

## The margin formula

```
contributionMargin(line) =
    lineRevenue − lineDiscountAllocated − lineCOGS
  − lineGatewayFee − lineShippingLoss − lineRefundImpact
```

- `lineRevenue` is **gross**; discount is subtracted as its own term. Don't net them.
- **Shipping loss is `cost − charged`.** Positive means shipping ate margin. The
  original spec had this inverted.
- **Shipping is split evenly across lines**, not by revenue — it tracks weight, and
  there's no weight field.
- **Gateway fees are allocated by revenue share** — the fee really is a percentage of
  the amount processed.
- **Shopify's `discountAllocations` is trusted, not recomputed.** The field audit
  confirmed it is populated and correct.

## The cost ladder

Precedence: `variant override > native unitCost > collection > vendor > global`.

- A variant-level override outranks Shopify's native cost: both are merchant-supplied,
  and the one typed into this app is the more recent statement.
- Only the native field and an **absolute** variant override count as measured. A
  variant-level *percentage* is still an estimate.
- Nothing configured returns `source: "none"` with zero cents — never a fabricated
  industry average. Callers must not read that as "costs nothing".
- **The collection rung never fires**: collection membership isn't ingested. Vendor is
  the only working group rung.

## What Shopify cannot tell us

State these plainly in the UI; never paper over them.

- **Actual shipping cost does not exist in the API** — not null, absent.
- **Gateway fees are reported only for Shopify Payments.** For every other gateway,
  modelled rules are the only path.
- **Refund reasons exist only via the Returns flow.** A refund issued from the order
  page carries none — typically the majority.
- **`read_orders` sees 60 days.** History accumulates forward from install.

## Visual language

- **Red means loss. Only loss.** Never a decorative accent, never a brand colour.
- **Green is never "good".** It is the ledger-paper and cost ramp:
  `#212B1B → #47573E → #6E8064 → #9BAD90`, always in the order
  COGS · fees · shipping · refunds. Position identifies a cost as much as tone.
- **All figures use tabular numerals.**
- **Badge the exception, not the rule.** Nearly everything is estimated, so flag what
  *isn't*. A badge on all 62 rows says nothing.
- Page chrome stays native Shopify; only the data surface carries identity. Custom CSS
  is scoped with a `pk-` prefix.

## Traps

- **Polaris components reject `style`.** Size them with a wrapper div; don't fight the
  component.
- **`s-text-field` fires `change` on blur, not per keystroke.** Live search needs
  `onInput` plus a debounce.
- **Adding a required field to `ProductMarginRow` breaks three test files at once** —
  `productMargin.test.ts`, `lossLeaders.test.ts`, `dayEight.test.ts` all build fixtures.
- **The dev server caches Prisma on `globalThis`.** After a schema change or an edit to
  `app/shopify.server.ts`, restart. A page rendering its heading with an empty body is a
  stale server, not broken code.
- **`load-seed` upserts and never deletes.** Delete the shop first or stale rows survive.
- **npm scripts only run from `profikit/`.** A stray `shopify.app.toml` at the repo root
  makes the parent directory look like the app.

## Verification

`npx vitest run` covers the arithmetic. `npm run reconcile -- <domain>` is the real
net: it proves every column identity holds and that aggregates tie back to raw rows.
Run it after any change to `app/reports/`.
