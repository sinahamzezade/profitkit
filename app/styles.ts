/**
 * The design tokens, in one place, rendered once by the app layout.
 *
 * Every merchant-facing route ships its own `<style>` block for the things Polaris
 * has no component for — bar charts, sparklines, progress bars, ledger rules. That
 * is fine and stays. What was not fine is that each block also carried its own copy
 * of the palette, and the copies had already drifted:
 *
 *   - the hairline rule was #E4E9E0 on three pages and #D8DED2 on the product page
 *   - "good" green was #12603F on the overview and #2E5E3A on the leaks page
 *
 * Neither difference was a decision, and neither is visible when you only ever look
 * at one page at a time. Tokens live here now so a change to the palette is one
 * edit rather than four, and so the next drift is impossible rather than merely
 * unlikely.
 *
 * The remaining literal hex values in app.products.tsx, app.leaks.tsx and
 * app.settings.tsx have deliberately NOT been swept into these variables — that is
 * a restyle of three pages that cannot be checked without a Shopify session, and a
 * blind sweep is how you ship a page nobody looked at. They are listed in STATUS.md
 * instead.
 *
 * Loss red is the only accent. Green appears only as the counterpart to it on a
 * signed figure, never as decoration.
 */
export const PK_TOKENS = `
  :root {
    /* text */
    --pk-ink:    #10160F;
    --pk-body:   #4A5348;
    --pk-muted:  #6B7367;
    --pk-faint:  #96A08F;

    /* lines and fills */
    --pk-rule:   #E4E9E0;
    --pk-hair:   #EFF2ED;
    --pk-track:  #F1F4EE;

    /* data */
    --pk-bar:    #47573E;
    --pk-loss:   #B3261E;
    --pk-good:   #12603F;
  }

  /* Numbers in a column must line up, or the eye cannot compare them. */
  .num { font-variant-numeric: tabular-nums; }

  .pk-up { color: var(--pk-ink); }
  .pk-down { color: var(--pk-loss); }
`;
