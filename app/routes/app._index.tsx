import { useState } from "react";
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
import { setGlobalCogsPercent } from "../costs/repository";
import { loadShopCostConfig } from "../ingestion/dbToDomain";
import {
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
import {
  buildHeroReport,
  DRIVER_LABELS,
} from "../reports/lossLeaders";

/** Days of order history the report covers, from the data itself rather than a guess. */
async function resolvePeriodDays(shopId: string): Promise<number> {
  const [oldest, newest] = await Promise.all([
    prisma.order.findFirst({
      where: { shopId },
      orderBy: { createdAtShopify: "asc" },
      select: { createdAtShopify: true },
    }),
    prisma.order.findFirst({
      where: { shopId },
      orderBy: { createdAtShopify: "desc" },
      select: { createdAtShopify: true },
    }),
  ]);
  if (!oldest || !newest) return 0;
  const days = Math.round(
    (newest.createdAtShopify.getTime() - oldest.createdAtShopify.getTime()) /
      86_400_000,
  );
  return Math.max(1, days);
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
  const [orders, periodDays, anyOrder] = await Promise.all([
    loadOrdersForMargin(shop.id, limits.since ?? undefined),
    resolvePeriodDays(shop.id),
    prisma.order.findFirst({
      where: { shopId: shop.id },
      select: { currencyCode: true },
    }),
  ]);
  const erosion = buildErosionReport(orders);

  const rows = aggregateByProduct(orders, config);
  const report = applyReportOptions(rows, { pageSize: 100_000 });
  const currency = anyOrder?.currencyCode ?? "USD";

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
    hasCostData: hasAnyCogsConfigured(config.cogsEntries),
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

/**
 * The onboarding rung that makes the whole view work: one number, applied to
 * everything, so a merchant who has never entered a cost still gets a real answer.
 */
function CostEstimatePrompt({ hasCostData }: { hasCostData: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const [percent, setPercent] = useState("45");
  const saving = fetcher.state !== "idle";

  return (
    <s-section heading={hasCostData ? "Adjust your cost estimate" : "Start here"}>
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
          Once you&apos;ve seen the shape of the answer, refine it per supplier and
          add payment fees and shipping cost in{" "}
          <s-link href="/app/settings">cost settings</s-link>.
        </s-text>
      </s-paragraph>
    </s-section>
  );
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

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
          A trend needs at least two months of orders. Keep the app installed and this
          fills in.
        </s-text>
      </s-paragraph>
    );
  }

  const peak = Math.max(...months.map((m) => Math.abs(m.contributionMargin)), 1);

  // Only complete months are compared. The window starts and ends mid-month, so
  // holding a part-month against a whole one always reads as a collapse — an alarm
  // about nothing, and the fastest way to lose a merchant's trust in the number.
  const complete = months.slice(1, -1);
  const latest = complete.length >= 2 ? complete[complete.length - 1] : null;
  const previous = complete.length >= 2 ? complete[complete.length - 2] : null;
  const change =
    latest && previous ? latest.contributionMargin - previous.contributionMargin : null;

  return (
    <>
      <p className="pk-panel-lead">
        {change == null || !latest || !previous ? (
          <s-text tone="neutral">
            Not enough whole months yet to compare. The months below include partial
            ones at each end.
          </s-text>
        ) : change === 0 ? (
          <>
            {monthName(latest.month)} held level against {monthName(previous.month)}.
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
      <p className="pk-panel-note">* Partial month — the reporting window starts and ends mid-month.</p>
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
        <strong>{Math.round(coverage.looseShare * 100)}%</strong> of your revenue has a
        cost that&apos;s a guess.
      </p>
      <ul className="pk-coverage">
        {coverage.bands.map((band) => (
          <li className="pk-coverage-row" key={band.tier}>
            <span className={`pk-tier-dot pk-tier-${band.tier}`} />
            <span className="pk-coverage-label">{TIER_LABELS[band.tier]}</span>
            <span className="pk-coverage-count">{band.products}</span>
            <span className="pk-coverage-revenue">{formatMoney(band.revenue)}</span>
          </li>
        ))}
      </ul>
      {coverage.nextStep && (
        <p className="pk-panel-note">
          Biggest single improvement: set a cost for <strong>{coverage.nextStep.vendor}</strong>{" "}
          — {coverage.nextStep.products}{" "}
          {coverage.nextStep.products === 1 ? "product" : "products"} carrying{" "}
          {formatMoney(coverage.nextStep.revenue)} of revenue.
        </p>
      )}
    </>
  );
}

/** A KPI tile. Value first, label under it — the number is what's being scanned. */
function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "loss" | "plain";
}) {
  return (
    <div className="pk-kpi">
      <span className={`pk-kpi-value${tone === "loss" ? " pk-down" : ""}`}>{value}</span>
      <span className="pk-kpi-label">{label}</span>
      {detail && <span className="pk-kpi-detail">{detail}</span>}
    </div>
  );
}

/** Compact ranked list shared by the loss and earner widgets. */
function RankedProducts({
  rows,
  formatMoney,
  onOpen,
  emptyText,
}: {
  rows: Array<{ productId: string; title: string; contributionMargin: number; note?: string }>;
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
          <button type="button" className="pk-case-name" onClick={() => onOpen(row.title)}>
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
  const peak = Math.max(...vendors.map((v) => Math.abs(v.contributionMargin)), 1);

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
                style={{ width: `${(Math.abs(vendor.contributionMargin) / peak) * 100}%` }}
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
      </s-page>
    );
  }

  const {
    hero,
    currency,
    hasCostData,
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

  return (
    <s-page heading="Profit overview">
      <style>{PK_STYLES}</style>
      <s-button slot="primary-action" onClick={() => navigate("/app/products")}>
        See every product
      </s-button>

      {!hasCostData && <CostEstimatePrompt hasCostData={false} />}

      {/* KPI strip. Four figures that frame everything below — no sparklines, no
          percentage-change badges against a period nobody chose. */}
      <s-section>
        <div className="pk-kpis">
          <Kpi
            label={`Contribution margin · ${hero.periodDays} days`}
            value={formatMoney(totalMargin)}
            detail={
              marginPercent == null
                ? undefined
                : `${(marginPercent * 100).toFixed(1)}% of revenue`
            }
          />
          <Kpi label="Revenue after discounts" value={formatMoney(totalRevenue)} />
          <Kpi
            label="Products losing money"
            value={String(hero.losers.length)}
            detail={`of ${productCount} sold`}
            tone={hero.losers.length > 0 ? "loss" : "plain"}
          />
          <Kpi
            label="Given back"
            value={formatMoney(erosion.totalDiscounts + erosion.totalRefunds)}
            detail="discounts and refunds"
            tone="loss"
          />
        </div>
      </s-section>

      <s-section heading="Margin by month">
        <TrendPanel months={months} formatMoney={formatMoney} />
      </s-section>

      <s-section>
        <div className="pk-grid">
          <section className="pk-widget">
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

          <section className="pk-widget">
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

          <section className="pk-widget">
            <h3 className="pk-widget-title">How solid these numbers are</h3>
            <CoveragePanel coverage={coverage} formatMoney={formatMoney} />
          </section>

          <section className="pk-widget">
            <h3 className="pk-widget-title">Discounts and refunds</h3>
            <ul className="pk-erosion">
              <li>
                <span>Discounts</span>
                <span>{formatMoney(erosion.totalDiscounts)}</span>
                <span className="pk-erosion-detail">
                  {erosion.topCode ? `${erosion.topCode.label} is the largest` : "No codes used"}
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
            <s-button onClick={() => navigate("/app/leaks")}>Break this down</s-button>
          </section>

          <section className="pk-widget pk-widget-wide">
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
            {hero.suspect.length === 1 ? "product costs" : "products cost"} more than
            three times what they sell for. That is usually a decimal point in the
            wrong place rather than a real loss, so they are kept out of the figures
            above.
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
                — cost {formatMoney(row.cogs)} against {formatMoney(row.revenue)} of
                revenue
              </li>
            ))}
          </ul>
        </s-section>
      )}

      {hasCostData && <CostEstimatePrompt hasCostData />}
    </s-page>
  );
}

