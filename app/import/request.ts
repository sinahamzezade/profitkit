import { parseCsv } from "./csv";
import type { ColumnMapping, ValidationSummary } from "./cogsImport";

/**
 * The decisions the import screen makes before it touches the database.
 *
 * Split out of the route so they can be tested the way everything else here is —
 * as pure functions. The route keeps only what genuinely needs a session and a
 * database: load the catalog, validate against it, commit. This file is why that
 * route has no need of a Prisma mock.
 */

/** Rows past this are refused rather than validated, so one paste cannot pin a worker. */
export const MAX_ROWS = 5_000;

/** ~4 MB of CSV. Far beyond any real cost sheet, well inside a request body. */
export const MAX_TEXT_BYTES = 4_000_000;

/**
 * Header row of the downloadable cost template.
 *
 * These exact names are what make the template import with no mapping step: `sku`
 * and `cost` are exact matches in the importer's hint lists, and `variant_id`
 * normalises to "variantid" which is too. `product` matches no hint, so the importer
 * ignores it — it is there for the human filling the file in, and a title is never
 * matched on because titles repeat.
 *
 * Shared with the template route so the two cannot drift, and asserted in
 * request.test.ts: renaming a column here without checking would quietly put the
 * merchant back on the mapping screen.
 */
export const TEMPLATE_HEADERS = ["sku", "variant_id", "product", "cost"] as const;

/** Index of the column a merchant fills in, for building template rows. */
export const TEMPLATE_COST_INDEX = TEMPLATE_HEADERS.indexOf("cost");

export type PreparedImport =
  | { ok: false; error: string }
  | { ok: true; headers: string[]; rows: string[][]; delimiter: string };

/**
 * Parses the uploaded text and refuses anything that should not reach validation.
 *
 * Order matters: an empty file, an oversized one and a headerless one all produce
 * different advice, and a merchant who picked the wrong file wants to be told that
 * rather than shown four thousand match failures.
 */
export function prepareImport(text: string): PreparedImport {
  if (text.trim() === "") {
    return { ok: false, error: "That file looks empty." };
  }
  if (text.length > MAX_TEXT_BYTES) {
    return {
      ok: false,
      error:
        `That file is larger than ${Math.round(MAX_TEXT_BYTES / 1_000_000)} MB. ` +
        `Cost sheets are usually a few hundred kilobytes — check it is the right file.`,
    };
  }

  const { headers, rows, delimiter } = parseCsv(text);

  if (headers.length === 0) {
    return { ok: false, error: "No header row found." };
  }
  if (rows.length > MAX_ROWS) {
    return {
      ok: false,
      error:
        `That file has ${rows.length.toLocaleString()} rows and the limit is ` +
        `${MAX_ROWS.toLocaleString()}. Split it and import in parts.`,
    };
  }

  return { ok: true, headers, rows, delimiter };
}

/**
 * Turns the three mapping form fields into a `ColumnMapping`.
 *
 * A select can only carry a string, and "" means the merchant chose "not in this
 * file". Anything that is not a non-negative integer becomes null rather than
 * NaN — a mapping index that silently became NaN would read every row's cost as
 * blank and report the whole file as broken.
 */
export function readMapping(values: {
  sku?: string | null;
  variantId?: string | null;
  cost?: string | null;
}): ColumnMapping {
  const index = (raw: string | null | undefined) => {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  return {
    sku: index(values.sku),
    variantId: index(values.variantId),
    cost: index(values.cost),
  };
}

/** Why a mapping cannot be validated yet, or null when it is usable. */
export function mappingError(mapping: ColumnMapping): string | null {
  if (mapping.cost == null) return "Choose which column holds the cost.";
  if (mapping.sku == null && mapping.variantId == null) {
    return "Choose a SKU column or a variant ID column so rows can be matched.";
  }
  return null;
}

/**
 * Cap on rows shown in the problem table.
 *
 * A mis-mapped column makes every row an error, and a merchant does not need four
 * thousand of them to learn that. The counts above the table stay exact.
 */
export const PROBLEM_LIMIT = 50;

export interface ImportProblem {
  line: number;
  status: "error" | "warning";
  detail: string;
}

export function describeProblems(summary: ValidationSummary): ImportProblem[] {
  return summary.rows
    .filter((r) => r.status === "error" || r.warning != null)
    .slice(0, PROBLEM_LIMIT)
    .map((r) => ({
      line: r.line,
      status: r.status === "error" ? "error" : "warning",
      detail: r.message ?? r.warning ?? "",
    }));
}

/** Total rows worth the merchant's attention, uncapped, for the count above the table. */
export function countProblems(summary: ValidationSummary): number {
  return summary.rows.filter((r) => r.status === "error" || r.warning != null).length;
}

/** Names the separator in words. "separated by tabs" beats `separated by "\t"`. */
export function describeDelimiter(delimiter: string): string {
  if (delimiter === ",") return "commas";
  if (delimiter === ";") return "semicolons";
  if (delimiter === "\t") return "tabs";
  if (delimiter === "|") return "pipes";
  return `"${delimiter}"`;
}
