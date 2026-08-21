import { useEffect, useRef } from "react";
import type ApexCharts from "apexcharts";

import { PK_COLORS } from "./styles";

/**
 * ApexCharts wrappers.
 *
 * ## Why the import is dynamic
 *
 * ApexCharts reaches for `window` while it is being evaluated, not when a chart is
 * constructed. A top-level `import "apexcharts"` in a route therefore breaks the
 * server render — and this app renders every route on the server. So the library is
 * pulled in inside `useEffect`, which only ever runs in the browser.
 *
 * That has a second benefit worth keeping on purpose: Apex is around half a megabyte
 * unminified, and a dynamic import puts it in its own chunk. The dashboard's numbers
 * are server-rendered text and paint without waiting for any of it; the charts fill
 * in on hydration. Nothing important is behind the download.
 *
 * ## Types
 *
 * `apexcharts` ships `export = ApexCharts`, so the options type is not exported on
 * its own. Deriving it from the constructor avoids naming a namespace path that a
 * minor release could move.
 */
type ApexOptions = ConstructorParameters<typeof ApexCharts>[1];

/** Charts should not animate for anyone who has asked the OS for less motion. */
function animationsAllowed() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Construct, render, and tear down one chart.
 *
 * `cancelled` matters: the dynamic import is async, so a component can unmount
 * before the library arrives. Without the guard the chart would be built into a
 * detached node and never destroyed, and Apex keeps a global registry of live
 * instances — the leak would accumulate across navigations rather than being
 * collected.
 */
