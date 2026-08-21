import { useEffect, useRef, useState, type CSSProperties } from "react";
import type ApexCharts from "apexcharts";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { hasAnyCogsConfigured } from "../costs/cogs";
import { resolveTierForShop, resolveTierLimits } from "../billing/tier";
import { listGateways, setGlobalCogsPercent } from "../costs/repository";
import { GUIDE_URL, hasGuide, hasVideo, VIDEO_URL } from "../docs";
import { loadShopCostConfig } from "../ingestion/dbToDomain";
import {
  aggregateByDay,
  aggregateByMonth,
  aggregateByProduct,
  aggregateByVendor,
  applyReportOptions,
  type MarginMonth,
  type ProductMarginRow,
  type VendorMargin,
} from "../reports/productMargin";
import { loadOrdersForMargin } from "../reports/productMargin.server";
import { buildErosionReport, NO_REASON_RECORDED } from "../reports/erosion";
import {
  buildCostCoverage,
  TIER_LABELS,
  type CostCoverage,
} from "../reports/costCoverage";
import { buildHeroReport, DRIVER_LABELS } from "../reports/lossLeaders";

/** Days of order history the report covers, from the data itself rather than a guess. */
async function resolvePeriod(shopId: string, since: Date | null) {
  const where = { shopId, ...(since ? { createdAtShopify: { gte: since } } : {}) };
  const [oldest, newest] = await Promise.all([
    prisma.order.findFirst({
      where,
      orderBy: { createdAtShopify: "asc" },
      select: { createdAtShopify: true },
    }),
    prisma.order.findFirst({
      where,
      orderBy: { createdAtShopify: "desc" },
      select: { createdAtShopify: true },
    }),
  ]);
  if (!oldest || !newest) return { days: 0, from: null, to: null };

  const from = oldest.createdAtShopify;
  const to = newest.createdAtShopify;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  return { days, from, to };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    return { state: "no-data" as const };
  }

  // Tier bound is applied to the query, not to what gets rendered.
  const limits = resolveTierLimits(
    await resolveTierForShop(session.shop, billing),
    new Date(),
  );

  const config = await loadShopCostConfig(shop.id);

  // Orders are loaded once and aggregated three ways. Each panel calling its own
  // builder would re-read the whole window per panel.
  const [orders, period, anyOrder] = await Promise.all([
    loadOrdersForMargin(shop.id, limits.since ?? undefined),
    resolvePeriod(shop.id, limits.since),
    prisma.order.findFirst({
      where: { shopId: shop.id },
      select: { currencyCode: true },
    }),
  ]);
  const periodDays = period.days;
  const erosion = buildErosionReport(orders);

  const rows = aggregateByProduct(orders, config);
  const report = applyReportOptions(rows, { pageSize: 100_000 });
  const currency = anyOrder?.currencyCode ?? "USD";

  /*
   * Setup-guide progress, computed rather than stored.
   *
   * Each step is a thing that makes the numbers less of an estimate, and each is
   * derived from real state — so the guide cannot claim a step is done when it
   * isn't, and it completes itself as the merchant works.
   *
   * The fee step is the subtle one. A shop taking payment only through Shopify
   * Payments needs no rule at all, so "every gateway that needs a rule has one"
   * is the test, not "any rule exists" — otherwise the step could never complete
   * for those shops and the guide would nag forever.
   */
  const gateways = await listGateways(shop.id);
  const gatewaysNeedingRule = gateways.filter((g) => g.ordersMissingFee > 0);
  const gatewaysWithRule = new Set(
    config.feeRules.map((r) => r.gatewayName.toLowerCase()),
  );
  const setup = {
    ordersImported: report.totalRows > 0,
    costEstimate: hasAnyCogsConfigured(config.cogsEntries),
    paymentFees: gatewaysNeedingRule.every((g) =>
      gatewaysWithRule.has(g.gateway.toLowerCase()),
    ),
    gatewaysNeedingRule: gatewaysNeedingRule.length,
    shippingCost: config.shipping.globalPerOrderCents != null,
  };

  /*
   * Previous-period comparison for the stat deltas.
   *
   * The comparison window is the same length as the current one, immediately
   * before it, and is only loaded when the tier's own query bound reaches that far
   * back. On free, a 90-day view would need 180 days to compare against, which the
   * bound forbids — so rather than quietly widen a paid boundary, the cards show no
   * delta and the caption says the period is uncompared.
   */
  const windowMs =
    period.from && period.to ? period.to.getTime() - period.from.getTime() : 0;
  const priorFrom =
    period.from && windowMs > 0 ? new Date(period.from.getTime() - windowMs) : null;
  const canCompare =
    priorFrom !== null && (limits.since === null || priorFrom >= limits.since);

  const priorOrders =
    canCompare && period.from
      ? await loadOrdersForMargin(shop.id, priorFrom, period.from)
      : [];
  const priorTotals = applyReportOptions(
    canCompare ? aggregateByProduct(priorOrders, config) : [],
    { pageSize: 100_000 },
  ).totals;
  const priorErosion = canCompare ? buildErosionReport(priorOrders) : null;

  const stats = {
    from: period.from ? period.from.toISOString() : null,
    to: period.to ? period.to.toISOString() : null,
    days:
      period.from && period.to
        ? aggregateByDay(orders, config, period.from, period.to)
        : [],
    previous: canCompare
      ? {
          contributionMargin: priorTotals.contributionMargin,
          revenue: priorTotals.revenue,
          negativeProducts: priorTotals.negativeProducts,
          givenBack:
            (priorErosion?.totalDiscounts ?? 0) + (priorErosion?.totalRefunds ?? 0),
        }
      : null,
  };

  // The counterpoint to the loss list. Seeing only what's broken gives no sense of
  // what a healthy product looks like in this catalog.
  const earners = [...rows]
    .filter((r) => r.contributionMargin > 0)
    .sort((a, b) => b.contributionMargin - a.contributionMargin)
    .slice(0, 5);

  return {
    state: "ready" as const,
    hero: buildHeroReport(rows, { periodDays, currency }),
    months: aggregateByMonth(orders, config),
    coverage: buildCostCoverage(rows),
    earners,
    vendors: aggregateByVendor(rows).slice(0, 6),
    totalRevenue: report.totals.revenue,
    erosion: {
      totalDiscounts: erosion.totalDiscounts,
      totalRefunds: erosion.totalRefunds,
      topCode: erosion.discountsByCode[0] ?? null,
      topReason: erosion.refundsByReason[0] ?? null,
    },
    currency,
    hasCostData: setup.costEstimate,
    setup,
    stats,
    productCount: report.totalRows,
    totalMargin: report.totals.contributionMargin,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const percent = Number(formData.get("percent"));

  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    return { error: "Enter a number between 1 and 99." };
  }

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) return { error: "No data for this store yet." };

  await setGlobalCogsPercent(shop.id, percent / 100);
  return { ok: true };
};

