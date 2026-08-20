import { parseCostToCents } from "../import/money";
import type { Cents } from "../margin/types";

/**
 * Parsing for the settings form.
 *
 * The UI works in the units a merchant thinks in — 45 for a percentage, 6.50 for
 * money — while storage uses fractions and integer cents. That conversion is the
 * likeliest place for a silent factor-of-100 error, so it lives here with tests
 * rather than inline in a route handler.
 *
 * Money reuses the CSV importer's parser, so a value pasted from a spreadsheet
 * behaves identically whether it arrives through a form or a file.
 */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Blank means "not set" and is a legitimate answer, distinct from a bad value. */
export type MaybeParseResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; error: string };

/**
 * Percentage as typed (45, 2.9) into a fraction (0.45, 0.029).
 *
 * Zero is allowed for fees — plenty of gateways charge nothing per transaction —
 * but not for cost of goods, where zero would silently report revenue as profit.
 */
export function parsePercentInput(
  raw: string,
  options: { allowZero?: boolean } = {},
): ParseResult<number> {
  const trimmed = raw.trim().replace(/%$/, "").trim();
  if (trimmed === "") return { ok: false, error: "Enter a percentage." };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { ok: false, error: `"${raw.trim()}" isn't a number.` };
  if (value < 0) return { ok: false, error: "A percentage can't be negative." };
  if (!options.allowZero && value === 0) {
    return { ok: false, error: "Enter a percentage above zero." };
  }
  // 100% of price as cost is a real (if dire) situation; beyond that it's a typo,
  // most often a fraction entered where a percentage was expected.
  if (value > 100) return { ok: false, error: "Enter a percentage between 0 and 100." };

  // Rounded because `2.9 / 100` is 0.028999999999999998 in binary floating point, and
  // that is the value that would land in the database. It makes no difference once fees
  // are rounded to cents, but a stored figure should read as what the merchant typed.
  // Six places keeps 0.0001% granularity, far finer than any real fee schedule.
  return { ok: true, value: Number((value / 100).toFixed(6)) };
}

/** Money as typed into integer cents. Blank is allowed and means "not set". */
export function parseMoneyInput(raw: string): MaybeParseResult<Cents> {
  if (raw.trim() === "") return { ok: true, value: null };

  const parsed = parseCostToCents(raw);
  if (parsed.error != null || parsed.cents == null) {
    return { ok: false, error: capitalise(parsed.error ?? "Enter an amount.") };
  }
  return { ok: true, value: parsed.cents };
}

/** An optional percentage: blank clears the setting rather than failing. */
export function parseOptionalPercentInput(
  raw: string,
  options: { allowZero?: boolean } = {},
): MaybeParseResult<number> {
  if (raw.trim() === "") return { ok: true, value: null };
  const parsed = parsePercentInput(raw, options);
  return parsed.ok ? { ok: true, value: parsed.value } : parsed;
}

/** Fraction back to a display percentage, without trailing noise like "2.9000". */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction == null) return "";
  return String(Number((fraction * 100).toFixed(2)));
}

/** Cents back to a plain decimal for an input field — no symbol, no separators. */
export function formatMoneyInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function capitalise(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}
