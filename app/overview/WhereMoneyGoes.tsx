import type { ReactNode } from "react";

import { MoneyTable, type MoneyRow } from "./MoneyTable";
import { WidgetBody } from "./ShowMore";

export function WhereMoneyGoes({
  lead,
  rows,
  formatMoney,
  onOpen,
  moreHref,
}: {
  lead: ReactNode;
  rows: MoneyRow[];
  formatMoney: (cents: number) => string;
  onOpen: (title: string) => void;
  moreHref?: string;
}) {
  return (
    <s-section heading="Where the money goes">
      <WidgetBody
        more={
          moreHref
            ? { href: moreHref, accessibilityLabel: "Show all products" }
            : undefined
        }
      >
        <s-paragraph>
          <s-text tone="neutral">{lead}</s-text>
        </s-paragraph>
        <MoneyTable
          rows={rows}
          formatMoney={formatMoney}
          onOpen={onOpen}
          emptyText="No products sold in this period."
        />
      </WidgetBody>
    </s-section>
  );
}