function makeMoneyFormatter(currency: string) {
  return (cents: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      cents / 100,
    );
}

function productHref(title: string) {
  return `/app/products?q=${encodeURIComponent(title)}`;
}

type SetupState = {
  ordersImported: boolean;
  costEstimate: boolean;
  paymentFees: boolean;
  gatewaysNeedingRule: number;
  shippingCost: boolean;
};

/**
 * The four steps that make the numbers trustworthy, in the order that does it:
 * orders arrive, then one cost estimate makes every figure meaningful, then the
 * two costs Shopify cannot supply remove the last guesses.
 *
 * Split out of the component because the page itself needs to know whether they
 * are all done — it demotes the guide to the foot of the page and lets the finding
 * lead once there is nothing left to do. Two separate completeness tests would
 * drift apart the first time a step was added.
 */
function setupSteps(setup: SetupState) {
  return [
    {
      done: setup.ordersImported,
      title: "Import your orders",
      body: "Happens on install. Profitkit reads the 60 days Shopify allows, then keeps up through webhooks.",
      action: null,
    },
    {
      done: setup.costEstimate,
      title: "Set one cost estimate",
      body: "Roughly what a product costs you as a share of its price. This single number turns revenue into margin across the whole catalogue.",
      action: { label: "Set it below", href: null },
    },
    {
      done: setup.paymentFees,
      title: "Add your payment fee rates",
      /*
       * Three states, not two. A done step still has gateways that report no fee —
       * that is why a rate was needed — so reusing the outstanding wording once the
       * rates exist told the merchant their orders count as free to process while
       * the step sat ticked above it.
       */
      body:
        setup.gatewaysNeedingRule === 0
          ? "Nothing to do — Shopify reports the real fee for every gateway this store uses."
          : setup.paymentFees
            ? `Covered. ${setup.gatewaysNeedingRule} ${
                setup.gatewaysNeedingRule === 1 ? "gateway reports" : "gateways report"
              } no fee of their own, and your rates now stand in for them.`
            : `${setup.gatewaysNeedingRule} ${
                setup.gatewaysNeedingRule === 1 ? "gateway" : "gateways"
              } ${setup.gatewaysNeedingRule === 1 ? "reports" : "report"} no fee, so those orders currently count as free to process.`,
      action: { label: "Open cost settings", href: "/app/settings" },
    },
    {
      done: setup.shippingCost,
      title: "Set your shipping cost",
      body: "Shopify's API does not carry what fulfilment costs you. Until you supply it, shipping counts as nothing rather than as profit.",
      action: { label: "Open cost settings", href: "/app/settings" },
    },
  ];
}

function setupProgress(setup: SetupState) {
  const steps = setupSteps(setup);
  const done = steps.filter((s) => s.done).length;
  return { steps, done, complete: done === steps.length };
}

/**
 * Setup guide, in the shape Shopify uses for onboarding: heading, one line of
 * purpose, "n / 4 completed" with a progress bar, an overflow menu and a collapse
 * chevron.
 *
 * The progress is real — every step is derived from store state in the loader, so
 * it cannot claim a step is done when it isn't, and it fills in by itself as the
 * merchant works.
 *
 * Collapse is session-only. Persisting it would mean either a schema column or
 * localStorage, and localStorage read during render is a hydration mismatch —
 * which on this app presents as a blank page, not a warning.
 */
