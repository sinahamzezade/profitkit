import type { Cents } from "../margin/types";

export interface MoneyParseResult {
  cents: Cents | null;
  error: string | null;
  /** Set when the input parsed, but a separator was genuinely ambiguous. Doesn't block import. */
  warning: string | null;
}

/**
 * Parses a cost cell out of a merchant spreadsheet. Handles currency symbols,
 * codes, spaces, and both decimal conventions.
 *
 * The comma/period problem is real: "1,234" is 1234 to a US merchant and 1.234
 * to a German one. Rules applied, in order:
 *   - both separators present → the rightmost one is the decimal separator
 *   - only a comma, followed by exactly 3 digits → thousands ("1,234" = 1234)
 *   - only a comma, followed by 1-2 digits → decimal ("12,50" = 12.50)
 *   - only a period → decimal, US/Shopify default, but a 3-digit group after it
 *     is flagged as a warning because "1.234" is genuinely undecidable
 */
export function parseCostToCents(raw: string): MoneyParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { cents: null, error: "missing cost", warning: null };
  }

  // Strip currency symbols, ISO codes, and spaces — keep digits, separators, sign.
  const stripped = trimmed
    .replace(/[\p{Sc}]/gu, "")
    .replace(/[A-Za-z]/g, "")
    .replace(/\s/g, "");

  if (stripped === "" || !/\d/.test(stripped)) {
    return { cents: null, error: `not a number: "${trimmed}"`, warning: null };
  }

  const negative = stripped.startsWith("-") || /^\(.*\)$/.test(stripped);
  const unsigned = stripped.replace(/^[-+]/, "").replace(/^\((.*)\)$/, "$1");

  if (!/^[\d.,]+$/.test(unsigned)) {
    return { cents: null, error: `not a number: "${trimmed}"`, warning: null };
  }

  const lastComma = unsigned.lastIndexOf(",");
  const lastPeriod = unsigned.lastIndexOf(".");
  let normalized: string;
  let warning: string | null = null;

  if (lastComma >= 0 && lastPeriod >= 0) {
    const decimalSep = lastComma > lastPeriod ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = unsigned.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    const after = unsigned.length - lastComma - 1;
    const groups = unsigned.split(",");
    if (after === 3 && groups.slice(1).every((g) => g.length === 3)) {
      normalized = groups.join("");
    } else if (after === 1 || after === 2) {
      normalized = unsigned.replace(",", ".");
    } else {
      return { cents: null, error: `ambiguous number: "${trimmed}"`, warning: null };
    }
  } else if (lastPeriod >= 0) {
    const after = unsigned.length - lastPeriod - 1;
    const groups = unsigned.split(".");
    if (groups.length > 2) {
      // "1.234.567" can only be thousands separators.
      normalized = groups.join("");
    } else {
      normalized = unsigned;
      if (after === 3) {
        warning = `"${trimmed}" read as ${unsigned} — if this meant thousands, re-upload with a decimal point`;
      }
    }
  } else {
    normalized = unsigned;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { cents: null, error: `not a number: "${trimmed}"`, warning: null };
  }
  if (negative) {
    return { cents: null, error: `cost cannot be negative: "${trimmed}"`, warning: null };
  }

  return { cents: Math.round(value * 100), error: null, warning };
}