const PK_STYLES = `
  .pk-cases {
    --pk-cost-1: #212B1B;
    --pk-cost-2: #47573E;
    --pk-cost-3: #6E8064;
    --pk-cost-4: #9BAD90;
    --pk-loss:   #B3261E;
    --pk-rule:   #D8DED2;
    margin-top: 1.1rem;
  }

  .pk-finding {
    margin: 0 0 0.3rem;
    font-size: 1.05rem;
    color: #10160F;
  }
  .pk-finding-amount {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #B3261E;
  }
  .pk-method {
    margin: 0;
    font-size: 0.85rem;
    color: #6B7367;
    max-width: 64ch;
  }

  .pk-case {
    padding: 0.95rem 0 1rem;
    border-top: 1px solid var(--pk-rule);
  }
  .pk-case:last-child { border-bottom: 1px solid var(--pk-rule); }

  .pk-case-head {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
  }
  .pk-rank {
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    color: #96A08F;
    min-width: 1ch;
    flex: none;
  }
  .pk-case-name {
    font: inherit;
    font-weight: 600;
    font-size: 1rem;
    color: #10160F;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
    border-bottom: 1px solid transparent;
  }
  .pk-case-name:hover { border-bottom-color: #10160F; }
  .pk-case-name:focus-visible { outline: 2px solid #2F4858; outline-offset: 2px; }

  /* A quiet marker, not a pill: the swatch points at the bar, the words name it. */
  .pk-cause {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.76rem;
    color: #6B7367;
    flex: none;
  }
  .pk-swatch {
    display: inline-block;
    width: 0.55rem; height: 0.55rem;
    border-radius: 2px;
    flex: none;
  }

  .pk-case-total {
    margin-left: auto;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 1.15rem;
    color: var(--pk-loss);
    flex: none;
  }
  .pk-case-total-ok { color: #10160F; }
  .pk-case-period {
    display: block;
    font-weight: 400;
    font-size: 0.72rem;
    color: #6B7367;
  }

  .pk-verdict {
    margin: 0;
    font-size: 0.9rem;
    color: #4A5348;
    max-width: 70ch;
  }
  .pk-per-unit { color: #10160F; font-weight: 600; }

  .pk-case-thin { padding-block: 0.75rem; }
  .pk-case-thin .pk-case-head { align-items: center; }

  /* ---- dashboard ---- */

  .pk-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.25rem 1.5rem;
  }
  .pk-kpi {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.2rem 0;
  }
  .pk-kpi-value {
    font-variant-numeric: tabular-nums;
    font-size: 1.55rem;
    font-weight: 600;
    line-height: 1.1;
    color: #10160F;
  }
  .pk-kpi-label { font-size: 0.78rem; color: #4A5348; }
  .pk-kpi-detail { font-size: 0.74rem; color: #96A08F; }

  .pk-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(23rem, 1fr));
    gap: 1.4rem 2rem;
  }
  /* Widgets are separated by rules rather than nested cards — the Polaris section
     already draws a card, and a card inside a card reads as clutter. */
  .pk-widget {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-top: 1rem;
    border-top: 1px solid #E4E9E0;
  }
  .pk-widget-wide { grid-column: 1 / -1; }
  .pk-widget-title {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0 0 0.7rem;
    font-size: 0.92rem;
    font-weight: 600;
    color: #10160F;
  }
  .pk-widget-meta {
    margin-left: auto;
    font-weight: 400;
    font-size: 0.75rem;
    color: #6B7367;
  }
  .pk-widget-empty { margin: 0; font-size: 0.88rem; }

  .pk-ranked { list-style: none; margin: 0; padding: 0; }
  .pk-ranked-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.15rem 0.75rem;
    padding-block: 0.4rem;
    border-bottom: 1px solid #EFF2ED;
  }
  .pk-ranked-row:last-child { border-bottom: 0; }
  .pk-ranked-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.9rem;
    text-align: right;
    color: #10160F;
  }
  .pk-ranked-note {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    color: #6B7367;
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
    font-size: 0.86rem;
    color: #10160F;
    min-width: 0;
  }
  .pk-vendor-count { font-size: 0.72rem; color: #96A08F; }
  .pk-vendor-track { display: block; height: 0.7rem; background: #F1F4EE; border-radius: 2px; }
  .pk-vendor-bar { display: block; height: 100%; background: #47573E; border-radius: 2px; }
  .pk-vendor-bar-loss { background: #B3261E; }
  .pk-vendor-value {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    text-align: right;
    color: #10160F;
  }

  @media (max-width: 40rem) {
    .pk-vendor-row { grid-template-columns: minmax(0, 1fr) 5.5rem; }
    .pk-vendor-track { display: none; }
  }

  /* ---- panels ---- */

  .pk-panel-lead { margin: 0 0 0.7rem; font-size: 0.95rem; color: #10160F; }
  .pk-panel-note {
    margin: 0.8rem 0 0;
    font-size: 0.78rem;
    color: #6B7367;
    max-width: 64ch;
  }
  .pk-up { color: #10160F; }
  .pk-down { color: #B3261E; }

  .pk-trend { list-style: none; margin: 0; padding: 0; }
  .pk-trend-row {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) 6rem;
    align-items: center;
    gap: 0.75rem;
    padding-block: 0.3rem;
  }
  .pk-trend-month { font-size: 0.82rem; color: #4A5348; }
  .pk-trend-month abbr { text-decoration: none; color: #96A08F; }
  .pk-trend-track { display: block; height: 0.75rem; background: #F1F4EE; border-radius: 2px; }
  .pk-trend-bar { display: block; height: 100%; background: #47573E; border-radius: 2px; }
  .pk-trend-bar-loss { background: #B3261E; }
  .pk-trend-value {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    text-align: right;
    color: #10160F;
  }

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
  .pk-tier-grouped   { background: #47573E; }
  .pk-tier-estimated { background: #9BAD90; }
  .pk-tier-unset     { background: #F1F4EE; box-shadow: inset 0 0 0 1px #C6CFC0; }
  .pk-coverage-label { color: #4A5348; }
  .pk-coverage-count,
  .pk-coverage-revenue {
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: #10160F;
  }
  .pk-coverage-count { color: #6B7367; }

  .pk-erosion { list-style: none; margin: 0 0 1rem; padding: 0; }
  .pk-erosion li {
    display: grid;
    grid-template-columns: minmax(0, 6rem) 7rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.75rem;
    padding-block: 0.34rem;
    border-top: 1px solid #E4E9E0;
    font-size: 0.9rem;
  }
  .pk-erosion li span:nth-child(2) {
    font-variant-numeric: tabular-nums;
    text-align: right;
    font-weight: 600;
  }
  .pk-erosion-detail { color: #6B7367; font-size: 0.82rem; }

  @media (max-width: 52rem) {
    .pk-trend-row { grid-template-columns: 3rem minmax(0, 1fr) 5rem; gap: 0.5rem; }
    .pk-coverage-row { grid-template-columns: 0.6rem minmax(0, 1fr) 2.5rem 5.5rem; }
    .pk-erosion li { grid-template-columns: minmax(0, 1fr) auto; }
    .pk-erosion-detail { grid-column: 1 / -1; }
  }

  .pk-footnote {
    margin: 1.1rem 0 0;
    font-size: 0.78rem;
    color: #6B7367;
    max-width: 64ch;
  }

  .pk-suspects {
    margin: 0.6rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.9rem;
    color: #4A5348;
  }
  .pk-suspects li { padding-block: 0.15rem; }

  .pk-estimate {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.6rem 0.75rem;
  }
  .pk-estimate-field { flex: 0 1 14rem; min-width: 0; }

  @media (max-width: 40rem) {
    .pk-case-head { flex-wrap: wrap; }
    .pk-cause { order: 3; width: 100%; }
    .pk-case-total { font-size: 1.05rem; }
  }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
