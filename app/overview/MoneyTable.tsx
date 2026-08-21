import { ProductThumb } from "./ProductThumb";

export type MoneyRow = {
  productId: string;
  title: string;
  imageUrl: string | null;
  unitsSold: number;
  contributionMargin: number;
  /** What is behind the figure: the loss driver, or the margin it earned. */
  note?: string;
};

/**
 * Both ends of the catalogue, in one table.
 *
 * This replaced two ranked lists sitting side by side, each with its own heading and
 * its own top rule. `s-table` keeps its default `auto` variant, which renders as a
 * table on a wide frame and as a list on a narrow one — so the split grid, its 1.6/1fr
 * columns and its wrap rule are all gone from this section.
 *
 * Rows are sorted by contribution margin ascending: losses at the top, which is the
 * question this app exists to answer, and the largest earner last. A money column
 * that did not run monotonically would simply look broken.
 *
 * The component has no row-group heading — no second `s-table-body`, no caption — so
 * the fact that these ten rows are the two *extremes* of a much longer list cannot be
 * implied by a divider and has to be said in words. The caller's lead line does that.
 * Ten contiguous rows out of sixty-seven would otherwise read as adjacent in rank.
 *
 * The thumbnail is the product, not decoration. A merchant recognises the backpack
 * faster than they parse its title, and the loss tick on the cut is the same rule
 * as everywhere else: red only when the row actually lost money.
 */
export function MoneyTable({
  rows,
  formatMoney,
  onOpen,
  emptyText,
}: {
  rows: MoneyRow[];
  formatMoney: (cents: number) => string;
  onOpen: (title: string) => void;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="pk-widget-empty">
        <s-text tone="neutral">{emptyText}</s-text>
      </p>
    );
  }

  /*
   * One scale across every row, so a loss and an earning of equal size draw an equal
   * bar. Ten right-aligned currency strings of similar width get read digit by digit;
   * the bar makes the ranking legible at a glance, and the colour flip marks where the
   * losses end without needing a divider the component cannot draw.
   *
   * The consequence is deliberate and worth not "fixing": measured on the seeded
   * store, the loss bars come out 2–14px against a 176px track, because the worst
   * product loses $223 while the best earns $2,850. Scaling losses and earnings on
   * separate axes would even them out and is exactly the wrong move — equal-length
   * bars would then mean wildly different amounts of money. The lopsidedness is the
   * true shape of the data, and it says something useful: the losses are small beside
   * what the catalogue earns.
   */
  const peak = Math.max(...rows.map((r) => Math.abs(r.contributionMargin)), 1);

  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Product</s-table-header>
        <s-table-header listSlot="secondary">What&apos;s behind it</s-table-header>
        <s-table-header listSlot="inline" format="currency">
          Contribution margin
        </s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((row) => {
          /*
           * `clickDelegate` makes the whole row clickable, but it is explicitly
           * click-only — it adds no keyboard or screen-reader affordance. The button
           * it points at is the real control and stays in the row for exactly that
           * reason, so keyboard users reach the product the ordinary way.
           */
          const buttonId = `pk-open-${row.productId.replace(/[^a-zA-Z0-9]+/g, "-")}`;
          const loss = row.contributionMargin < 0;

          return (
            <s-table-row key={row.productId} clickDelegate={buttonId}>
              <s-table-cell>
                <div className="pk-case">
                  <ProductThumb url={row.imageUrl} loss={loss} />
                  <div className="pk-case-copy">
                    <button
                      id={buttonId}
                      type="button"
                      className="pk-case-name"
                      onClick={() => onOpen(row.title)}
                    >
                      {row.title}
                    </button>
                    <span className="pk-case-sold num">{row.unitsSold} sold</span>
                  </div>
                </div>
              </s-table-cell>
              <s-table-cell>
                <span className="pk-cell-note">{row.note ?? ""}</span>
              </s-table-cell>
              <s-table-cell>
                <span className={`pk-cell-money${loss ? " pk-down" : ""}`}>
                  {formatMoney(row.contributionMargin)}
                </span>
                {/* Decoration only — the figure above it is the accessible value. */}
                <span className="pk-cell-bar" aria-hidden="true">
                  <span
                    className={`pk-cell-bar-fill${loss ? " is-loss" : ""}`}
                    style={{
                      transform: `scaleX(${Math.abs(row.contributionMargin) / peak})`,
                    }}
                  />
                </span>
              </s-table-cell>
            </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
  );
}
