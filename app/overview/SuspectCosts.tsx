import type { ProductMarginRow } from "../reports/productMargin";
import { ShowMore } from "./ShowMore";
import { OVERVIEW_PREVIEW } from "./types";

export function SuspectCosts({
  suspects,
  formatMoney,
  onOpen,
}: {
  suspects: ProductMarginRow[];
  formatMoney: (cents: number) => string;
  onOpen: (title: string) => void;
}) {
  if (suspects.length === 0) return null;

  const shown = suspects.slice(0, OVERVIEW_PREVIEW.suspects);

  return (
    <s-section heading="Check these costs">
      <s-banner tone="warning">
        {suspects.length}{" "}
        {suspects.length === 1 ? "product costs" : "products cost"} more
        than three times what they sell for. That is usually a decimal point
        in the wrong place rather than a real loss, so they are kept out of
        the figures above.
      </s-banner>
      <ul className="pk-suspects">
        {shown.map((row) => (
          <li key={row.productId}>
            <button
              type="button"
              className="pk-case-name"
              onClick={() => onOpen(row.title)}
            >
              {row.title}
            </button>{" "}
            — cost {formatMoney(row.cogs)} against{" "}
            {formatMoney(row.revenue)} of revenue
          </li>
        ))}
      </ul>
      {suspects.length > shown.length && (
        <ShowMore
          href="/app/products"
          accessibilityLabel="Show all products with suspect costs"
        />
      )}
    </s-section>
  );
}
