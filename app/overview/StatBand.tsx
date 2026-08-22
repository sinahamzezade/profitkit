import type { MarginDay } from "../reports/productMargin";
import { dayWord } from "../text";
import { SectionHead } from "./SectionHead";
import { changeOf, StatCard } from "./StatCard";
import type { OverviewPrevious } from "./types";

export function StatBand({
  days,
  previous,
  periodDays,
  totalMargin,
  totalRevenue,
  losingCount,
  productCount,
  givenBack,
  formatMoney,
}: {
  days: MarginDay[];
  previous: OverviewPrevious | null;
  periodDays: number;
  totalMargin: number;
  totalRevenue: number;
  losingCount: number;
  productCount: number;
  givenBack: number;
  formatMoney: (cents: number) => string;
}) {
  const marginPercent = totalRevenue === 0 ? null : totalMargin / totalRevenue;

  return (
    <div className="pk-stat-band">
      {/* Growth labels its card row from outside, with the range and a details link
          opposite. The range here is a statement, not a control: the window is set by
          the plan. */}
      <SectionHead
        title="Performance"
        action={<s-link href="/app/products">View details</s-link>}
      />
      {/*
        Four cards, laid out by `s-grid` rather than a CSS grid of my own.

        `auto-fit` rather than Polaris's `@container` responsive syntax on purpose.
        That syntax is documented for one condition and a fallback; chaining three
        breakpoints is not documented, and the component runtime is served from
        Shopify's CDN inside the admin, so there is nowhere local to check whether a
        chain parses. `auto-fit` needs no breakpoints at all — it drops from four
        columns to one as the row narrows, and it measures the row's real width, which
        matters here because the admin frame is narrower than the viewport and changes
        again when the merchant collapses the nav.
      */}
      <s-grid
        gap="base"
        gridTemplateColumns="repeat(auto-fit, minmax(11rem, 1fr))"
      >
        <StatCard
          index={0}
          days={days.map((d) => d.day)}
          label={`Contribution margin · ${periodDays} ${dayWord(periodDays)}`}
          value={formatMoney(totalMargin)}
          detail={
            marginPercent == null
              ? undefined
              : `${(marginPercent * 100).toFixed(1)}% of revenue`
          }
          change={changeOf(totalMargin, previous?.contributionMargin ?? null)}
          series={days.map((d) => d.contributionMargin)}
        />
        <StatCard
          index={1}
          days={days.map((d) => d.day)}
          label="Revenue after discounts"
          value={formatMoney(totalRevenue)}
          change={changeOf(totalRevenue, previous?.revenue ?? null)}
          series={days.map((d) => d.revenue)}
        />
        {/* No sparkline: a daily count of loss-making products is not a series the
            aggregation produces, and inventing one from the total would be a line
            that looks like data and isn't. */}
        <StatCard
          index={2}
          label="Products losing money"
          value={String(losingCount)}
          detail={`of ${productCount} sold`}
          share={
            productCount > 0
              ? { part: losingCount, whole: productCount }
              : undefined
          }
          change={changeOf(losingCount, previous?.negativeProducts ?? null)}
          inverted
        />
        <StatCard
          index={3}
          days={days.map((d) => d.day)}
          label="Given back"
          value={formatMoney(givenBack)}
          detail="discounts and refunds"
          change={changeOf(givenBack, previous?.givenBack ?? null)}
          series={days.map((d) => d.givenBack)}
          inverted
        />
      </s-grid>
    </div>
  );
}
