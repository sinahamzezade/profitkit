import type { CSSProperties } from "react";

import type { CostCoverage } from "../reports/costCoverage";
import type { MarginMonth } from "../reports/productMargin";
import { CoveragePanel } from "./CoveragePanel";
import { TrendPanel } from "./TrendPanel";

export function TrendCoverage({
  months,
  coverage,
  currency,
  formatMoney,
}: {
  months: MarginMonth[];
  coverage: CostCoverage;
  currency: string;
  formatMoney: (cents: number) => string;
}) {
  return (
    <s-section accessibilityLabel="Trend and confidence">
      <div className="pk-split">
        <section
          className="pk-widget pk-widget-lead"
          style={{ "--i": 0 } as CSSProperties}
        >
          <TrendPanel
            months={months}
            currency={currency}
            formatMoney={formatMoney}
          />
        </section>

        <section className="pk-widget" style={{ "--i": 1 } as CSSProperties}>
          <CoveragePanel coverage={coverage} formatMoney={formatMoney} />
        </section>
      </div>
    </s-section>
  );
}
