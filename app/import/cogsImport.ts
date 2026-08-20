import type { Cents } from "../margin/types";
import { isBlankRow, toCsv } from "./csv";
import { parseCostToCents } from "./money";

/**
 * Rung 3 of the cost-assumptions ladder: a merchant's own cost spreadsheet.
 *
 * Two rules from the brief drive the whole design. Never assume header names —
 * every file gets an explicit column mapping, suggested but always overridable.
 * And never match on product title: titles are not unique, not stable, and a
 * wrong match writes a wrong cost onto a real product silently. SKU first,
 * variant id second, nothing else.
 */

export interface ColumnMapping {
  /** Index of the SKU column, or null if the file has none. */
  sku: number | null;
  /** Index of the variant-id column, or null. */
  variantId: number | null;
  /** Index of the cost column. Required. */
  cost: number | null;
}

export interface CatalogEntry {
  variantGid: string;
  sku: string | null;
  /** Used only to sanity-check imported costs. Optional so matching works without it. */
  priceCents?: Cents;
}

export type RowStatus = "matched" | "skipped" | "error";

export interface ValidatedRow {
  /** 1-based line number in the original file, counting the header as line 1. */
  line: number;
  status: RowStatus;
  variantGid: string | null;
  costCents: Cents | null;
  message: string | null;
  warning: string | null;
  raw: string[];
}

export interface ValidationSummary {
  rows: ValidatedRow[];
  matched: number;
  skipped: number;
  errored: number;
  /** Variants in the catalog that the file never mentioned — useful as a coverage figure. */
  unmatchedCatalogCount: number;
}

const SKU_HINTS = ["sku", "variantsku", "itemsku", "skucode", "code", "articlenumber"];
const VARIANT_ID_HINTS = ["variantid", "variant", "variantgid", "id", "shopifyvariantid"];
const COST_HINTS = ["cost", "unitcost", "cogs", "costperitem", "costprice", "buyprice", "wholesale"];

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeader(headers: string[], hints: string[]): number | null {
  const normalized = headers.map(normalizeHeader);
  // Exact match first, so "cost" beats "costcenter" when both exist.
  for (const hint of hints) {
    const exact = normalized.indexOf(hint);
    if (exact !== -1) return exact;
  }
  for (const hint of hints) {
    const partial = normalized.findIndex((h) => h.includes(hint));
    if (partial !== -1) return partial;
  }
  return null;
}

/**
 * Best-guess mapping for the column-mapping UI to pre-fill. Deliberately a
 * suggestion, never applied on its own — a file whose columns are in an
 * unexpected order should land the merchant on a confirmation screen, not on
 * a silently wrong import.
 */
export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const sku = findHeader(headers, SKU_HINTS);
  const variantId = findHeader(headers, VARIANT_ID_HINTS);
  return {
    sku,
    // Guard against one column being claimed twice, e.g. a lone "sku" header
    // matching the VARIANT_ID_HINTS "id" substring rule.
    variantId: variantId === sku ? null : variantId,
    cost: findHeader(headers, COST_HINTS),
  };
}

