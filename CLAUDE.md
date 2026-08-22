@AGENTS.md

# Redline — repository root

This directory is the repository root. Run every npm script from here.

```bash
npm test
npm run reconcile -- first-test-zenmt2u1.myshopify.com
shopify app dev --config profitkit
```

## The product is Redline. The infrastructure is still called profitkit

Renamed from Profitkit because three apps in the same category had near-identical
names — a competitor at `profitkit.app`, and "Profiti: Profit Analytics" which already
ranked for a Profitkit search. Shopify's own rule is that a name must not be "similar
enough that merchants could mistake it for another app", so the collision was a
submission risk, not just a marketing one.

**Only the brand was renamed.** Every string below names a live external resource and
would break something if edited to match:

| Still says `profitkit` | Why |
|---|---|
| `shopify.app.profitkit.toml`, `--config profitkit` | Config selector. Every command and hook passes it |
| `profitkit-app-production-b46d.up.railway.app` | Still attached to the service and still serving. No longer `application_url` — see below — but kept as a redirect URL through the cutover |
| Railway project / service, `profitkit-postgres`, the `profitkit` database | Live infrastructure |
| `profitkitapp@gmail.com` | A real mailbox — the support address and the Partner account |
| `profitkit.vercel.app` | Still an alias of the marketing site. No longer the published URL |

## The domain

`redlineapp.tech`, DNS on Cloudflare (`alan`/`gail.ns.cloudflare.com`).

| Host | Points at | Cloudflare proxy |
|---|---|---|
| `redlineapp.tech`, `www` | Vercel — the marketing site | **Proxied.** Works; leave it |
| `app.redlineapp.tech` | Railway — the embedded app | **DNS only.** Required: Railway issues its own Let's Encrypt cert, and proxying breaks the ACME challenge |

Two traps live in this zone:

- **A wildcard `*.redlineapp.tech` A record points at Vercel.** Before `app` had its
  own CNAME, `app.redlineapp.tech` resolved to Vercel and failed TLS. An exact-match
  record shadows the wildcard, so `app` is fine — but any *new* subdomain will silently
  land on Vercel until it gets its own record. Deleting the wildcard is the real fix and
  has not been done.
- Railway needs a `TXT _railway-verify.app` record as well as the CNAME. Losing it
  breaks certificate renewal, not just the initial issue.

So a bare `profitkit` in this repo is infrastructure, and `Profitkit` capitalised is a
leftover brand reference that should have become Redline. The folder name is
`profikit`, missing a `t`, and predates all of it.

The Partner Dashboard display name comes from `name` in the toml and updates on
`shopify app deploy`. **Deployed as of app version `redline-12`** — the version prefix
is itself the confirmation, since it is derived from the app's name.

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
| `redline-10-day-roadmap.md` | Original build plan, also historical |
| `shopify-margin-app-brief.md` | Market research and positioning |
| `redline-field-audit.graphql` | The Admin API field-availability audit |

The `marketing/` landing page lives one directory up, outside this repository. It has
its own git history and its own `.env.local`, so it is deliberately not tracked here.

## Deployment

Production runs on Railway under **Profitkit's Projects** (`profitkitapp@gmail.com`):
project `profitkit`, service `profitkit-app` built from the `Dockerfile`, plus a
Postgres service. `DATABASE_URL` is a reference to that service, not a copied string.

**Check `railway whoami` before any Railway work.** It must report
`profitkitapp@gmail.com`. The first provisioning went to a different personal account
purely because that was the account the CLI happened to be signed into, which created
a duplicate project invisible from the dashboard this app is managed from. Do not
assume the signed-in account is the right one — the browser can silently reuse the
wrong session too.

```bash
railway whoami                       # must be profitkitapp@gmail.com
railway logs --service profitkit-app
railway up --detach --service profitkit-app -m "<summary>"
```

`SHOPIFY_API_SECRET` lives only in Railway's variable UI. It is 38 characters with an
`shpss_` prefix; a truncated value does not error, it loops on 401 looking like a
session bug. `shopify app env show` is the authoritative source.

## Local dependencies

Postgres runs in Docker as `profitkit-postgres` on port **5433**. After a reboot:

```bash
docker start profitkit-postgres
```
