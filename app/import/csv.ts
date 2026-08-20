/**
 * Minimal RFC 4180 CSV reader. Written by hand rather than pulled from a package
 * because the failure modes here are the whole feature: a merchant's spreadsheet
 * export is the messiest input this app accepts, and a parser that silently drops
 * a quoted field takes a cost with it.
 */

export interface ParsedCsv {
  headers: string[];
  /** Data rows, excluding the header. Ragged rows are preserved as-is; validation decides what to do. */
  rows: string[][];
  delimiter: string;
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

/**
 * Picks the delimiter that yields the most consistent column count across the
 * first few lines. Counting occurrences alone gets fooled by a comma inside a
 * quoted product title.
 */
export function detectDelimiter(text: string): string {
  const sample = stripBom(text).split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 10);
  if (sample.length === 0) return ",";

  let best = ",";
  let bestScore = -1;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sample.map((line) => splitLineRespectingQuotes(line, delimiter).length);
    const columns = counts[0];
    if (columns < 2) continue;
    const consistent = counts.every((c) => c === columns);
    // Consistency first, then column count as the tie-breaker.
    const score = (consistent ? 1000 : 0) + columns;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function splitLineRespectingQuotes(line: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const cleaned = stripBom(text);
  const actualDelimiter = delimiter ?? detectDelimiter(cleaned);

  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = "";
  };
  const pushRow = () => {
    current.push(field);
    field = "";
    rows.push(current);
    current = [];
  };

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (inQuotes) {
      if (char === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === actualDelimiter) {
      pushField();
    } else if (char === "\r") {
      // Swallow; the \n that follows ends the row. A lone \r also ends it.
      if (cleaned[i + 1] === "\n") i++;
      pushRow();
    } else if (char === "\n") {
      pushRow();
    } else {
      field += char;
    }
  }

  // Trailing field, unless the file ended exactly on a row break.
  if (field !== "" || current.length > 0) pushRow();

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows, delimiter: actualDelimiter };
}

/** True when every cell is empty or whitespace — a blank line in the merchant's export. */
export function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

/** Quotes a value for CSV output, for the downloadable error report. */
export function toCsvValue(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(toCsvValue).join(",")];
  for (const row of rows) lines.push(row.map(toCsvValue).join(","));
  return lines.join("\n");
}
