# Profitkit — build status

`../HANDOVER.md` describes the state **before** this build and is now historical.
This file is the current picture.

**Built:** the full 10-day roadmap scope — margin engine, seeded data, persistence
and ingestion, the three-rung cost ladder, all three v1 views, tier gating,
accountant export, and the Shopify adapter with webhooks, privacy endpoints and
billing.

**Live:** deployed on Railway and installed on a dev store. Install, backfill,
webhook registration and delivery, and the three mandatory privacy webhooks are
verified against that store — 15 of 32 `VERIFICATION.md` items, 3 partial.

**Not done:** billing has never been exercised, no store with real trading history
has been seen, and the app has never been submitted.

---

## What works, verified in the running app

| Area | State |
|---|---|
| Margin engine | Pure functions, no I/O, unit-tested |
| Seeded dataset | 62 products, ~500 orders, 8 planted loss-makers, all detected |
| Persistence | Postgres, idempotent upserts keyed on Shopify GIDs |
| Cost ladder | Global %, vendor override, CSV import; precedence verified against live data |
| Cost settings | Global and per-supplier COGS, per-gateway fee rules, shipping cost — save round-trip verified against Postgres |
| Product margin table | Sortable, searchable, paginated; reconciles to the cent |
| Hero view | Ranked losers with cause attribution; one-click onboarding |
| Discounts & refunds | Monthly erosion by code and reason; totals tie back to raw sums |
| Tier gating | Applied as a query bound before any read; export returns 402 on free |
| Adapter | Mock-tested against recorded shapes, plus live delivery of orders/create, orders/updated, refunds/create and products/update on a real store |
| Privacy | Three mandatory webhooks verified live (200 with real HMAC); shop/redact deletion proved by row counts and scoped to one shop; schema asserted free of customer identity |
| Hosting | Railway (Profitkit's Projects, project 22490a45): Postgres + profitkit-app from the Dockerfile, migrations applied on boot |
| Deployed config | App version profitkit-8 — app_url, OAuth redirects, 3 privacy webhooks and 6 subscriptions all at the Railway domain; scopes include read_returns |
| Billing | `billing.check` wired; $29 recurring plan registered |
| Install | Verified on a live store: 17 products, 9 orders backfilled. Claimed once per shop from `afterAuth` *and* the app loader, since token-exchange sessions never call `afterAuth` |

205 tests. Lint and typecheck clean.

## Commands

```bash
shopify app dev --config profitkit   # `npm run dev` omits the config flag
npm test               # 205 unit tests
npm run seed           # regenerate the synthetic dataset (deterministic)
npm run load-seed -- <shop-domain>   # load it into Postgres
npm run reconcile -- <shop-domain>   # prove every reported number ties back
npm run import-cogs -- <file.csv> <shop-domain>
```

Local Postgres runs in Docker as `profitkit-postgres` on port **5433**
(`docker start profitkit-postgres` after a reboot). `DATABASE_URL` is in `.env`.

## Known gaps, in the order they'd hurt

1. **A duplicate Railway project is still running in an unrelated account.**
   Project `47cf1fc3`, under a personal Railway account that is *not* the Profitkit
   one — the first provisioning landed there before the accounts were untangled. It
   still runs a Postgres and an app service, consuming that account's credit, and it
   holds the un-suffixed domain `profitkit-app-production.up.railway.app`, which is
   why the live app answers on `-b46d`. Delete it from that account's own dashboard;
   nothing here depends on it. See `CLAUDE.md` for which account production uses.
2. **Only partly verified against a real store.** Install, backfill, the 60-day
   window, webhook registration and one live webhook delivery are now confirmed
   (`VERIFICATION.md`: 15 of 32 checked, 3 partial). Billing, pagination past 50
   orders, and field fill rates on a store with real trading history are not.
3. **Line items capped at 100 per order, refunds at 20.** No per-order pagination.
   Fine for the target merchant, wrong for a large one.
4. **Collection-level COGS never fires.** Logic and tests exist; collection
   membership isn't ingested, so vendor is the only working group rung.
5. **Exact per-product costs are CLI-only.** `setVariantCogsCents` is reached
   solely by `npm run import-cogs`. A merchant can set a supplier-level percentage in
   cost settings, but has no way to upload a real cost sheet from inside the app.
6. **Listing assets not produced.** Screenshots and the demo video are manual;
   `LISTING.md` says which four screenshots and in what order.
7. **Support email and privacy URL not provisioned.** `PRIVACY.md` must be
   published at a public URL before submission.
8. **Shipping cost has no home of its own.** It's parked in `fee_rules` under a
   reserved pseudo-gateway name to avoid a migration for one integer.
9. **Three routes still hardcode the palette.** `app/styles.ts` now holds the tokens
   and `app.tsx` renders them once, and `app._index.tsx` uses them — but
   `app.products.tsx`, `app.leaks.tsx` and `app.settings.tsx` still carry literal hex
   values in their own `<style>` blocks. Two had already drifted: the hairline rule is
   `#D8DED2` on the product page against `#E4E9E0` everywhere else, and "good" green is
   `#2E5E3A` on the leaks page against `#12603F` on the overview. Sweeping them is a
   restyle of three pages that no automated check can confirm, so it wants a session
   in the admin with eyes on each page, not a find-and-replace.

## Decisions worth not re-litigating

- **An unknown shipping cost drops the shipping term, rather than defaulting to 0.**
  `cost − charged` with cost defaulting to 0 made every shipping charge a gain and
  reported margin above 100% of revenue. A merchant entering 0 explicitly still
  counts the gain — that is a claim about their business, not missing information.
- **The service pins `PORT=3000`.** Railway injects `PORT=8080`, react-router-serve
  honoured it, and the generated domain targets 3000 — so the app served fine while
  every request 502ed. Pinning it keeps the Dockerfile's `EXPOSE`, the domain target
  and the listener in agreement.
- **The install backfill is not awaited.** Holding the OAuth redirect open for a
  60-day paginated pull would look like a hung install. It runs after the redirect
  and the dashboard fills in; `runInstallBackfill` never throws, so it cannot take
  the server down mid-install.
- **`registerWebhooks` is deliberately not called from `afterAuth`.** Subscriptions
  are declared in the toml and registered by `shopify app deploy`, which makes them
  app-specific; `registerWebhooks` exists for shop-specific ones.
- **Shipping delta is `cost − charged`,** not the reverse. HANDOVER's formula bullet
  had the sign inverted, which would have rewarded losing money on shipping.
- **Shopify's `discountAllocations` is trusted, not recomputed.** The field audit
  confirmed it's populated and correct.
- **Shipping cost is split evenly across lines,** not by revenue — it tracks weight,
  and there's no weight field to allocate by.
- **A variant-level cost override outranks Shopify's native `unitCost`.** Both are
  merchant-supplied; the one typed into this app is the more recent statement.
- **A cost above 3× revenue is treated as a data error, not a business result.**
  Such products are held out of the hero ranking and out of the catalog medians,
  so one mistyped spreadsheet cell can't define the view.
- **Loss cause is the cost most out of line with the store's own norms,** not the
  largest cost. Otherwise every product blames cost of goods and the view says
  nothing.
- **Free tier gets less data, not a greyed-out UI.** The 90-day bound is applied
  to the query.

## Operational note

The dev server wedges after server-module changes — pages render their heading but
an empty body. It happened four times during this build, always after a Prisma
schema change or an edit to `shopify.server.ts`, and a restart always fixed it.
If bodies go blank, restart before debugging the code.
