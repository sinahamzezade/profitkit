import {
  BarChart,
  PolarisVizProvider,
  SparkLineChart,
} from "@shopify/polaris-viz";
import { LIGHT_THEME as BASE_LIGHT_THEME } from "@shopify/polaris-viz-core";
import "@shopify/polaris-viz/build/esm/styles.css";

import { PK_COLORS } from "../styles";

/**
 * Every polaris-viz chart in the app, behind one lazy-loaded module.
 *
 * This file is never imported directly — `app/charts.tsx` pulls it in with
 * `React.lazy`, for two reasons.
 *
 * It cannot render on the server. Unlike ApexCharts, which throws while the module
 * is being evaluated, polaris-viz imports fine and then fails inside ChartContainer
 * with "window is not defined" the moment it renders. That is the more dangerous
 * shape of the same bug: a top-level import looks harmless right up until the route
 * 500s, so the guard has to sit at the render boundary rather than the import.
 *
 * And it is large. Keeping it in its own chunk means the dashboard's numbers — all
 * server-rendered text — paint without waiting for a charting library.
 *
 * `isAnimated` is off everywhere on purpose. Chart entrance animations depend on the
 * page producing frames, and this app has already shipped one bug where an unfocused
 * admin iframe left animated content invisible indefinitely. A chart that draws
 * instantly is worth more here than one that grows.
 */

const THEME = "Light";

export interface SeriesPoint {
  key: string;
  value: number;
}

/** Trend line inside a stat card. Shopify's own spark component, so it matches admin. */
export function VizSparkline({
  points,
  tone,
  label,
}: {
  points: SeriesPoint[];
  tone: "loss" | "neutral";
  label: string;
}) {
  /*
   * A break-even line, drawn only when the series actually crosses zero.
   *
   * The previous implementation forced zero into the y-domain directly, because a run
   * of small losses autoscaled to its own minimum draws a line across the middle of
   * the card — a shape that says "steady" about a period spent below water.
   * `SparkLineChart` takes no axis options at all, so that lever is gone.
   *
   * A flat zero comparison series does the same job and more: it pins the domain to
   * include zero *and* shows where break-even sits, so a line under it is visibly
   * under it rather than merely low.
   *
   * Only added when some point is negative. On revenue, which never goes below zero,
   * it would anchor the domain at zero and flatten the variation the line exists to
   * show, while marking a boundary the series cannot cross.
   */
  const crossesZero = points.some((p) => p.value < 0);

  return (
    <PolarisVizProvider themes={{ Light: THEME_OVERRIDES }}>
      <SparkLineChart
        theme={THEME}
        isAnimated={false}
        accessibilityLabel={label}
        data={[
          {
            name: label,
            color: tone === "loss" ? PK_COLORS.loss : PK_COLORS.bar,
            data: points,
          },
          ...(crossesZero
            ? [
                {
                  name: "Break even",
                  isComparison: true,
                  data: points.map((p) => ({ key: p.key, value: 0 })),
                },
              ]
            : []),
        ]}
      />
    </PolarisVizProvider>
  );
}

/** Margin by month, horizontal so the month labels read left to right. */
export function VizBars({
  points,
  label,
  formatValue,
}: {
  points: SeriesPoint[];
  label: string;
  formatValue: (value: number) => string;
}) {
  return (
    <PolarisVizProvider themes={{ Light: THEME_OVERRIDES }}>
      <BarChart
        theme={THEME}
        isAnimated={false}
        direction="horizontal"
        showLegend={false}
        /*
         * Ledger green, not polaris-viz's default blue — which is a colour this
         * app's palette does not contain at all.
         *
         * One colour for the whole series is a real limitation: `DataSeries.color`
         * applies per series, not per bar, so a month below zero draws green like
         * the rest. The convention here is that red means loss and only loss, so a
         * negative month ought to be red. Splitting into two series would do it and
         * would also split the axis and legend, which is a worse trade for a chart
         * whose months are almost always positive. Worth revisiting if a store
         * routinely posts negative months.
         */
        data={[{ name: label, color: PK_COLORS.bar, data: points }]}
        xAxisOptions={{ labelFormatter: (v) => formatValue(Number(v)) }}
        yAxisOptions={{ labelFormatter: (v) => String(v) }}
      />
    </PolarisVizProvider>
  );
}

/**
 * Theme overrides, spread onto polaris-viz's own Light theme.
 *
 * Spread, not replaced — and that distinction was a bug before it was a comment.
 * "Light" is polaris-viz's default theme name, so passing
 * `themes={{ Light: {...} }}` with a handful of keys does not extend the built-in
 * theme, it *substitutes* for it, and ChartContainer then reads properties that no
 * longer exist and renders nothing. The charts were simply absent from the cards.
 *
 * Only the parts that would otherwise contradict this app's rules are overridden:
 * grid and axis text move onto the palette in app/styles.ts. Series colour is set
 * per-series at the call site instead, because which colour a series takes is a
 * statement about the data — red means loss, and only loss — not a theme decision.
 */
const THEME_OVERRIDES = {
  ...BASE_LIGHT_THEME,
  chartContainer: {
    ...BASE_LIGHT_THEME.chartContainer,
    backgroundColor: "transparent",
    padding: "0",
  },
  grid: { ...BASE_LIGHT_THEME.grid, color: PK_COLORS.hair },
  xAxis: { ...BASE_LIGHT_THEME.xAxis, labelColor: PK_COLORS.muted },
  yAxis: { ...BASE_LIGHT_THEME.yAxis, labelColor: PK_COLORS.muted },
};
