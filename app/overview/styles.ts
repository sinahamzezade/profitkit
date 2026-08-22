/*
 * What this page needs and the Polaris web components do not ship.
 *
 * Anything Polaris draws — cards, buttons, banners, text fields, icons, menus — is
 * left to Polaris. What remains is the progress bar, the bar charts, the sparkline
 * rail and the layout grids, none of which exist in the component set (checked
 * against @shopify/polaris-types: 50 s-* tags, and no chart, progress, collapse or
 * checklist among them).
 *
 * The palette itself is not here. It lives in app/styles.ts and is rendered once by
 * the app layout, because four routes each keeping their own copy had already let
 * two of the colours drift apart.
 */
export const PK_STYLES = `
  /*
   * One entrance, staggered by --i. Off for anyone who asked for less motion.
   *
   * Transform only — deliberately NOT opacity, and this is the important part.
   *
   * It animated opacity from 0 with fill-mode both, which holds the from-state
   * during the delay. CSS animations do not advance while a page produces no
   * frames, and
   * an admin iframe in an unfocused window produces none — so the cards sat at
   * opacity 0 indefinitely and the dashboard rendered its heading above a blank
   * space. Caught it while taking listing screenshots: three cards were empty until
   * the window was clicked, then all four appeared at once. It is very likely the
   * intermittent "blank body" this app has shown before and that nothing explained.
   *
   * Animating transform alone makes the worst case a 6px offset rather than
   * invisible content. Nothing readable is ever gated on an animation completing.
   */
  @keyframes pk-rise {
    from { transform: translateY(6px); }
    to   { transform: none; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .pk-stat,
    .pk-widget,
    .pk-blotter {
      animation: pk-rise 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
      animation-delay: calc(var(--i, 0) * 55ms);
    }
  }

  /* ---- lead blotter ---- */

  /*
   * Two columns on a wide frame: the finding on the left, the driver mix on the
   * right. The three facts that used to be a caption — window, comparison, cost
   * quality — sit on a shared foot so they stay next to the figure they qualify.
   *
   * Not a second KPI row. The four cards below already hold margin, revenue, the
   * losing count and money given back.
   */
  .pk-blotter {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.15rem 2.5rem;
    align-items: start;
  }
  .pk-blotter.has-drivers {
    grid-template-columns: minmax(12rem, 0.95fr) minmax(0, 1.15fr);
  }

  .pk-blotter-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    min-width: 0;
  }
  .pk-blotter-copy { min-width: 0; }
  .pk-lead-svg {
    flex: 0 1 11rem;
    width: 11rem;
    max-width: 42%;
    height: auto;
    display: block;
  }
  .pk-blotter-kicker {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0 0 0.45rem;
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--pk-muted);
  }

  .pk-dash-figure {
    margin: 0;
    font-size: 1.55rem;
    font-weight: 600;
    letter-spacing: -0.03em;
    line-height: 1;
    color: var(--pk-ink);
    font-variant-numeric: tabular-nums;
  }
  .pk-dash-figure.is-loss { color: var(--pk-loss); }

  .pk-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.15rem 1.25rem;
    margin-bottom: 0.85rem;
  }
  @media (max-width: 28rem) {
    .pk-pair { grid-template-columns: 1fr; }
  }

  .pk-blotter-figure {
    margin: 0;
    font-size: 2.35rem;
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 0.95;
    color: var(--pk-ink);
    font-variant-numeric: tabular-nums;
  }
  .pk-blotter-figure.is-loss { color: var(--pk-loss); }

  .pk-blotter-support {
    margin: 0.55rem 0 0;
    max-width: 36ch;
    font-size: 0.88rem;
    line-height: 1.4;
    color: var(--pk-body);
  }

  /* Cost-quality track. flex-grow is the revenue on each band, so width is share
     of the window, not a count of products. */
  .pk-conf {
    display: flex;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--pk-track);
    margin-top: 0.75rem;
  }
  .pk-conf-seg { display: block; height: 100%; min-width: 0; }

  .pk-drivers { list-style: none; margin: 0; padding: 0; }
  .pk-driver {
    display: grid;
    grid-template-columns: minmax(6.5rem, 1fr) minmax(0, 1.4fr) 5.75rem;
    align-items: center;
    gap: 0.65rem;
    padding-block: 0.28rem;
  }
  .pk-driver-label {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
    font-size: 0.82rem;
    color: var(--pk-ink);
  }
  .pk-driver-count { font-size: 0.7rem; color: var(--pk-faint); }
  .pk-driver-track {
    display: block;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--pk-track);
  }
  .pk-driver-bar {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--pk-loss);
    transform-origin: left center;
  }
  .pk-driver-value {
    font-size: 0.82rem;
    font-weight: 600;
    text-align: right;
    color: var(--pk-loss);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 40rem) {
    .pk-blotter.has-drivers { grid-template-columns: minmax(0, 1fr); }
    .pk-blotter-figure { font-size: 1.85rem; }
    .pk-blotter-hero { flex-direction: column; align-items: flex-start; }
    .pk-lead-svg { width: 100%; max-width: 16rem; }
    .pk-driver {
      grid-template-columns: minmax(0, 1fr) 5.5rem;
    }
    .pk-driver-track { display: none; }
  }

  /* ---- section headings ---- */

  /* Label left, controls right, sitting above the card rather than inside it —
     the admin's own pattern, as used on Growth. */
  .pk-section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem 1rem;
    margin: 1.25rem 0 0.6rem;
  }
  .pk-section-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--pk-ink);
  }
  .pk-section-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 1rem;
  }
  .pk-section-meta { font-size: 0.8rem; color: var(--pk-muted); }

  /* ---- stat cards ---- */

  /* No grid rule here — s-grid owns the layout now. This only has to stop a long
     currency figure from forcing the column wider than its share. */
  .pk-stat { min-width: 0; }

  .pk-stat-label { margin: 0; font-size: 0.78rem; color: var(--pk-muted); }
  .pk-stat-value {
    margin: 0.35rem 0 0;
    font-size: 1.6rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.1;
    color: var(--pk-ink);
    font-variant-numeric: tabular-nums;
  }
  /* Holds one line — the delta, or the detail when there is no period to compare
     against. The fixed height is what keeps the four sparklines on a common baseline
     when only some cards have a delta to show. */
  .pk-stat-foot {
    display: flex;
    align-items: center;
    min-height: 1.6rem;
    margin-top: 0.35rem;
  }
  /* Ink, not green. A delta that moved the right way is just a figure; only an
     actual loss earns colour. See the note in app/styles.ts. */
  .pk-stat-change {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.8rem;
    color: var(--pk-body);
    white-space: nowrap;
  }
  .pk-stat-change.is-bad { color: var(--pk-loss); }
  .pk-stat-detail { margin: 0; font-size: 0.75rem; color: var(--pk-faint); }

  /* Full card width now that the sparkline is a real chart with a tooltip — squeezed
     into 4rem beside the delta there was nothing to hover. The height is reserved
     here as well as inline, so the card does not resize when Apex finishes loading. */
  .pk-spark {
    margin-top: 0.5rem;
    min-height: 44px;
  }
  /* polaris-viz draws its own tooltip; this only keeps the numbers in it tabular so a
     hovered value lines up with the figure above the chart. */
  .pk-spark [class*="Tooltip"] { font-variant-numeric: tabular-nums; }

  /* Occupies the sparkline's footprint on a card whose figure is a count, so the
     four cards keep one baseline. Bottom-aligned to sit where a trend line would. */
  .pk-share {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0.35rem;
    min-height: 44px;
    margin-top: 0.5rem;
  }
  .pk-share-caption { font-size: 0.75rem; color: var(--pk-faint); }
  .pk-share-track {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: var(--pk-track);
    overflow: hidden;
  }
  .pk-share-fill {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--pk-loss);
    transform-origin: left center;
  }

  /* ---- setup guide ---- */

  .pk-guide-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }
  .pk-guide-title { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }

  .pk-guide-progress {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.9rem;
  }
  .pk-guide-count { font-size: 0.75rem; color: var(--pk-muted); white-space: nowrap; }
  .pk-guide-bar {
    display: block;
    flex: 0 1 12rem;
    height: 6px;
    border-radius: 3px;
    background: var(--pk-rule);
    overflow: hidden;
  }
  .pk-guide-fill {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--pk-ink);
    transform-origin: left center;
    transition: transform 320ms cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .pk-guide-fill { transition: none; }
  }

  .pk-guide-steps { list-style: none; margin: 1.25rem 0 0; padding: 0; }
  .pk-guide-step {
    display: flex;
    gap: 0.7rem;
    padding-block: 0.7rem;
    border-top: 1px solid var(--pk-rule);
  }
  .pk-guide-step-body { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .pk-guide-step-title { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--pk-ink); }
  .pk-guide-step-note {
    margin: 0;
    max-width: 62ch;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--pk-muted);
  }
  /* A finished step steps back so the eye lands on what is left. */
  .pk-guide-step.is-done .pk-guide-step-title { color: var(--pk-muted); font-weight: 500; }

  .pk-guide-links { display: flex; flex-wrap: wrap; gap: 0.35rem 1.25rem; margin-top: 1rem; }

  /* ---- layout ---- */

  /* Polaris exposes no margin prop on any component and rejects inline style, so
     the stat row's outer spacing has to live on a plain wrapper. Same for the
     three-up board — a raw div is not an s-section, so s-page would otherwise
     sit it flush against the cards above and below. */
  .pk-stat-band,
  .pk-board { margin-block: 0.25rem 0.85rem; }

  .pk-board {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    align-items: stretch;
  }
  .pk-tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .pk-tile > s-section {
    flex: 1;
    width: 100%;
    min-height: 100%;
  }
  .pk-tile-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    box-sizing: border-box;
  }
  .pk-tile .pk-tile-body {
    min-height: 15.5rem;
    /* s-section padding is on a shadow wrapper. Filling the slot to the
       stretched host height overflows that padding and parks Show more on the
       card's bottom edge — so the inset lives here, on the light-DOM body. */
    padding-bottom: 1.15rem;
  }
  .pk-tile-main {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
  }
  .pk-tile-main > .pk-pair { margin-bottom: 0; }
  .pk-tile-main > .pk-conf { margin-top: 0; }
  .pk-tile-main > .pk-mix { margin-top: 0; }
  .pk-tile-main > .pk-panel-note { margin-top: 0; }
  .pk-tile-main > .pk-blotter-support { margin: 0; }
  .pk-tile-main > .pk-dash-figure { margin: 0; }

  @media (max-width: 56rem) {
    .pk-board { grid-template-columns: minmax(0, 1fr); }
    .pk-tile .pk-tile-body { min-height: 0; }
  }

  /* Asymmetric on purpose. Equal columns say the two panels matter equally, and
     they do not: losses are the job, earners are the reference point. */
  .pk-split {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: 1.75rem 3rem;
  }
  .pk-split-r { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); }

  .pk-widget {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  /*
   * No rule above a panel while the panels sit side by side.
   *
   * Each drawing its own border-top produced two disconnected lines of different
   * lengths — the columns are 1.6fr and 1fr — separated by the gutter. That reads as
   * a broken table rather than as a division, and it was the most obviously wrong
   * thing on the page.
   *
   * Stacked, a rule genuinely separates two things, so it comes back at the wrap
   * point and only between panels, never above the first.
   */
  @media (max-width: 56rem) {
    .pk-split,
    .pk-split-r { grid-template-columns: minmax(0, 1fr); gap: 0; }
    .pk-split > .pk-widget + .pk-widget {
      margin-block-start: 1.25rem;
      padding-block-start: 1.25rem;
      border-top: 1px solid var(--pk-rule);
    }
  }
  .pk-widget-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0 0 0.7rem;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--pk-ink);
  }
  .pk-widget-lead .pk-widget-title { font-size: 1rem; }
  .pk-widget-meta {
    margin-left: auto;
    font-weight: 400;
    font-size: 0.75rem;
    color: var(--pk-muted);
  }
  .pk-widget-empty { margin: 0; font-size: 0.88rem; }
  .pk-widget-action {
    margin-top: auto;
    padding-top: 1rem;
    padding-bottom: 0.15rem;
  }

  .pk-conf-disc { background: var(--pk-bar); }
  .pk-conf-refund { background: var(--pk-loss); }

  .pk-mix { list-style: none; margin: 0.5rem 0 0; padding: 0; }
  .pk-mix-row {
    display: grid;
    grid-template-columns: minmax(6.5rem, 1fr) minmax(0, 1.6fr) 6.5rem;
    align-items: center;
    gap: 0.75rem;
    padding-block: 0.55rem;
  }
  .pk-mix-row + .pk-mix-row { border-top: 1px solid var(--pk-hair); }
  .pk-mix-label {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    min-width: 0;
    font-size: 0.82rem;
    color: var(--pk-ink);
  }
  .pk-mix-meta { font-size: 0.7rem; color: var(--pk-faint); }
  .pk-mix-track {
    display: block;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--pk-track);
  }
  .pk-mix-bar {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--pk-bar);
    transform-origin: left center;
  }
  .pk-mix-bar.is-loss { background: var(--pk-loss); }
  .pk-mix-value {
    font-size: 0.82rem;
    font-weight: 600;
    text-align: right;
    color: var(--pk-ink);
    font-variant-numeric: tabular-nums;
  }
  .pk-mix-value.is-loss { color: var(--pk-loss); }

  .pk-tier-measured  { background: #212B1B; }
  .pk-tier-grouped   { background: var(--pk-bar); }
  .pk-tier-estimated { background: #9BAD90; }
  .pk-tier-unset     { background: var(--pk-track); box-shadow: inset 0 0 0 1px #C6CFC0; }

  /* ---- ranked lists ---- */

  .pk-case {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    padding-block: 0.2rem;
  }
  .pk-case-copy {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
  }
  .pk-thumb {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    border-radius: 2px;
  }
  /* Tick outside the cut, not a red wash over the photo. Red is the loss. */
  .pk-thumb.is-loss { box-shadow: -2px 0 0 var(--pk-loss); }
  .pk-case-sold {
    font-size: 0.72rem;
    color: var(--pk-faint);
  }

  .pk-case-name {
    font: inherit;
    font-weight: 600;
    font-size: 1rem;
    color: var(--pk-ink);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
    border-bottom: 1px solid transparent;
  }
  .pk-case-name:hover { border-bottom-color: var(--pk-ink); }
  .pk-case-name:focus-visible { outline: 2px solid #2F4858; outline-offset: 2px; }

  /* Cell contents only. The table's own grid, row rules, padding and its collapse to
     a list on a narrow frame are all s-table's job, not ours — the hand-built grid
     that used to do this is gone. */
  .pk-cell-note { font-size: 0.8rem; color: var(--pk-muted); }
  .pk-cell-money {
    display: block;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--pk-ink);
  }

  /* Magnitude, scaled against the largest figure in either direction. Grows from the
     right so it ends under the digits it belongs to, and scaleX rather than width so
     it composites. */
  .pk-cell-bar {
    display: block;
    height: 3px;
    margin-top: 0.3rem;
    border-radius: 2px;
    background: var(--pk-track);
    overflow: hidden;
  }
  .pk-cell-bar-fill {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--pk-bar);
    transform-origin: left center;
  }
  .pk-cell-bar-fill.is-loss { background: var(--pk-loss); }

  /* ---- bar charts ---- */

  .pk-panel-lead { margin: 0 0 0.7rem; font-size: 0.95rem; color: var(--pk-ink); }
  .pk-panel-note {
    margin: 0.8rem 0 0;
    max-width: 64ch;
    font-size: 0.78rem;
    color: var(--pk-muted);
  }

  /* The month chart's accessible twin. The chart itself is aria-hidden SVG, so this
     table is the only route to those numbers for a screen reader — it must stay in
     the accessibility tree, which display:none would not do. */
  .pk-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 40rem) {
    .pk-mix-row {
      grid-template-columns: minmax(0, 1fr) 5.5rem;
    }
    .pk-mix-track { display: none; }
  }

  /* ---- suspects and the estimate form ---- */

  .pk-suspects {
    margin: 0.75rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.9rem;
    color: var(--pk-body);
  }
  .pk-suspects li { padding-block: 0.35rem; }

  .pk-estimate {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.6rem 0.75rem;
  }
  .pk-estimate-field { flex: 0 1 14rem; min-width: 0; }
`;