function useApex(buildOptions: () => ApexOptions | null, key: string) {
  const host = useRef<HTMLDivElement>(null);

  // buildOptions closes over fresh props on every render; `key` is what decides
  // whether the chart actually needs rebuilding.
  const build = useRef(buildOptions);
  build.current = buildOptions;

  useEffect(() => {
    const el = host.current;
    const options = build.current();
    if (!el || !options) return;

    let chart: ApexCharts | null = null;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let lastWidth = 0;

    /*
     * Render immediately, correct later. Nothing here is gated on an animation
     * frame, and that is deliberate: `requestAnimationFrame` does not run in a
     * hidden tab, so scheduling the first render on a frame means a merchant who
     * opens the app in a background tab gets no charts at all until they focus it.
     * Measured that directly — in a backgrounded tab, rAF fired zero times in half a
     * second, and so did ResizeObserver.
     */
    import("apexcharts")
      .then(({ default: Apex }) => {
        if (cancelled) return;
        chart = new Apex(el, options);
        lastWidth = Math.round(el.getBoundingClientRect().width);
        return chart.render();
      })
      .then(() => {
        if (cancelled || typeof ResizeObserver === "undefined") return;
        /*
         * Apex measures its container once, at construction, and afterwards
         * re-measures only on a window resize. That leaves two gaps this closes:
         *
         *   - constructed before layout settled, it plots the series against a stale
         *     width. The symptom is easy to miss because nothing looks broken — the
         *     SVG is the full width of the card and correct in every measurable way,
         *     while the line inside it sits squeezed into the leftmost fraction.
         *   - the container later changes width with no window resize at all: the
         *     stat grid rewraps as `auto-fit` adds or drops a column, and the admin
         *     frame resizes when the merchant collapses the nav.
         *
         * Both are the same repair, so the observer handles both. It is an
         * enhancement rather than a dependency — where it is missing, the chart still
         * renders. It watches the host element, not the SVG, so a redraw cannot feed
         * back into another redraw.
         */
        observer = new ResizeObserver((entries) => {
          const width = Math.round(entries[0].contentRect.width);
          if (width === 0 || width === lastWidth) return;
          lastWidth = width;
          void chart?.updateOptions({}, true, false);
        });
        observer.observe(el);
      })
      .catch(() => {
        // A chart that fails to load is not worth breaking the page for. Every
        // figure it illustrates is rendered as text elsewhere on the card.
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      chart?.destroy();
    };
  }, [key]);

  return host;
}

function moneyFormatter(currency: string) {
  const fmt = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  return (cents: number) => fmt.format(cents / 100);
}

/**
 * The trend line inside a stat card.
 *
 * Zero is forced into the scale. Left to autoscale against the series' own minimum,
 * a run of small losses would be drawn as a healthy-looking line across the middle
 * of the card — the shape would say "steady" about a period spent below water.
 *
 * Marked `aria-hidden` deliberately: the card states the figure and its change as
 * text directly above, so the line is illustration rather than the only route to the
 * number. The month chart below is a different case and carries a real table.
 */
export function Sparkline({
  label,
  days,
  values,
  currency,
  tone,
}: {
  label: string;
  /** ISO `YYYY-MM-DD` per point, used for the tooltip. */
  days: string[];
  values: number[];
  currency: string;
  /**
   * What the series *is*, not which way it moved.
   *
   * Red means loss and only loss. Driving this from the period-over-period direction
   * instead — as an earlier version did — painted the contribution-margin line red
   * whenever the period merely trailed the one before it, which is not a loss.
   */
  tone: "loss" | "neutral";
}) {
  const host = useApex(() => {
    if (values.length < 2) return null;
    const money = moneyFormatter(currency);

    return {
      chart: {
        type: "line",
        height: 44,
        sparkline: { enabled: true },
        fontFamily: "inherit",
        animations: { enabled: animationsAllowed(), speed: 400 },
      },
      series: [{ name: label, data: values }],
      labels: days,
      stroke: { curve: "smooth", width: 1.5 },
      colors: [tone === "loss" ? PK_COLORS.loss : PK_COLORS.bar],
      yaxis: { min: Math.min(0, ...values), max: Math.max(0, ...values) },
      tooltip: {
        enabled: true,
        x: { show: true },
        y: { formatter: (v: number) => money(v) },
      },
    } satisfies ApexOptions;
  }, `${label}:${values.length}:${tone}`);

  if (values.length < 2) return null;

  return (
    <div
      className="pk-spark"
      ref={host}
      aria-hidden="true"
      /* Reserves the height before the library lands, so the card does not jump. */
      style={{ minHeight: 44 }}
    />
  );
}

export type MonthBar = {
  /** `YYYY-MM`, used only as a stable key. */
  key: string;
  label: string;
  cents: number;
  /** Marked with an asterisk — the window rarely starts on a month boundary. */
  partial: boolean;
};

/**
 * Margin by month, as horizontal bars.
 *
 * The hidden table is not decoration. This replaced a plain `<ol>` whose values were
 * readable text, and an SVG chart on its own would have quietly removed every one of
 * those numbers from a screen reader. The chart is `aria-hidden` and the table is the
 * accessible copy of the same data.
 */
export function MonthChart({
  months,
  currency,
}: {
  months: MonthBar[];
  currency: string;
}) {
  const money = moneyFormatter(currency);

  const host = useApex(
    () => {
      if (months.length === 0) return null;

      return {
        chart: {
          type: "bar",
          height: months.length * 38 + 24,
          fontFamily: "inherit",
          toolbar: { show: false },
          animations: { enabled: animationsAllowed(), speed: 500 },
        },
        series: [
          { name: "Contribution margin", data: months.map((m) => m.cents) },
        ],
        plotOptions: {
          bar: {
            horizontal: true,
            barHeight: "58%",
            borderRadius: 2,
            /* Per-bar colour, so a loss month is red rather than just short. */
            distributed: true,
            dataLabels: { position: "bottom" },
          },
        },
        /* `distributed` treats every bar as its own series, which would otherwise
         produce a legend with one entry per month. */
        legend: { show: false },
        colors: months.map((m) =>
          m.cents < 0 ? PK_COLORS.loss : PK_COLORS.bar,
        ),
        xaxis: {
          categories: months.map((m) => (m.partial ? `${m.label}*` : m.label)),
          labels: { formatter: (v: string) => money(Number(v)) },
          axisBorder: { show: false },
          axisTicks: { show: false },
        },
        yaxis: {
          labels: { style: { colors: PK_COLORS.body, fontSize: "12px" } },
        },
        grid: { borderColor: PK_COLORS.hair, xaxis: { lines: { show: true } } },
        dataLabels: { enabled: false },
        tooltip: { y: { formatter: (v: number) => money(v) } },
      } satisfies ApexOptions;
    },
    months.map((m) => `${m.key}:${m.cents}`).join("|"),
  );

  if (months.length === 0) return null;

  return (
    <>
      <div
        ref={host}
        aria-hidden="true"
        style={{ minHeight: months.length * 38 + 24 }}
      />
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
