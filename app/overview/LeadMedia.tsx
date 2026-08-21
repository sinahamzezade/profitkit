/**
 * The finding, drawn rather than iconed.
 *
 * This is the same two-stroke thesis as the Profitkit mark: a flat revenue rule,
 * and the margin line beneath it ending well below where it started. Scaled up as
 * media for the lead card, on ledger paper, so the empty right side of the old
 * sentence-in-a-box has something that is the product rather than a stock chart
 * icon.
 *
 * Decorative. The words beside it are the accessible finding. Red appears only on
 * the falling stroke, and only when something actually lost money — same rule as
 * the rest of the app.
 */
export function LeadMedia({ falling }: { falling: boolean }) {
  return (
    <svg
      className="pk-lead-svg"
      viewBox="0 0 240 148"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="8"
        y="8"
        width="224"
        height="132"
        rx="2"
        fill="var(--pk-hair)"
      />

      {/* Ledger gutter — the vertical rule a real book keeps for the date column. */}
      <path d="M40 16 v116" stroke="var(--pk-rule)" strokeWidth="1" />
      <path
        d="M16 40 h208 M16 64 h208 M16 88 h208 M16 112 h208"
        stroke="var(--pk-rule)"
        strokeWidth="1"
      />

      {/* Revenue: flat, unbothered, the number everyone already has. */}
      <path
        d="M40 44 h168"
        stroke="var(--pk-ink)"
        strokeWidth="2.4"
        strokeLinecap="butt"
      />

      {falling ? (
        <>
          {/* The drop, filled with paper not with loss-red — red is the stroke, only. */}
          <path
            d="M40 58 L124 70 L208 118 L208 58 Z"
            fill="var(--pk-track)"
          />
          <path
            d="M40 58 L124 70 L208 118"
            stroke="var(--pk-loss)"
            strokeWidth="2.4"
            strokeLinejoin="miter"
            strokeLinecap="butt"
          />
          {/* Closing double-rule, the ledger convention for a total. */}
          <path
            d="M176 126 h32 M176 130 h32"
            stroke="var(--pk-loss)"
            strokeWidth="1.4"
          />
        </>
      ) : (
        <path
          d="M40 66 h168"
          stroke="var(--pk-ink)"
          strokeWidth="2.4"
          strokeLinecap="butt"
        />
      )}
    </svg>
  );
}
