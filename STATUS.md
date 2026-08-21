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
| Seeded dataset | 62 products, ~500 orders, 8 planted loss-makers, **7 detected** — `npm run seed` prints `✗ 1 planted losers were NOT detected: Heritage Candle`, which lands at **+$5.04** (rank 11/62, shipping-driven). The generator plants it but does not push it below zero, so the seed's own self-check fails. Calibration in the generator, not a detection bug — the engine is right that a product earning $5.04 is not losing money |
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
| Overview page | Split from one ~1,550-line route into 24 modules under `app/overview/`; the route is now 250 lines |
| Charts | ApexCharts, dynamically imported so it stays out of the server bundle and its own ~279 kB gzip chunk loads after paint. Sparklines per stat card, horizontal bars for margin by month, with a screen-reader table beside the chart |
| Product images | `imageUrl` column, set during ingestion, with a catch-up query for products ingested before the column existed |

220 tests. Lint, typecheck and the production build clean.

## Commands

```bash
shopify app dev --config profitkit   # `npm run dev` omits the config flag
npm test               # 220 unit tests
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
3. **Refunds and transactions are still capped per order, and cannot be paginated.**
   Line items are fixed: `Order.lineItems` is a real connection, so anything past the
   first 100 is now followed by cursor and nothing is lost — on the webhook re-fetch
   path too, where a truncated re-ingest would have overwritten complete rows with
   partial ones.

   Refunds (20) and transactions (20) are a different shape. `Order.refunds` is
   `[Refund!]!` and `Order.transactions` is `[OrderTransaction!]!` — plain lists whose
   `first` argument is documented as "truncate the array result to this size". There is
   no `pageInfo` and no cursor, so the rest cannot be requested at all. The adapter now
   warns, naming the order, when either array comes back exactly full, which is the
   only signal available that it may be short.

   Raising those two limits is the obvious next step and was deliberately not done
   blind: they sit inside a 50-order page, Shopify prices queries by requested size,
   and inflating them risks trading a rare truncation for a backfill that fails
   outright on cost. That wants measuring against a real store.
4. **Collection-level COGS never fires.** Logic and tests exist; collection
   membership isn't ingested, so vendor is the only working group rung.
5. **Exact per-product costs are CLI-only.** `setVariantCogsCents` is reached
   solely by `npm run import-cogs`. A merchant can set a supplier-level percentage in
   cost settings, but has no way to upload a real cost sheet from inside the app.
6. **Listing assets not produced.** Screenshots and the demo video are manual;
   `LISTING.md` says which four screenshots and in what order.
7. **The marketing site is deployed by CLI, not from git.** Both pages are now correct
   and live — `/privacy` shows `profitkitapp@gmail.com` and `/guide` returns 200 — but
   getting there needed `vercel --prod` run by hand from `marketing/`. **Pushing that
   repo publishes nothing.** A push looked successful while the live site kept serving
   a build old enough to predate the guide page entirely, which is how `/guide` came to
   404 for a page that was committed and building fine. Anyone changing that site must
   deploy it explicitly and then request the URL to confirm.

   Still open: the address is `profitkitapp@gmail.com` because a `vercel.app` subdomain
   cannot receive mail, and the domain itself is a Vercel preview subdomain and so
   temporary. A custom domain means updating `GUIDE_URL` in `app/docs.ts`, the privacy
   URL in `LISTING.md`, and the contact address in three places.
8. **Shipping cost has no home of its own.** It's parked in `fee_rules` under a
   reserved pseudo-gateway name to avoid a migration for one integer.
9. **Three routes still hardcode the palette, and one breaks the colour rule.**
   `app/styles.ts` holds the tokens, `app.tsx` renders them once and `app._index.tsx`
   uses them — but `app.products.tsx`, `app.leaks.tsx` and `app.settings.tsx` still
   carry literal hex values in their own `<style>` blocks. The hairline rule is
   `#D8DED2` on the product page against `#E4E9E0` everywhere else, which is only
   drift. The leaks page is the substantive one: `.pk-ok` paints a paid-back verdict
   green at `app.leaks.tsx:152`, which is the "green means good" the conventions
   forbid — green is the cost ramp, and a figure that moved the right way should be
   ink. The overview had the same bug (`--pk-good: #12603F` on every positive delta)
   and it is fixed there. Sweeping the other three is a restyle no automated check can
   confirm, so it wants a session in the admin with eyes on each page rather than a
   find-and-replace.

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
