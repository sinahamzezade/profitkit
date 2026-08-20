---
name: reload-seed
description: Wipe and reload the seeded dataset for a shop, then prove the numbers tie back. Use when seed data looks wrong or after changing the generator.
disable-model-invocation: true
---

# Reload the seeded dataset

Rebuilds a shop's data from the deterministic generator and verifies it.

## Why the delete matters

`load-seed` **upserts**. It never removes anything. If the generator's random stream
has shifted — which happens whenever a `rng` call is added, removed or reordered —
line-item GIDs get reassigned to different products while their old refund rows stay
attached to them.

That produced a real bug: a product showing **refunds exceeding its own revenue**, and
a hero view claiming "123% of its revenue came back as refunds". Nothing in the code
was wrong; the data was stale.

**Always delete the shop first.** Reloading on top of existing rows is how that bug
gets recreated.

## Steps

Run from `profikit/`. Take the shop domain as an argument; default to
`first-test-zenmt2u1.myshopify.com`.

1. **Delete the shop.** Cascades to products, variants, orders, lines, refunds and
   the merchant's cost configuration.

   ```bash
   docker exec profitkit-postgres psql -U postgres -d profitkit \
     -c "DELETE FROM shops WHERE domain='<domain>';"
   ```

   If that fails with a connection error, the database container is stopped:
   `docker start profitkit-postgres`

2. **Reload.** Regenerates the catalog and orders, ingests them, and prints the
   cost-ladder demonstration.

   ```bash
   npm run load-seed -- <domain>
   ```

   Confirm it reports `✓ Replay was a no-op — idempotency holds.`

3. **Verify.** This is the real check, not step 2.

   ```bash
   npm run reconcile -- <domain>
   ```

   Confirm all three:
   - every row satisfies the column identity
   - sampled products match an independent recount
   - erosion buckets tie back to raw totals

4. **Sanity-check for the stale-data signature.** Should return `0`:

   ```bash
   docker exec profitkit-postgres psql -U postgres -d profitkit -c "
   SELECT count(*) FROM (
     SELECT p.id,
       SUM(ol.\"originalTotalCents\" - ol.\"discountAllocatedCents\") AS net_rev,
       (SELECT COALESCE(SUM(r.\"subtotalCents\"),0) FROM refunds r
        JOIN order_lines ol2 ON ol2.id=r.\"orderLineId\"
        JOIN variants v2 ON v2.id=ol2.\"variantId\" WHERE v2.\"productId\"=p.id) AS refunds
     FROM products p JOIN variants v ON v.\"productId\"=p.id
     JOIN order_lines ol ON ol.\"variantId\"=v.id
     JOIN shops s ON s.id=p.\"shopId\"
     WHERE s.domain='<domain>' GROUP BY p.id
   ) t WHERE refunds > net_rev;"
   ```

## Notes

- The generator is deterministic (seed `42`), so the same code always produces the
  same dataset. A changed dataset means the generator changed.
- Loading under a real dev-store domain mixes synthetic data with that store's genuine
  orders. That's intentional for viewing the UI with realistic volume, but say so when
  reporting results — the totals are not the store's real trading figures.
