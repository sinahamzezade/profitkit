import type { CSSProperties } from "react";

import { Sparkline } from "../charts";

/** Period-over-period change, or null when there is nothing real to compare against. */
export function changeOf(current: number, previous: number | null) {
  if (previous == null) return null;
  // A previous period of zero has no percentage — "up ∞%" is noise, so the card
  // shows direction only.
  if (previous === 0) {
    if (current === 0) return { dir: "flat" as const, label: "no change" };
    return {
      dir: current > 0 ? ("up" as const) : ("down" as const),
      label: "new",
    };
  }
  const ratio = (current - previous) / Math.abs(previous);
  if (Math.abs(ratio) < 0.001) return { dir: "flat" as const, label: "0%" };
  return {
    dir: ratio > 0 ? ("up" as const) : ("down" as const),
    label: `${Math.abs(ratio * 100).toFixed(Math.abs(ratio) < 0.1 ? 1 : 0)}%`,
  };
}

/**
 * One stat, in its own Polaris card.
 *
 * `s-section` is the card, not `s-box`. That distinction cost a round trip: `s-box`
 * with a border draws an outline but paints no surface, so the four cards showed the
 * page's grey through them while every real card on the page was white. There is no
 * `s-card` tag — checked the whole tag list — `s-section` is it, and it brings the
 * right surface, radius, border and padding with it.
 *
 * The section also supplies its own padding, so nothing here sets any: the sparkline
 * was previously running into the card's bottom edge because the box's padding did
 * not account for a child with its own height.
 */
export function StatCard({
  label,
  value,
  detail,
  change,
  series,
  days,
  share,
  index = 0,
  /** True when a rise in this figure is bad news — money leaving, products failing. */
  inverted = false,
}: {
  label: string;
  value: string;
  detail?: string;
  change: ReturnType<typeof changeOf>;
  series?: number[];
  /** ISO day per point in `series`, for the sparkline tooltip. */
  days?: string[];
  /**
   * Shown instead of a sparkline, for a figure that is a count rather than a series.
   * Never both: a card gets a trend line or a share, and the slot is reserved either
   * way so the row keeps one baseline.
   */
  share?: { part: number; whole: number };
  index?: number;
  inverted?: boolean;
}) {
  // Direction is what happened; tone is whether it is good. The two diverge on
  // "Given back" and "Products losing money", where up is the bad outcome.
  const bad =
    change == null || change.dir === "flat"
      ? false
      : inverted
        ? change.dir === "up"
        : change.dir === "down";

  return (
    <s-section accessibilityLabel={label}>
      <div className="pk-stat" style={{ "--i": index } as CSSProperties}>
        <p className="pk-stat-label">{label}</p>
        <p
          className={`pk-stat-value${inverted && value !== "0" ? " pk-down" : ""}`}
        >
          {value}
        </p>
        <div className="pk-stat-foot">
          {change ? (
            <span className={`pk-stat-change${bad ? " is-bad" : ""}`}>
              <span aria-hidden="true">
                {change.dir === "up" ? "↑" : change.dir === "down" ? "↓" : "—"}
              </span>
              <span className="num">{change.label}</span>
            </span>
          ) : (
            <span className="pk-stat-detail">{detail ?? ""}</span>
          )}
        </div>
        {change && detail && <p className="pk-stat-detail">{detail}</p>}
        {series && days ? (
          <Sparkline
            label={label}
            days={days}
            values={series}
            /* `inverted` marks the metrics that are money leaving, which is what
               earns loss red — not the direction this period happened to move. */
            tone={inverted ? "loss" : "neutral"}
          />
        ) : share ? (
          /*
           * "Products losing money" has no daily series — the aggregation produces
           * no per-day count — and an empty reserved slot left a plainly visible dead
           * zone in the card. This is the one thing that footprint can hold without
           * inventing anything: the count as a share of the catalogue, which is data
           * the card already states in words directly above it.
           */
          <div className="pk-share">
            <span className="pk-share-caption">
              {Math.round((share.part / share.whole) * 100)}% of what you sold
            </span>
            <span
              className="pk-share-track"
              role="img"
              aria-label={`${share.part} of ${share.whole} products sold lose money`}
            >
              <span
                className="pk-share-fill"
                style={{ transform: `scaleX(${share.part / share.whole})` }}
              />
            </span>
          </div>
        ) : (
          /* Reserved, so a card with neither keeps the row's shared baseline. */
          <div className="pk-spark" aria-hidden="true" />
        )}
      </div>
    </s-section>
  );
}
