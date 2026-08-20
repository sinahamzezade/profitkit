import type { Cents } from "../margin/types";
import type { CogsEntry, CogsTarget, ResolvedCogs } from "./types";

function applyEntry(entry: CogsEntry, priceCents: Cents): Cents | null {
  if (entry.costCents != null) return entry.costCents;
  if (entry.costPercent != null) return Math.round(priceCents * entry.costPercent);
  return null;
}

/**
 * Resolves one variant's COGS through the ladder.
 *
 * Precedence: variant override > native unitCost > collection > vendor > global.
 *
 * A variant-level entry outranks Shopify's native cost field on purpose: both are
 * merchant-supplied, but the one typed into this app is the more recent statement
 * of intent, and a merchant correcting a stale Shopify cost has nowhere else to put it.
 *
 * Only two things count as non-estimated: the native field, and a variant override
 * given as an absolute amount. A variant-level *percentage* is still a guess about
 * that variant, so it stays flagged — the whole point of the flag is that a merchant
 * can tell which numbers they can trust to the cent.
 *
 * Returns source "none" with zero cents when nothing is configured. Callers must not
 * treat that as "this product costs nothing to make" — it means the ladder is empty,
 * and margin computed from it is revenue, not profit.
 */
export function resolveCogs(target: CogsTarget, entries: CogsEntry[]): ResolvedCogs {
  const variantEntry = entries.find(
    (e) => e.scope === "variant" && e.scopeKey === target.variantGid,
  );
  if (variantEntry) {
    const cents = applyEntry(variantEntry, target.priceCents);
    if (cents != null) {
      return {
        cents,
        estimated: variantEntry.costCents == null,
        source: "variant_override",
      };
    }
  }

  if (target.nativeCogsCents != null) {
    return { cents: target.nativeCogsCents, estimated: false, source: "native" };
  }

  // Collection before vendor: a merchant who bothered to group by collection has
  // made the more deliberate statement, and collections are usually narrower.
  const collectionEntry = entries.find(
    (e) => e.scope === "collection" && e.scopeKey != null && target.collectionIds.includes(e.scopeKey),
  );
  if (collectionEntry) {
    const cents = applyEntry(collectionEntry, target.priceCents);
    if (cents != null) return { cents, estimated: true, source: "collection" };
  }

  const vendorEntry = entries.find(
    (e) => e.scope === "vendor" && e.scopeKey != null && e.scopeKey === target.vendor,
  );
  if (vendorEntry) {
    const cents = applyEntry(vendorEntry, target.priceCents);
    if (cents != null) return { cents, estimated: true, source: "vendor" };
  }

  const globalEntry = entries.find((e) => e.scope === "global");
  if (globalEntry) {
    const cents = applyEntry(globalEntry, target.priceCents);
    if (cents != null) return { cents, estimated: true, source: "global" };
  }

  return { cents: 0, estimated: true, source: "none" };
}

/** True when the shop has any usable rung configured — drives the onboarding empty state. */
export function hasAnyCogsConfigured(entries: CogsEntry[]): boolean {
  return entries.some((e) => e.costCents != null || e.costPercent != null);
}
