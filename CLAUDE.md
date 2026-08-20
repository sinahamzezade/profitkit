@AGENTS.md

# Profitkit — repository root

This directory is the repository root. Run every npm script from here.

```bash
npm test
npm run reconcile -- first-test-zenmt2u1.myshopify.com
shopify app dev --config profitkit
```

Note the directory name is `profikit`, missing a `t`. The app, the product and the
Shopify config are all spelled `profitkit`; only the folder is misspelled.

## Which config the CLI uses

There are two `shopify.app*.toml` files here. **`shopify.app.toml` is not the app's
config.** It's a leftover from an orphaned Shopify app (client_id `9ce3b0ec…`) created
during an early scaffold attempt, and its name makes it look canonical.

The real config is `shopify.app.profitkit.toml` (client_id `5243e677…`), which is what
`--config profitkit` selects. Deleting the stray file would be safe, but it has been
left alone rather than touched without asking.

## What's here

| Path | What it is |
|---|---|
| `app/` | The Shopify app — routes, margin engine, reports, cost ladder |
| `prisma/` | Schema and migrations |
| `scripts/` | Seeding, reconciliation, CSV import |
| `STATUS.md` | **Current state, known gaps, commands. Start here.** |
| `VERIFICATION.md` | Pre-submission checklist — what mocks cannot prove |
| `LISTING.md` | App Store copy, plus claims deliberately not made |
| `PRIVACY.md` | Privacy policy (needs publishing at a public URL) |
| `HANDOVER.md` | Pre-build planning notes. **Historical** — superseded by `STATUS.md` |
| `profitkit-10-day-roadmap.md` | Original build plan, also historical |
| `shopify-margin-app-brief.md` | Market research and positioning |
| `profitkit-field-audit.graphql` | The Admin API field-availability audit |

The `marketing/` landing page lives one directory up, outside this repository. It has
its own git history and its own `.env.local`, so it is deliberately not tracked here.

## Local dependencies

Postgres runs in Docker as `profitkit-postgres` on port **5433**. After a reboot:

```bash
docker start profitkit-postgres
```
