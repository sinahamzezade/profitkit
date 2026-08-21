/**
 * The design tokens, in one place.
 *
 * Declared as a plain object first and turned into the `:root` block below, because
 * the palette now has two consumers with different needs. CSS wants custom
 * properties; ApexCharts wants real colour strings — it renders SVG with the values
 * baked into attributes and cannot read a `var()`. Deriving both from one object is
 * the only arrangement where a chart cannot quietly disagree with the text beside it.
 *
 * Every merchant-facing route ships its own `<style>` block for the things Polaris
 * has no component for — progress bars, ledger rules, layout grids. That is fine and
 * stays. What was not fine is that each block also carried its own copy of the
 * palette, and the copies had already drifted:
 *
 *   - the hairline rule was #E4E9E0 on three pages and #D8DED2 on the product page
 *   - "good" green was #12603F on the overview and #2E5E3A on the leaks page
 *
 * Neither difference was a decision, and neither is visible when you only ever look
 * at one page at a time.
 *
 * The remaining literal hex values in app.products.tsx, app.leaks.tsx and
 * app.settings.tsx have deliberately NOT been swept into these variables — that is a
 * restyle of three pages that cannot be checked without a Shopify session, and a
 * blind sweep is how you ship a page nobody looked at. See STATUS.md gap 9.
 *
 * Two rules from the project conventions are load-bearing here:
 *
 *   - **Red means loss, and only loss.** Not "worse than last period", not a warning,
 *     not an accent.
 *   - **Green is never "good".** It is the ledger paper and the cost ramp
 *     (`#212B1B → #47573E → #6E8064 → #9BAD90`, always COGS · fees · shipping ·
 *     refunds), where position identifies a cost as much as tone does.
 *
 * So there is no `good` token. A figure that moved the right way is drawn in ink like
 * any other figure; only the ones that are actually losses are red. An earlier version
 * of this file had a bright `--pk-good: #12603F` colouring every positive delta, which
 * is exactly the "green means good" this app does not do.
 */
export const PK_COLORS = {
  /* text */
  ink: "#10160F",
  body: "#4A5348",
  muted: "#6B7367",
  faint: "#96A08F",

  /* lines and fills */
  rule: "#E4E9E0",
  hair: "#EFF2ED",
  track: "#F1F4EE",

  /* data */
  bar: "#47573E",
  loss: "#B3261E",
} as const;

/** `{ ink: "#10160F" }` becomes `--pk-ink: #10160F;`. */
const customProperties = Object.entries(PK_COLORS)
  .map(([name, value]) => `    --pk-${name}: ${value};`)
  .join("\n");

export const PK_TOKENS = `
  :root {
${customProperties}
  }

  /* Numbers in a column must line up, or the eye cannot compare them. */
  .num { font-variant-numeric: tabular-nums; }

  .pk-up { color: var(--pk-ink); }
  .pk-down { color: var(--pk-loss); }
`;
