import { lazy, Suspense, useEffect, useState } from "react";

/**
 * The app's charts, on Shopify's own data-visualisation library.
 *
 * Replaced ApexCharts with `@shopify/polaris-viz`. Three reasons, in order of weight:
 * it is the library Shopify publishes for exactly this, so charts inside the admin
 * look like the admin; it is markedly smaller — 114 kB gzip against Apex's 279 kB,
 * measured on this app's own build; and its charts are React components, so there is
 * no imperative construct-render-destroy lifecycle to get wrong.
 *
 * ## It still cannot render on the server
 *
 * The failure is later than Apex's and therefore easier to trip over. Apex throws
 * while its module is evaluated, so a top-level import breaks the build loudly.
 * polaris-viz imports cleanly and then fails inside ChartContainer with
 * "window is not defined" the first time it renders — the route 500s at runtime
 * instead. Hence the `mounted` gate below, and hence the real charts living in
 * `./charts/viz` behind `React.lazy` so the module is only ever fetched in a browser.
 *
 * The reserved height is set here rather than inside the chart, so a card is the same
 * height before and after the chunk arrives and nothing reflows under the reader.
 */

const VizSparkline = lazy(() =>
  import("./charts/viz").then((m) => ({ default: m.VizSparkline })),
);
const VizBars = lazy(() =>
  import("./charts/viz").then((m) => ({ default: m.VizBars })),
);

/** True once mounted in a browser. Charts render only after this flips. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function moneyFormatter(currency: string) {
  const fmt = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  return (cents: number) => fmt.format(cents / 100);
}

const SPARK_HEIGHT = 48;

/**
 * The trend line inside a stat card.
 *
 * `aria-hidden` on purpose: the card states the figure and its change as text
 * immediately above, so the line is illustration rather than the only route to the
 * number. The month chart below is the opposite case and carries a real table.
 */
export function Sparkline({
  label,
  days,
  values,
  tone,
}: {
  label: string;
  /** ISO `YYYY-MM-DD` per point. */
  days: string[];
  values: number[];
  /** What the series *is*, not which way it moved — red means loss, only loss. */
  tone: "loss" | "neutral";
}) {
  const mounted = useMounted();
  if (values.length < 2) return null;

  const points = values.map((value, i) => ({
    key: days[i] ?? String(i),
    value,
  }));

  return (
    <div
      className="pk-spark"
      aria-hidden="true"
      style={{ height: SPARK_HEIGHT }}
    >
      {mounted && (
        <Suspense fallback={null}>
          <VizSparkline points={points} tone={tone} label={label} />
        </Suspense>
      )}
    </div>
  );
}

export type MonthBar = {
  /** `YYYY-MM`, a stable key. */
  key: string;
  label: string;
  cents: number;
  /** The window rarely starts on a month boundary; marked with an asterisk. */
  partial: boolean;
};

/**
 * Margin by month.
 *
 * The visually-hidden table is not decoration. This chart replaced an ordered list
 * whose values were readable text, and an SVG chart alone would have removed every
 * one of those numbers from a screen reader. The chart is hidden from the
 * accessibility tree and the table is the accessible copy of the same data.
 */
export function MonthChart({
  months,
  currency,
}: {
  months: MonthBar[];
  currency: string;
}) {
  const mounted = useMounted();
  const money = moneyFormatter(currency);
  if (months.length === 0) return null;

  const height = months.length * 40 + 32;

  return (
    <>
      <div aria-hidden="true" style={{ height }}>
        {mounted && (
          <Suspense fallback={null}>
            <VizBars
              label="Contribution margin"
              formatValue={money}
              points={months.map((m) => ({
                key: m.partial ? `${m.label}*` : m.label,
                value: m.cents,
              }))}
            />
          </Suspense>
        )}
      </div>
      <table className="pk-sr-only">
        <caption>Contribution margin by month</caption>
        <tbody>
          {months.map((month) => (
            <tr key={month.key}>
              <th scope="row">
                {month.label}
                {month.partial ? " (partial month)" : ""}
              </th>
              <td>{money(month.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