export function validateImport(
  rows: string[][],
  mapping: ColumnMapping,
  catalog: CatalogEntry[],
  /**
   * Header count, when known. A row with *more* fields than headers means a
   * delimiter appeared unquoted inside a value — classically a European decimal
   * comma in a comma-delimited file. Every column past that point is shifted, so
   * the cost read out of it would be silently wrong. Fewer fields is harmless:
   * exporters routinely drop trailing empties.
   */
  expectedColumns?: number,
): ValidationSummary {
  if (mapping.cost == null) {
    throw new Error("A cost column must be mapped before validation.");
  }
  if (mapping.sku == null && mapping.variantId == null) {
    throw new Error("Either a SKU column or a variant-id column must be mapped.");
  }

  // SKUs are matched case-insensitively and trimmed; merchants' exports are inconsistent
  // about both. A SKU appearing on more than one variant can't be matched safely.
  const bySku = new Map<string, CatalogEntry[]>();
  for (const entry of catalog) {
    if (!entry.sku) continue;
    const key = entry.sku.trim().toLowerCase();
    if (key === "") continue;
    const list = bySku.get(key);
    if (list) list.push(entry);
    else bySku.set(key, [entry]);
  }
  const byVariantGid = new Map(catalog.map((e) => [e.variantGid, e]));

  const validated: ValidatedRow[] = [];
  const claimedBy = new Map<string, number>();

  rows.forEach((raw, index) => {
    const line = index + 2; // +1 for zero-index, +1 for the header row
    const cell = (i: number | null) => (i == null ? "" : (raw[i] ?? "").trim());

    if (isBlankRow(raw)) {
      validated.push({
        line,
        status: "skipped",
        variantGid: null,
        costCents: null,
        message: "blank row",
        warning: null,
        raw,
      });
      return;
    }

    if (expectedColumns != null && raw.length > expectedColumns) {
      validated.push({
        line,
        status: "error",
        variantGid: null,
        costCents: null,
        message:
          `row has ${raw.length} values but the file has ${expectedColumns} columns — ` +
          "a value probably contains an unquoted delimiter",
        warning: null,
        raw,
      });
      return;
    }

    const skuValue = cell(mapping.sku);
    const variantIdValue = cell(mapping.variantId);
    const costValue = cell(mapping.cost);

    let variantGid: string | null = null;
    let matchError: string | null = null;

    if (skuValue !== "") {
      const candidates = bySku.get(skuValue.toLowerCase());
      if (!candidates) {
        matchError = `no product with SKU "${skuValue}"`;
      } else if (candidates.length > 1) {
        matchError = `SKU "${skuValue}" is on ${candidates.length} variants — can't tell which one`;
      } else {
        variantGid = candidates[0].variantGid;
      }
    }

    // Variant id is the fallback, and also the rescue when a SKU didn't match.
    if (variantGid == null && variantIdValue !== "") {
      const byId = byVariantGid.get(variantIdValue);
      if (byId) {
        variantGid = byId.variantGid;
        matchError = null;
      } else if (matchError == null) {
        matchError = `no variant with id "${variantIdValue}"`;
      }
    }

    if (variantGid == null && matchError == null) {
      matchError = "row has neither a SKU nor a variant id";
    }

    if (matchError != null) {
      validated.push({
        line,
        status: "error",
        variantGid: null,
        costCents: null,
        message: matchError,
        warning: null,
        raw,
      });
      return;
    }

    const parsed = parseCostToCents(costValue);
    if (parsed.error != null || parsed.cents == null) {
      validated.push({
        line,
        status: "error",
        variantGid,
        costCents: null,
        message: parsed.error ?? "missing cost",
        warning: null,
        raw,
      });
      return;
    }

    // Two rows setting different costs for one variant is a contradiction in the
    // file, not something to resolve by picking whichever came last.
    const previousLine = claimedBy.get(variantGid!);
    if (previousLine != null) {
      validated.push({
        line,
        status: "error",
        variantGid,
        costCents: parsed.cents,
        message: `variant already given a cost on line ${previousLine}`,
        warning: null,
        raw,
      });
      return;
    }
    claimedBy.set(variantGid!, line);

    // A cost far above price is usually a misread separator or a wrong column, and
    // it lands the product straight at the top of the "losing you money" view. Warn
    // rather than reject: clearance stock really does sell below cost.
    const matchedEntry = byVariantGid.get(variantGid!);
    const price = matchedEntry?.priceCents;
    let warning = parsed.warning;
    if (warning == null && price != null && price > 0 && parsed.cents > price * 3) {
      warning =
        `cost ${(parsed.cents / 100).toFixed(2)} is more than 3x the price ` +
        `${(price / 100).toFixed(2)} — check the column and decimal separator`;
    }

    validated.push({
      line,
      status: "matched",
      variantGid,
      costCents: parsed.cents,
      message: null,
      warning,
      raw,
    });
  });

  const matched = validated.filter((r) => r.status === "matched").length;
  const skipped = validated.filter((r) => r.status === "skipped").length;
  const errored = validated.filter((r) => r.status === "error").length;

  return {
    rows: validated,
    matched,
    skipped,
    errored,
    unmatchedCatalogCount: catalog.length - claimedBy.size,
  };
}

/**
 * The rows that will actually be written. Partial import is the default: three
 * bad rows must never cost a merchant the other nine hundred.
 */
export function importableRows(summary: ValidationSummary) {
  return summary.rows
    .filter((r) => r.status === "matched" && r.variantGid != null && r.costCents != null)
    .map((r) => ({ variantGid: r.variantGid!, costCents: r.costCents! }));
}

/**
 * Downloadable report of everything that didn't import cleanly, including the
 * original row so the merchant can fix it in place and re-upload.
 */
export function buildErrorReportCsv(
  summary: ValidationSummary,
  originalHeaders: string[],
): string | null {
  const problems = summary.rows.filter(
    (r) => r.status === "error" || (r.status === "matched" && r.warning != null),
  );
  if (problems.length === 0) return null;

  const headers = ["line", "status", "problem", ...originalHeaders];
  const rows = problems.map((r) => [
    String(r.line),
    r.status === "error" ? "not imported" : "imported with warning",
    r.message ?? r.warning ?? "",
    ...r.raw,
  ]);
  return toCsv(headers, rows);
}