function SetupGuide({ setup }: { setup: SetupState }) {
  const { steps, done, complete } = setupProgress(setup);
  const pct = Math.round((done / steps.length) * 100);

  // Open while there is work left, shut once there isn't. A finished guide held
  // open is the largest thing on the page and says nothing; closed, it reads as a
  // receipt and the numbers get the room.
  const [open, setOpen] = useState(!complete);

  return (
    <s-section>
      <div className="pk-guide-head">
        <div className="pk-guide-title">
          <s-heading>Setup guide</s-heading>
          <s-text tone="neutral">
            {complete
              ? "Every step done. The figures above use your own costs, not defaults."
              : "Use this guide to get accurate profit numbers as quickly as possible."}
          </s-text>
        </div>
        <s-stack direction="inline" gap="small-300" alignItems="center">
          <s-button
            variant="tertiary"
            icon="menu-horizontal"
            accessibilityLabel="More actions"
            commandFor="pk-setup-menu"
            command="--show"
          />
          <s-menu id="pk-setup-menu">
            <s-button href="/app/settings">Cost settings</s-button>
            <s-button onClick={() => setOpen(false)}>Collapse guide</s-button>
          </s-menu>
          <s-button
            variant="tertiary"
            icon={open ? "chevron-up" : "chevron-down"}
            accessibilityLabel={open ? "Collapse setup guide" : "Expand setup guide"}
            onClick={() => setOpen(!open)}
          />
        </s-stack>
      </div>

      <div className="pk-guide-progress">
        <span className="num pk-guide-count">
          {done} / {steps.length} completed
        </span>
        {/* Bar is drawn here because Polaris has no progress component. The
            accessible value lives on the element, not just in the fill width. */}
        <span
          className="pk-guide-bar"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-label={`${done} of ${steps.length} setup steps completed`}
        >
          {/* scaleX rather than width: a width transition lays out and repaints on
              every frame, a transform is composited. */}
          <span
            className="pk-guide-fill"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </span>
      </div>

      {open && (
        <ul className="pk-guide-steps">
          {steps.map((step) => (
            <li
              key={step.title}
              className={`pk-guide-step ${step.done ? "is-done" : ""}`}
            >
              <s-icon
                type={step.done ? "check-circle-filled" : "circle"}
                tone={step.done ? "success" : "neutral"}
              />
              <div className="pk-guide-step-body">
                <p className="pk-guide-step-title">{step.title}</p>
                <p className="pk-guide-step-note">{step.body}</p>
                {!step.done && step.action?.href && (
                  <s-link href={step.action.href}>{step.action.label}</s-link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Links are gated: GUIDE_URL previously pointed at profitkit.app, which
          belongs to a different company. Nothing renders until app/docs.ts holds a
          confirmed domain. */}
      {open && (hasGuide || hasVideo) && (
        <div className="pk-guide-links">
          {hasGuide && (
            <s-link href={GUIDE_URL} target="_blank">
              Read the full walkthrough
            </s-link>
          )}
          {hasVideo && (
            <s-link href={VIDEO_URL} target="_blank">
              Watch the video
            </s-link>
          )}
        </div>
      )}
    </s-section>
  );
}

/**
 * The onboarding rung that makes the whole view work: one number, applied to
 * everything, so a merchant who has never entered a cost still gets a real answer.
 */
function CostEstimatePrompt({ hasCostData }: { hasCostData: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const [percent, setPercent] = useState("45");
  const saving = fetcher.state !== "idle";

  return (
    <s-section
      heading={hasCostData ? "Adjust your cost estimate" : "Start here"}
    >
      <s-paragraph>
        {hasCostData
          ? "This applies to every product without a cost of its own."
          : "Costs aren't in Shopify, so nothing below is real profit yet. Roughly what " +
            "percentage of a product's price does it cost you to buy or make?"}
      </s-paragraph>
      <div className="pk-estimate">
        <div className="pk-estimate-field">
          <s-text-field
            label="Typical cost as % of price"
            value={percent}
            onInput={(event) => setPercent(event.currentTarget.value)}
            onChange={(event) => setPercent(event.currentTarget.value)}
          />
        </div>
        <s-button
          variant="primary"
          {...(saving ? { loading: true } : {})}
          onClick={() => fetcher.submit({ percent }, { method: "POST" })}
        >
          {hasCostData ? "Update estimate" : "Show me what's losing money"}
        </s-button>
      </div>
      {fetcher.data && "error" in fetcher.data && fetcher.data.error && (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      )}
      <s-paragraph>
        <s-text tone="neutral">
          Once you&apos;ve seen the shape of the answer, refine it per supplier
          and add payment fees and shipping cost in{" "}
          <s-link href="/app/settings">cost settings</s-link>.
        </s-text>
      </s-paragraph>
    </s-section>
  );
}

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
 * getting better". Bars are scaled against the largest month in either direction so
 * a loss month reads as a loss rather than as a short bar.
 */
function TrendPanel({
  months,
  formatMoney,
}: {
  months: MarginMonth[];
  formatMoney: (cents: number) => string;
}) {
  if (months.length < 2) {
    return (
      <s-paragraph>
        <s-text tone="neutral">
          A trend needs at least two months of orders. Keep the app installed
          and this fills in.
        </s-text>
      </s-paragraph>
    );
  }

  const peak = Math.max(
    ...months.map((m) => Math.abs(m.contributionMargin)),
    1,
  );

  // Only complete months are compared. The window starts and ends mid-month, so
  // holding a part-month against a whole one always reads as a collapse — an alarm
  // about nothing, and the fastest way to lose a merchant's trust in the number.
  const complete = months.slice(1, -1);
  const latest = complete.length >= 2 ? complete[complete.length - 1] : null;
  const previous = complete.length >= 2 ? complete[complete.length - 2] : null;
  const change =
    latest && previous
      ? latest.contributionMargin - previous.contributionMargin
      : null;

  return (
    <>
      <p className="pk-panel-lead">
        {change == null || !latest || !previous ? (
          <s-text tone="neutral">
            Not enough whole months yet to compare. The months below include
            partial ones at each end.
          </s-text>
        ) : change === 0 ? (
          <>
            {monthName(latest.month)} held level against{" "}
            {monthName(previous.month)}.
          </>
        ) : (
          <>
            <strong className={change < 0 ? "pk-down" : "pk-up"}>
              {change > 0 ? "Up" : "Down"} {formatMoney(Math.abs(change))}
            </strong>{" "}
            in {monthName(latest.month)}, against {monthName(previous.month)}.
          </>
        )}
      </p>
      <ol className="pk-trend">
        {months.map((month, index) => {
          const loss = month.contributionMargin < 0;
          const width = (Math.abs(month.contributionMargin) / peak) * 100;
          const partial = index === 0 || index === months.length - 1;
          return (
            <li className="pk-trend-row" key={month.month}>
              <span className="pk-trend-month">
                {monthName(month.month)}
                {/* The window rarely lands on a month boundary, so the end months are
                    usually short. Marking them stops a half-month reading as a slump. */}
                {partial && <abbr title="Partial month">*</abbr>}
              </span>
              <span className="pk-trend-track">
                <i
                  className={`pk-trend-bar${loss ? " pk-trend-bar-loss" : ""}`}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className={`pk-trend-value${loss ? " pk-down" : ""}`}>
                {formatMoney(month.contributionMargin)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="pk-panel-note">
        * Partial month — the reporting window starts and ends mid-month.
      </p>
    </>
  );
}

/** How much of the catalog's cost data is measured rather than guessed. */
function CoveragePanel({
  coverage,
  formatMoney,
}: {
  coverage: CostCoverage;
  formatMoney: (cents: number) => string;
}) {
  if (coverage.totalProducts === 0) return null;

  return (
    <>
      <p className="pk-panel-lead">
        <strong>{Math.round(coverage.looseShare * 100)}%</strong> of your
        revenue has a cost that&apos;s a guess.
      </p>
      <ul className="pk-coverage">
        {coverage.bands.map((band) => (
          <li className="pk-coverage-row" key={band.tier}>
            <span className={`pk-tier-dot pk-tier-${band.tier}`} />
            <span className="pk-coverage-label">{TIER_LABELS[band.tier]}</span>
            <span className="pk-coverage-count">{band.products}</span>
            <span className="pk-coverage-revenue">
              {formatMoney(band.revenue)}
            </span>
          </li>
        ))}
      </ul>
      {coverage.nextStep && (
        <p className="pk-panel-note">
          Biggest single improvement: set a cost for{" "}
          <strong>{coverage.nextStep.vendor}</strong> —{" "}
          {coverage.nextStep.products}{" "}
          {coverage.nextStep.products === 1 ? "product" : "products"} carrying{" "}
          {formatMoney(coverage.nextStep.revenue)} of revenue.
        </p>
      )}
    </>
  );
}

/**
 * Sparkline for a stat card. Polaris ships no chart, so this is ApexCharts in
 * sparkline mode — loaded on the client because the library touches `window`.
 *
 * Zero stays inside the scaled range, so a dip into negative margin reads as a
 * dip instead of being flattened by autoscaling to the series' own min.
 *
 * Loss red only when the trend on this card is the bad outcome. Otherwise the
 * ledger bar green, never a decorative "up is good" fill.
 */
function Spark({
  series,
  bad,
  format,
}: {
  series: number[];
  bad: boolean;
  format?: (n: number) => string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const seriesKey = series.join(",");

  useEffect(() => {
    const el = host.current;
    if (!el || seriesKey.length === 0) return;
    const values = seriesKey.split(",").map(Number);
    if (values.length < 2) return;

    let chart: ApexCharts | undefined;
    let cancelled = false;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const color = bad ? "#B3261E" : "#47573E";
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);

    void import("apexcharts").then(({ default: Apex }) => {
      if (cancelled || !host.current) return;
      chart = new Apex(host.current, {
        chart: {
          type: "area",
          height: 72,
          sparkline: { enabled: true },
          animations: { enabled: !reduceMotion, speed: 450 },
          fontFamily: "inherit",
          toolbar: { show: false },
        },
        series: [{ data: values }],
        stroke: { curve: "straight", width: 1.5 },
        fill: { type: "solid", opacity: 0.16 },
        colors: [color],
        yaxis: { min, max: max === min ? min + 1 : max },
        tooltip: {
          theme: "light",
          x: { show: false },
          y: {
            title: { formatter: () => "" },
            formatter: (val: number) => {
              const n = Math.round(val);
              return formatRef.current ? formatRef.current(n) : String(n);
            },
          },
          marker: { show: false },
        },
      });
      void chart.render();
    });

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [seriesKey, bad]);

  if (series.length < 2) return null;
  return <div ref={host} className="pk-spark" />;
}

/** Period-over-period change, or null when there is nothing real to compare against. */
function changeOf(current: number, previous: number | null) {
  if (previous == null) return null;
  // A previous period of zero has no percentage — "up ∞%" is noise, so the card
  // shows direction only.
  if (previous === 0) {
    if (current === 0) return { dir: "flat" as const, label: "no change" };
    return { dir: current > 0 ? ("up" as const) : ("down" as const), label: "new" };
  }
  const ratio = (current - previous) / Math.abs(previous);
  if (Math.abs(ratio) < 0.001) return { dir: "flat" as const, label: "0%" };
  return {
    dir: ratio > 0 ? ("up" as const) : ("down" as const),
    label: `${Math.abs(ratio * 100).toFixed(Math.abs(ratio) < 0.1 ? 1 : 0)}%`,
  };
}

/**
 * One KPI, as its own Polaris card.
 *
 * Direction is what happened; tone is whether it is good. The two diverge on
 * "Given back" and "Products losing money", where up is the bad outcome.
 */
function StatCard({
  label,
  value,
  detail,
  change,
  series,
  formatSeries,
  /** True when a rise in this figure is bad news — money leaving, products failing. */
  inverted = false,
}: {
  label: string;
  value: string;
  detail?: string;
  change: ReturnType<typeof changeOf>;
  series?: number[];
  formatSeries?: (n: number) => string;
  inverted?: boolean;
}) {
  const bad =
    change == null || change.dir === "flat"
      ? false
      : inverted
        ? change.dir === "up"
        : change.dir === "down";

  return (
    <s-section heading={label}>
      <s-stack gap="small-200">
        <p
          className={`pk-stat-value${inverted && value !== "0" ? " pk-down" : ""}`}
        >
          {value}
        </p>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {change ? (
            <span className={`pk-stat-change${bad ? " is-bad" : ""}`}>
              <span aria-hidden="true">
                {change.dir === "up" ? "↑" : change.dir === "down" ? "↓" : "—"}
              </span>
              <span className="num">{change.label}</span>
            </span>
          ) : null}
          {detail ? (
            <s-text tone="neutral">{detail}</s-text>
          ) : null}
        </s-stack>
        {series ? (
          <Spark series={series} bad={bad} format={formatSeries} />
        ) : null}
      </s-stack>
    </s-section>
  );
}

/** Compact ranked list shared by the loss and earner widgets. */
function RankedProducts({
  rows,
  formatMoney,
  onOpen,
  emptyText,
}: {
  rows: Array<{
    productId: string;
    title: string;
    contributionMargin: number;
    note?: string;
  }>;
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
  return (
    <ul className="pk-ranked">
      {rows.map((row) => (
        <li className="pk-ranked-row" key={row.productId}>
          <button
            type="button"
            className="pk-case-name"
            onClick={() => onOpen(row.title)}
          >
            {row.title}
          </button>
          <span
            className={`pk-ranked-value${row.contributionMargin < 0 ? " pk-down" : ""}`}
          >
            {formatMoney(row.contributionMargin)}
          </span>
          {row.note && <span className="pk-ranked-note">{row.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Margin rolled up by supplier — one negotiation instead of twenty product decisions. */
function VendorWidget({
  vendors,
  formatMoney,
}: {
  vendors: VendorMargin[];
  formatMoney: (cents: number) => string;
}) {
  if (vendors.length === 0) {
    return (
      <p className="pk-widget-empty">
        <s-text tone="neutral">No vendors are set on your products.</s-text>
      </p>
    );
  }
  const peak = Math.max(
    ...vendors.map((v) => Math.abs(v.contributionMargin)),
    1,
  );

  return (
    <ul className="pk-vendors">
      {vendors.map((vendor) => {
        const loss = vendor.contributionMargin < 0;
        return (
          <li className="pk-vendor-row" key={vendor.vendor}>
            <span className="pk-vendor-name">
              {vendor.vendor}
              <span className="pk-vendor-count">{vendor.products}</span>
            </span>
            <span className="pk-vendor-track">
              <i
                className={`pk-vendor-bar${loss ? " pk-vendor-bar-loss" : ""}`}
                style={{
                  width: `${(Math.abs(vendor.contributionMargin) / peak) * 100}%`,
                }}
              />
            </span>
            <span className={`pk-vendor-value${loss ? " pk-down" : ""}`}>
              {formatMoney(vendor.contributionMargin)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (data.state === "no-data") {
    return (
      <s-page heading="Profit overview">
        <s-section>
          <s-banner tone="info" heading="No orders yet">
            Once this store has orders, your margin shows up here.
          </s-banner>
        </s-section>
        <SetupGuide
          setup={{
            ordersImported: false,
            costEstimate: false,
            paymentFees: false,
            gatewaysNeedingRule: 0,
            shippingCost: false,
          }}
        />
      </s-page>
    );
  }

  const {
    hero,
    currency,
    hasCostData,
    setup,
    stats,
    productCount,
    months,
    coverage,
    erosion,
    totalMargin,
    totalRevenue,
    earners,
    vendors,
  } = data;
  const formatMoney = makeMoneyFormatter(currency);
  const openProduct = (title: string) => navigate(productHref(title));
  const marginPercent = totalRevenue === 0 ? null : totalMargin / totalRevenue;

  /*
   * States the window, and whether it was actually compared. Printing "compared to
   * the previous period" when nothing was compared is the kind of unearned claim
   * this app exists not to make.
   */
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const periodCaption =
    !stats.from || !stats.to
      ? "No orders in this period yet."
      : `Showing ${dateFmt.format(new Date(stats.from))} – ${dateFmt.format(
          new Date(stats.to),
        )}${
          stats.previous
            ? " compared to the previous period"
            : ". Not enough history on this plan to compare periods."
        }`;

  /*
   * The finding, stated first and in words.
   *
   * The page used to open with a setup guide and a date range, which meant the one
   * question the app exists to answer — what is losing money — sat three sections
   * down inside a widget. It leads now.
   *
   * No losers is a real result rather than an empty state, so it gets its own
   * sentence instead of a zero.
   */
  const losing = hero.losers.length;
  const verdict =
    losing === 0 ? (
      <>Nothing sold at a loss over the last {hero.periodDays} days.</>
    ) : (
      <>
        <strong className="pk-down">
          {losing} {losing === 1 ? "product" : "products"}
        </strong>{" "}
        cost you {formatMoney(Math.abs(hero.totalLost))} over the last{" "}
        {hero.periodDays} days.
      </>
    );

  // The caveat belongs beside the claim, not two sections below it. A headline loss
  // figure resting mostly on guessed costs should say so where it is read.
  const loosePercent = Math.round(coverage.looseShare * 100);

  // Drives whether the guide leads the page or closes it.
  const setupDone = setupProgress(setup).complete;

  return (
    <s-page heading="Profit overview">
      <style>{PK_STYLES}</style>
      <s-button slot="primary-action" onClick={() => navigate("/app/products")}>
        See every product
      </s-button>

      {/* The guide leads only while it still changes the numbers. Once every step
          is done it renders collapsed at the foot of the page instead — a finished
          checklist held open is the largest thing on screen saying nothing. */}
      {!setupDone && <SetupGuide setup={setup} />}
      {!hasCostData && <CostEstimatePrompt hasCostData={false} />}

      {/*
        Finding, then the four figures it rests on — each figure its own card so
        the sparkline has a surface to sit in, rather than a hairline column.
      */}
      <s-section>
        <p className="pk-lead-line">{verdict}</p>
        <p className="pk-lead-sub">
          {periodCaption}
          {loosePercent > 0 &&
            ` · ${loosePercent}% of that revenue rests on a guessed cost.`}
        </p>
      </s-section>

      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(16rem, 1fr))"
        gap="base"
      >
        <StatCard
          label={`Contribution margin · ${hero.periodDays} days`}
          value={formatMoney(totalMargin)}
          detail={
            marginPercent == null
              ? undefined
              : `${(marginPercent * 100).toFixed(1)}% of revenue`
          }
          change={changeOf(
            totalMargin,
            stats.previous?.contributionMargin ?? null,
          )}
          series={stats.days.map((d) => d.contributionMargin)}
          formatSeries={formatMoney}
        />
        <StatCard
          label="Revenue after discounts"
          value={formatMoney(totalRevenue)}
          change={changeOf(totalRevenue, stats.previous?.revenue ?? null)}
          series={stats.days.map((d) => d.revenue)}
          formatSeries={formatMoney}
        />
        <StatCard
          label="Products losing money"
          value={String(hero.losers.length)}
          detail={`of ${productCount} sold`}
          change={changeOf(
            hero.losers.length,
            stats.previous?.negativeProducts ?? null,
          )}
          inverted
        />
        <StatCard
          label="Given back"
          value={formatMoney(erosion.totalDiscounts + erosion.totalRefunds)}
          detail="discounts and refunds"
          change={changeOf(
            erosion.totalDiscounts + erosion.totalRefunds,
            stats.previous?.givenBack ?? null,
          )}
          series={stats.days.map((d) => d.givenBack)}
          formatSeries={formatMoney}
          inverted
        />
      </s-grid>

      {/*
        Losses lead the detail, with the earners beside them rather than below —
        a loss list alone gives no sense of what healthy looks like in this
        catalogue. The two are not equals, so the split is 1.6 to 1, not 50/50.
      */}
      <s-section heading="Where the money goes">
        <div className="pk-split">
          <section
            className="pk-widget pk-widget-lead"
            style={{ "--i": 0 } as CSSProperties}
          >
            <h3 className="pk-widget-title">
              Losing money
              {hero.losers.length > 0 && (
                <span className="pk-widget-meta">
                  {formatMoney(Math.abs(hero.totalLost))} lost
                </span>
              )}
            </h3>
            <RankedProducts
              rows={hero.losers.slice(0, 5).map((leader) => ({
                productId: leader.row.productId,
                title: leader.row.title,
                contributionMargin: leader.row.contributionMargin,
                note:
                  leader.lossPerUnit != null
                    ? `${DRIVER_LABELS[leader.driver]} · loses ${formatMoney(
                        Math.abs(leader.lossPerUnit),
                      )} a sale`
                    : DRIVER_LABELS[leader.driver],
              }))}
              formatMoney={formatMoney}
              onOpen={openProduct}
              emptyText="Nothing sold at a loss in this period."
            />
          </section>

          <section className="pk-widget" style={{ "--i": 1 } as CSSProperties}>
            <h3 className="pk-widget-title">Earning most</h3>
            <RankedProducts
              rows={earners.map((row: ProductMarginRow) => ({
                productId: row.productId,
                title: row.title,
                contributionMargin: row.contributionMargin,
                note:
                  row.marginPercent == null
                    ? undefined
                    : `${(row.marginPercent * 100).toFixed(1)}% margin`,
              }))}
              formatMoney={formatMoney}
              onOpen={openProduct}
              emptyText="No product turned a profit in this period."
            />
          </section>

        </div>
      </s-section>

      {/* Trend beside confidence. "Is it improving" is only worth reading next to
          how much of the answer is measured rather than assumed, and the two were
          previously four sections apart. */}
      <s-section>
        <div className="pk-split">
          <section
            className="pk-widget pk-widget-lead"
            style={{ "--i": 0 } as CSSProperties}
          >
            <h3 className="pk-widget-title">
              Margin by month
              <span className="pk-widget-meta">is it improving</span>
            </h3>
            <TrendPanel months={months} formatMoney={formatMoney} />
          </section>

          <section className="pk-widget" style={{ "--i": 1 } as CSSProperties}>
            <h3 className="pk-widget-title">How solid these numbers are</h3>
            <CoveragePanel coverage={coverage} formatMoney={formatMoney} />
          </section>
        </div>
      </s-section>

      {/* Rhythm flips here — narrow left, wide right — so the page reads as a
          composition rather than a stack of identical slabs. */}
      <s-section>
        <div className="pk-split pk-split-r">
          <section className="pk-widget" style={{ "--i": 0 } as CSSProperties}>
            <h3 className="pk-widget-title">Discounts and refunds</h3>
            <ul className="pk-erosion">
              <li>
                <span>Discounts</span>
                <span>{formatMoney(erosion.totalDiscounts)}</span>
                <span className="pk-erosion-detail">
                  {erosion.topCode
                    ? `${erosion.topCode.label} is the largest`
                    : "No codes used"}
                </span>
              </li>
              <li>
                <span>Refunds</span>
                <span>{formatMoney(erosion.totalRefunds)}</span>
                <span className="pk-erosion-detail">
                  {/* The commonest "reason" is usually that Shopify recorded none, and
                      "Mostly no reason recorded" reads like a bug rather than a fact. */}
                  {!erosion.topReason
                    ? "None"
                    : erosion.topReason.label === NO_REASON_RECORDED
                      ? "Most have no reason recorded"
                      : `Mostly ${erosion.topReason.label.toLowerCase()}`}
                </span>
              </li>
            </ul>
            <s-button onClick={() => navigate("/app/leaks")}>
              Break this down
            </s-button>
          </section>

          <section className="pk-widget" style={{ "--i": 1 } as CSSProperties}>
            <h3 className="pk-widget-title">
              Margin by vendor
              <span className="pk-widget-meta">worst first</span>
            </h3>
            <VendorWidget vendors={vendors} formatMoney={formatMoney} />
          </section>
        </div>
      </s-section>

      {hero.suspect.length > 0 && (
        <s-section heading="Check these costs">
          <s-banner tone="warning">
            {hero.suspect.length}{" "}
            {hero.suspect.length === 1 ? "product costs" : "products cost"} more
            than three times what they sell for. That is usually a decimal point
            in the wrong place rather than a real loss, so they are kept out of
            the figures above.
          </s-banner>
          <ul className="pk-suspects">
            {hero.suspect.map((row) => (
              <li key={row.productId}>
                <button
                  type="button"
                  className="pk-case-name"
                  onClick={() => openProduct(row.title)}
                >
                  {row.title}
                </button>{" "}
                — cost {formatMoney(row.cogs)} against{" "}
                {formatMoney(row.revenue)} of revenue
              </li>
            ))}
          </ul>
        </s-section>
      )}

      {hasCostData && <CostEstimatePrompt hasCostData />}

      {/* Demoted, not removed. It is still where a merchant checks what the figures
          are built on, and re-opening it costs one click. */}
      {setupDone && <SetupGuide setup={setup} />}
    </s-page>
  );
}

/*
 * What this page needs and the Polaris web components do not ship.
 *
 * Anything Polaris draws — cards, buttons, banners, text fields, icons, menus — is
 * left to Polaris. What remains is the progress bar, the bar charts, and the
 * layout grids. The stat sparklines are ApexCharts, loaded on the client.
 *
 * The palette itself is not here. It lives in app/styles.ts and is rendered once by
 * the app layout, because four routes each keeping their own copy had already let
 * two of the colours drift apart.
 */
const PK_STYLES = `
  /* One entrance, staggered by --i, transform and opacity only. Off entirely for
     anyone who has asked for less motion. */
  @keyframes pk-rise {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .pk-widget {
      animation: pk-rise 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
      animation-delay: calc(var(--i, 0) * 55ms);
    }
  }

  /* ---- lead ---- */

  .pk-lead-line {
    margin: 0;
    max-width: 34ch;
    font-size: 1.4rem;
    font-weight: 450;
    line-height: 1.25;
    letter-spacing: -0.015em;
    color: var(--pk-ink);
  }
  .pk-lead-line strong { font-weight: 650; }
  .pk-lead-sub {
    margin: 0.45rem 0 0;
    max-width: 72ch;
    font-size: 0.8rem;
    line-height: 1.55;
    color: var(--pk-muted);
  }

  /* ---- stat cards ---- */

  .pk-stat-value {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    line-height: 1.1;
    color: var(--pk-ink);
    font-variant-numeric: tabular-nums;
  }
  .pk-stat-change {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.8rem;
    color: var(--pk-good);
    white-space: nowrap;
  }
  .pk-stat-change.is-bad { color: var(--pk-loss); }
  .pk-spark { width: 100%; min-height: 72px; }

  @media (max-width: 30rem) {
    .pk-lead-line { font-size: 1.2rem; }
  }

  /* ---- setup guide ---- */

  .pk-guide-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }
  .pk-guide-title { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }

  .pk-guide-progress {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.9rem;
  }
  .pk-guide-count { font-size: 0.75rem; color: var(--pk-muted); white-space: nowrap; }
  .pk-guide-bar {
    display: block;
    flex: 0 1 12rem;
    height: 6px;
    border-radius: 3px;
    background: var(--pk-rule);
    overflow: hidden;
  }
  .pk-guide-fill {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--pk-ink);
    transform-origin: left center;
    transition: transform 320ms cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .pk-guide-fill { transition: none; }
  }

  .pk-guide-steps { list-style: none; margin: 1.25rem 0 0; padding: 0; }
  .pk-guide-step {
    display: flex;
    gap: 0.7rem;
    padding-block: 0.7rem;
    border-top: 1px solid var(--pk-rule);
  }
  .pk-guide-step-body { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .pk-guide-step-title { margin: 0; font-size: 0.875rem; font-weight: 600; color: var(--pk-ink); }
  .pk-guide-step-note {
    margin: 0;
    max-width: 62ch;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--pk-muted);
  }
  /* A finished step steps back so the eye lands on what is left. */
  .pk-guide-step.is-done .pk-guide-step-title { color: var(--pk-muted); font-weight: 500; }

  .pk-guide-links { display: flex; flex-wrap: wrap; gap: 0.35rem 1.25rem; margin-top: 1rem; }

  /* ---- layout ---- */

  /* Asymmetric on purpose. Equal columns say the two panels matter equally, and
     they do not: losses are the job, earners are the reference point. */
  .pk-split {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: 1.5rem 2.75rem;
  }
  .pk-split-r { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); }

  @media (max-width: 56rem) {
    .pk-split,
    .pk-split-r { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }
  }

  /* Panels are separated by a rule, not nested in their own cards — the Polaris
     section already draws one, and a card inside a card reads as clutter. */
  .pk-widget {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-top: 1rem;
    border-top: 1px solid var(--pk-rule);
  }
  .pk-widget-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0 0 0.7rem;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--pk-ink);
  }
  .pk-widget-lead .pk-widget-title { font-size: 1rem; }
  .pk-widget-meta {
    margin-left: auto;
    font-weight: 400;
    font-size: 0.75rem;
    color: var(--pk-muted);
  }
  .pk-widget-empty { margin: 0; font-size: 0.88rem; }

  /* ---- ranked lists ---- */

  .pk-case-name {
    font: inherit;
    font-weight: 600;
    font-size: 1rem;
    color: var(--pk-ink);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
    border-bottom: 1px solid transparent;
  }
  .pk-case-name:hover { border-bottom-color: var(--pk-ink); }
  .pk-case-name:focus-visible { outline: 2px solid #2F4858; outline-offset: 2px; }

  .pk-ranked { list-style: none; margin: 0; padding: 0; }
  .pk-ranked-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.15rem 0.75rem;
    padding-block: 0.4rem;
    border-bottom: 1px solid var(--pk-hair);
  }
  .pk-ranked-row:last-child { border-bottom: 0; }
  .pk-ranked-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.9rem;
    text-align: right;
    color: var(--pk-ink);
  }
  .pk-ranked-note {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    color: var(--pk-muted);
  }

  /* ---- bar charts ---- */

  .pk-panel-lead { margin: 0 0 0.7rem; font-size: 0.95rem; color: var(--pk-ink); }
  .pk-panel-note {
    margin: 0.8rem 0 0;
    max-width: 64ch;
    font-size: 0.78rem;
    color: var(--pk-muted);
  }

  .pk-trend { list-style: none; margin: 0; padding: 0; }
  .pk-trend-row {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) 6rem;
    align-items: center;
    gap: 0.75rem;
    padding-block: 0.3rem;
  }
  .pk-trend-month { font-size: 0.82rem; color: var(--pk-body); }
  .pk-trend-month abbr { text-decoration: none; color: var(--pk-faint); }
  .pk-trend-track { display: block; height: 0.75rem; background: var(--pk-track); border-radius: 2px; }
  .pk-trend-bar { display: block; height: 100%; background: var(--pk-bar); border-radius: 2px; }
  .pk-trend-bar-loss { background: var(--pk-loss); }
  .pk-trend-value {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    text-align: right;
    color: var(--pk-ink);
  }

  .pk-vendors { list-style: none; margin: 0; padding: 0; }
  .pk-vendor-row {
    display: grid;
    grid-template-columns: minmax(7rem, 1fr) minmax(0, 2fr) 6rem;
    align-items: center;
    gap: 0.75rem;
    padding-block: 0.32rem;
  }
  .pk-vendor-name {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
    font-size: 0.86rem;
    color: var(--pk-ink);
  }
  .pk-vendor-count { font-size: 0.72rem; color: var(--pk-faint); }
  .pk-vendor-track { display: block; height: 0.7rem; background: var(--pk-track); border-radius: 2px; }
  .pk-vendor-bar { display: block; height: 100%; background: var(--pk-bar); border-radius: 2px; }
  .pk-vendor-bar-loss { background: var(--pk-loss); }
  .pk-vendor-value {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    text-align: right;
    color: var(--pk-ink);
  }

  /* ---- coverage and erosion ---- */

  .pk-coverage { list-style: none; margin: 0; padding: 0; }
  .pk-coverage-row {
    display: grid;
    grid-template-columns: 0.6rem minmax(0, 1fr) 3rem 7rem;
    align-items: center;
    gap: 0.6rem;
    padding-block: 0.32rem;
    font-size: 0.88rem;
  }
  .pk-tier-dot { width: 0.6rem; height: 0.6rem; border-radius: 2px; }
  .pk-tier-measured  { background: #212B1B; }
  .pk-tier-grouped   { background: var(--pk-bar); }
  .pk-tier-estimated { background: #9BAD90; }
  .pk-tier-unset     { background: var(--pk-track); box-shadow: inset 0 0 0 1px #C6CFC0; }
  .pk-coverage-label { color: var(--pk-body); }
  .pk-coverage-count,
  .pk-coverage-revenue {
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--pk-ink);
  }
  .pk-coverage-count { color: var(--pk-muted); }

  .pk-erosion { list-style: none; margin: 0 0 1rem; padding: 0; }
  .pk-erosion li {
    display: grid;
    grid-template-columns: minmax(0, 6rem) 7rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.75rem;
    padding-block: 0.34rem;
    border-top: 1px solid var(--pk-rule);
    font-size: 0.9rem;
  }
  .pk-erosion li span:nth-child(2) {
    font-variant-numeric: tabular-nums;
    text-align: right;
    font-weight: 600;
  }
  .pk-erosion-detail { color: var(--pk-muted); font-size: 0.82rem; }

  @media (max-width: 52rem) {
    .pk-trend-row { grid-template-columns: 3rem minmax(0, 1fr) 5rem; gap: 0.5rem; }
    .pk-coverage-row { grid-template-columns: 0.6rem minmax(0, 1fr) 2.5rem 5.5rem; }
    .pk-erosion li { grid-template-columns: minmax(0, 1fr) auto; }
    .pk-erosion-detail { grid-column: 1 / -1; }
  }
  @media (max-width: 40rem) {
    .pk-vendor-row { grid-template-columns: minmax(0, 1fr) 5.5rem; }
    .pk-vendor-track { display: none; }
  }

  /* ---- suspects and the estimate form ---- */

  .pk-suspects {
    margin: 0.6rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.9rem;
    color: var(--pk-body);
  }
  .pk-suspects li { padding-block: 0.15rem; }

  .pk-estimate {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.6rem 0.75rem;
  }
  .pk-estimate-field { flex: 0 1 14rem; min-width: 0; }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
