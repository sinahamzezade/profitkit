# Redline

A Shopify app that answers one question: **which products lose you money.**

It looks like analytics. It's a P&L engine — cost of goods, payment fees, the gap
between shipping charged and shipping paid, discounts and refunds → contribution
margin per product.

## Getting started

```bash
npm install
npm test
shopify app dev --config profitkit
```

`--config profitkit` selects `shopify.app.profitkit.toml` (client_id `5243e677…`).
The plain `shopify.app.toml` in this directory belongs to an orphaned app from an
early scaffold attempt and is **not** the app's config.

Local Postgres runs in Docker on port **5433**:

```bash
docker start profitkit-postgres      # after a reboot
```

## Where to start

| Document | What it covers |
|---|---|
| [`STATUS.md`](STATUS.md) | **Current state, known gaps, commands. Read this first.** |
| [`VERIFICATION.md`](VERIFICATION.md) | Pre-submission checklist — what mock tests cannot prove |
| [`LISTING.md`](LISTING.md) | App Store copy, and claims deliberately *not* made |
| [`PRIVACY.md`](PRIVACY.md) | Privacy policy (must be published at a public URL) |
| [`CLAUDE.md`](CLAUDE.md) | Repository orientation |

`HANDOVER.md`, `profitkit-10-day-roadmap.md` and `shopify-margin-app-brief.md` are
the original planning documents and are **historical** — `STATUS.md` supersedes them.

## What Shopify cannot tell us

These shape the whole design and are stated plainly in the UI rather than papered over:

- **Actual shipping cost does not exist in the API** — not null, absent. Always a
  merchant input.
- **Gateway fees are reported only for Shopify Payments,** and only once a payout
  settles. For every other gateway, modelled rules are the only path.
- **Refund reasons exist only via the Returns flow.** A refund issued from the order
  page carries none — usually the majority.
- **`read_orders` sees 60 days.** History accumulates forward from install.

Cost settings (`/app/settings`) is where a merchant supplies the figures Shopify
withholds. Until they do, those costs count as zero and margin reads high.

## Verification

```bash
npm test                                        # unit tests
npm run reconcile -- <shop-domain>              # proves reported numbers tie back to raw rows
```

`reconcile` is the real safety net: it checks that every column identity holds and
that aggregates sum to the underlying rows.

## Not in this repository

The `marketing/` landing page sits one level up, outside this repo. It's a separate
Next.js project with its own git history and its own `.env.local`; tracking it here
would either commit a broken submodule pointer or flatten its history. Register it as
a real submodule if it should live alongside the app.

This app was scaffolded from the [Shopify React Router app
template](https://github.com/Shopify/shopify-app-template-react-router); see
[`AGENTS.md`](AGENTS.md) for the template's own conventions.
