import { MonthChart } from "../charts";
import type { MarginMonth } from "../reports/productMargin";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

function monthName(key: string) {
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * Margin month by month.
 *
 * Answers the question the app previously couldn't: not "what is broken" but "is it
 * getting better". The bars are ApexCharts now; a loss month is drawn in loss red so
 * it reads as a loss rather than merely as a short bar.
 *
 * The delta is the finding and leads. Only complete months are compared — a
 * part-month against a whole one always reads as a collapse, which is an alarm
 * about nothing.
 */
export function TrendPanel({
  months,
  currency,
  formatMoney,
}: {
  months: MarginMonth[];
  currency: string;
  formatMoney: (cents: number) => string;
}) {
  if (months.length < 2) {
    return (
      <>
        <h3 className="pk-blotter-kicker">Margin by month</h3>
        <s-paragraph>
          <s-text tone="neutral">
            A trend needs at least two months of orders. Keep the app installed
            and this fills in.
          </s-text>
        </s-paragraph>
      </>
    );
  }

  const complete = months.slice(1, -1);
  const latest = complete.length >= 2 ? complete[complete.length - 1] : null;
  const previous = complete.length >= 2 ? complete[complete.length - 2] : null;
  const change =
    latest && previous
      ? latest.contributionMargin - previous.contributionMargin
      : null;

  return (
    <>
      <h3 className="pk-blotter-kicker">
        Margin by month
        <span className="pk-widget-meta">is it improving</span>
      </h3>
      {change == null || !latest || !previous ? (
        <p className="pk-blotter-support">
          Not enough whole months yet to compare. The months below include
          partial ones at each end.
        </p>
      ) : (
        <>
          <p className={`pk-dash-figure${change < 0 ? " is-loss" : ""}`}>
            {formatMoney(Math.abs(change))}
          </p>
          <p className="pk-blotter-support">
            {change === 0
              ? `${monthName(latest.month)} held level against ${monthName(previous.month)}.`
              : `${change > 0 ? "Up" : "Down"} in ${monthName(latest.month)}, against ${monthName(previous.month)}.`}
          </p>
        </>
      )}
      <MonthChart
        currency={currency}
        months={months.map((month, index) => ({
          key: month.month,
          label: monthName(month.month),
          cents: month.contributionMargin,
          // The window rarely lands on a month boundary, so the months at each end
          // are usually short. Marking them stops a half-month reading as a slump.
          partial: index === 0 || index === months.length - 1,
        }))}
      />
      <p className="pk-panel-note">
        * Partial month — the reporting window starts and ends mid-month.
      </p>
    </>
  );
}
