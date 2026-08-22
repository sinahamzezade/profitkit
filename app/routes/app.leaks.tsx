import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { dayWord } from "../text";
import { authenticate } from "../shopify.server";
import { resolveTierForShop, resolveTierLimits } from "../billing/tier";
import { PRO_PLAN } from "../billing/plan";
import { loadShopCostConfig } from "../ingestion/dbToDomain";
import { loadOrdersForMargin } from "../reports/productMargin.server";
import {
  buildErosionReport,
  NO_REASON_RECORDED,
  UNCODED_DISCOUNT,
  type DiscountPerformance,
  type ErosionBucket,
  type ErosionMonth,
} from "../reports/erosion";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return { ready: false as const };

  // Gating happens here, before the query — the free tier gets less data, not a
  // full report with pieces hidden in the markup.
  const tier = await resolveTierForShop(session.shop, billing);
  const limits = resolveTierLimits(tier, new Date());

  const [orders, config, anyOrder] = await Promise.all([
    loadOrdersForMargin(shop.id, limits.since ?? undefined),
    loadShopCostConfig(shop.id),
    prisma.order.findFirst({ where: { shopId: shop.id }, select: { currencyCode: true } }),
  ]);

  const report = buildErosionReport(orders, config);

  return {
    ready: true as const,
    report,
    limits: { tier: limits.tier, windowDays: limits.windowDays },
    currency: anyOrder?.currencyCode ?? "USD",
  };
};

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

function monthName(key: string) {
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * Discounts and refunds side by side, month by month.
 *
 * They're drawn on one shared scale so the comparison is honest — the point of the
 * chart is that refunds dwarf discounts here, and separate scales would hide it.
 */
function MonthlyLeaks({
  months,
  formatMoney,
}: {
  months: ErosionMonth[];
  formatMoney: (cents: number) => string;
}) {
  if (months.length === 0) {
    return <s-paragraph>No discounts or refunds in this period.</s-paragraph>;
  }
  const peak = Math.max(...months.map((m) => m.total), 1);

  return (
    <ol className="pk-months">
      {months.map((month, index) => {
        const partial = index === 0 || index === months.length - 1;
        return (
          <li className="pk-month" key={month.month}>
            <span className="pk-month-name">
              {monthName(month.month)}
              {partial && <abbr title="Partial month">*</abbr>}
            </span>
            <span className="pk-month-track">
              <i
                className="pk-month-bar pk-bar-discount"
                style={{ width: `${(month.discounts / peak) * 100}%` }}
                title={`${formatMoney(month.discounts)} in discounts`}
              />
              <i
                className="pk-month-bar pk-bar-refund"
                style={{ width: `${(month.refunds / peak) * 100}%` }}
                title={`${formatMoney(month.refunds)} in refunds`}
              />
            </span>
            <span className="pk-month-total">{formatMoney(month.total)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The verdict on each code.
 *
 * "You gave away $1,477" is only half a fact. What matters is whether the orders
 * carrying that code earned more than orders without one — a code that lifts
 * average order value pays for itself, and one that just discounts people who
 * would have bought anyway does not.
 */
function DiscountVerdicts({
  performance,
  baseline,
  uncoded,
  formatMoney,
}: {
  performance: DiscountPerformance[];
  baseline: number | null;
  uncoded: ErosionBucket | undefined;
  formatMoney: (cents: number) => string;
}) {
  if (performance.length === 0) {
    return (
      <s-paragraph>
        <s-text tone="neutral">No discount codes were used in this period.</s-text>
      </s-paragraph>
    );
  }

  return (
    <>
      <p className="pk-lede">
        {baseline == null ? (
          <>
            Every order in this period used a code, so there&apos;s no undiscounted
            baseline to compare against yet.
          </>
        ) : (
          <>
            An order with no code earns{" "}
            <strong className="pk-mono">{formatMoney(baseline)}</strong> on average.
            Each code is measured against that.
          </>
        )}
      </p>

      <ul className="pk-codes">
        {performance.map((code) => {
          const paid = code.versusBaseline >= 0;
          return (
            <li className="pk-code" key={code.code}>
              <span className="pk-code-name">{code.code}</span>
              <span className={`pk-code-verdict${paid ? " pk-ok" : " pk-bad"}`}>
                {baseline == null
                  ? `${formatMoney(code.marginPerOrder)} an order`
                  : `${paid ? "+" : "−"}${formatMoney(Math.abs(code.versusBaseline))} an order`}
              </span>
              <span className="pk-code-detail">
                {code.orders} {code.orders === 1 ? "order" : "orders"} ·{" "}
                {formatMoney(code.given)} given away ·{" "}
                {formatMoney(code.marginPerOrder)} margin an order
              </span>
            </li>
          );
        })}
      </ul>

      {uncoded && (
        <p className="pk-note">
          A further {formatMoney(uncoded.amount)} came off automatically or by hand.
          Shopify attaches no code to those, so they can&apos;t be scored.
        </p>
      )}
    </>
  );
}

/**
 * Refund reasons, with the unknown bucket pulled out of the ranking.
 *
 * "No reason recorded" is usually the largest single bucket, and leaving it in the
 * list puts an absence of data at the top of a table meant to show causes. It's a
 * data-quality fact, so it's reported as one.
 */
function RefundReasons({
  reasons,
  unknownAmount,
  totalRefunds,
  formatMoney,
}: {
  reasons: ErosionBucket[];
  unknownAmount: number;
  totalRefunds: number;
  formatMoney: (cents: number) => string;
}) {
  const known = reasons.filter((r) => r.label !== NO_REASON_RECORDED);
  const unknownShare = totalRefunds === 0 ? 0 : unknownAmount / totalRefunds;
  const peak = Math.max(...known.map((r) => r.amount), 1);

  return (
    <>
      {known.length === 0 ? (
        <s-paragraph>
          <s-text tone="neutral">
            No refund in this period carries a reason, so there&apos;s nothing to rank.
          </s-text>
        </s-paragraph>
      ) : (
        <ul className="pk-reasons">
          {known.map((reason) => (
            <li className="pk-reason" key={reason.label}>
              <span className="pk-reason-name">{reason.label}</span>
              <span className="pk-reason-track">
                <i
                  className="pk-reason-bar"
                  style={{ width: `${(reason.amount / peak) * 100}%` }}
                />
              </span>
              <span className="pk-reason-value">{formatMoney(reason.amount)}</span>
              <span className="pk-reason-count">
                {reason.count} {reason.count === 1 ? "line" : "lines"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {unknownAmount > 0 && (
        <s-banner tone="info" heading="Most refunds carry no reason">
          {formatMoney(unknownAmount)} — {Math.round(unknownShare * 100)}% of refunded
          money — was refunded straight from the order page, where Shopify stores no
          reason at all. Processing returns through Shopify&apos;s Returns flow is what
          puts a reason on them.
        </s-banner>
      )}
    </>
  );
}

export default function Leaks() {
  const data = useLoaderData<typeof loader>();
  /*
   * Typed rather than bare. An untyped `useFetcher()` gives `data: any`, so reading
   * `upgrade.data.error` type-checks whether or not the action ever returns that
   * shape — which is how the refusal went unnoticed. This mirrors what
   * app/routes/app.upgrade.tsx returns when Shopify declines the charge.
   */
  const upgrade = useFetcher<{ error?: string; detail?: string | null }>();

  if (!data.ready) {
    return (
      <s-page heading="Discounts & refunds">
        <s-section>
          <s-banner tone="info" heading="No orders yet">
            Once this store has orders, discount and refund erosion shows up here.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const { report, limits, currency } = data;
  const formatMoney = (cents: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

  const uncoded = report.discountsByCode.find((b) => b.label === UNCODED_DISCOUNT);

  return (
    <s-page heading="Discounts & refunds">
      <style>{PK_STYLES}</style>

      <s-section>
        {/* Two numbers, framed as the different problems they are. A discount is a
            decision; a refund is a failure. Showing them as one figure answers neither. */}
        <div className="pk-split">
          <div className="pk-split-half">
            <span className="pk-split-value">{formatMoney(report.totalDiscounts)}</span>
            <span className="pk-split-label">given away in discounts</span>
            <span className="pk-split-note">A choice you made</span>
          </div>
          <div className="pk-split-half">
            <span className="pk-split-value pk-bad">{formatMoney(report.totalRefunds)}</span>
            <span className="pk-split-label">handed back in refunds</span>
            <span className="pk-split-note">A sale that came undone</span>
          </div>
        </div>
        {limits.windowDays && (
          <p className="pk-note">
              Over the last {limits.windowDays} {dayWord(limits.windowDays)}.
            </p>
        )}
      </s-section>

      <s-section heading="Month by month">
        <div className="pk-key">
          <span className="pk-key-item">
            <i className="pk-swatch pk-bar-discount" />
            Discounts
          </span>
          <span className="pk-key-item">
            <i className="pk-swatch pk-bar-refund" />
            Refunds
          </span>
        </div>
        <MonthlyLeaks months={report.months} formatMoney={formatMoney} />
        <p className="pk-note">
          * Partial month — the reporting window starts and ends mid-month.
        </p>
      </s-section>

      <s-section heading="Did each code pay for itself?">
        <DiscountVerdicts
          performance={report.discountPerformance}
          baseline={report.baselineMarginPerOrder}
          uncoded={uncoded}
          formatMoney={formatMoney}
        />
      </s-section>

      <s-section heading="Why things came back">
        <RefundReasons
          reasons={report.refundsByReason}
          unknownAmount={report.refundsWithoutReason}
          totalRefunds={report.totalRefunds}
          formatMoney={formatMoney}
        />
      </s-section>

      {/*
        `windowDays` is tested as well as the tier. On free it is always set, so this
        reads as belt-and-braces — but the type is `number | null`, and without the
        test a null would have rendered "You're seeing the last  days." rather than
        failing, which is the kind of thing that ships.
      */}
      {limits.tier === "free" && limits.windowDays !== null && (
        <s-section heading="On the free plan">
          <s-stack gap="base">
            <s-paragraph>
              You&apos;re seeing the last {limits.windowDays}{" "}
              {dayWord(limits.windowDays)}. Pro adds full history and an
              accountant-ready export for ${PRO_PLAN.amount} a month.
            </s-paragraph>
            <s-button
              variant="primary"
              {...(upgrade.state !== "idle" ? { loading: true } : {})}
              onClick={() =>
                upgrade.submit({}, { method: "POST", action: "/app/upgrade" })
              }
            >
              Upgrade to Pro
            </s-button>
            {/* A refused charge used to surface as nothing at all: the action threw,
                the fetcher held the error, and no one read it. */}
            {upgrade.data?.error && (
              <s-banner tone="critical" heading="Could not start the subscription">
                <s-stack gap="small-200">
                  <s-paragraph>{upgrade.data.error}</s-paragraph>
                  {upgrade.data.detail && (
                    <s-paragraph>{upgrade.data.detail}</s-paragraph>
                  )}
                </s-stack>
              </s-banner>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

/** Scoped to `pk-`; shares the ledger palette with the other views. */
const PK_STYLES = `
  .pk-split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 1rem 2.5rem;
  }
  .pk-split-half { display: flex; flex-direction: column; gap: 0.1rem; }
  .pk-split-value {
    font-variant-numeric: tabular-nums;
    font-size: 1.9rem;
    font-weight: 600;
    line-height: 1.05;
    color: #10160F;
  }
  .pk-split-label { font-size: 0.9rem; color: #4A5348; }
  .pk-split-note { font-size: 0.78rem; color: #96A08F; }

  .pk-ok  { color: #2E5E3A; }
  .pk-bad { color: #B3261E; }
  .pk-mono { font-variant-numeric: tabular-nums; }

  .pk-lede { margin: 0 0 0.9rem; font-size: 0.95rem; color: #10160F; }
  .pk-note { margin: 0.8rem 0 0; font-size: 0.78rem; color: #6B7367; max-width: 66ch; }

  .pk-key { display: flex; gap: 1.1rem; margin-bottom: 0.7rem; font-size: 0.76rem; color: #6B7367; }
  .pk-key-item { display: inline-flex; align-items: center; gap: 0.35rem; }
  .pk-swatch { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 2px; }

  .pk-bar-discount { background: #7A8A72; }
  .pk-bar-refund   { background: #B3261E; }

  .pk-months { list-style: none; margin: 0; padding: 0; }
  .pk-month {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr) 6.5rem;
    align-items: center;
    gap: 0.8rem;
    padding-block: 0.4rem;
  }
  .pk-month-name { font-size: 0.85rem; color: #4A5348; }
  .pk-month-name abbr { text-decoration: none; color: #96A08F; }
  /* Stacked, one scale: the comparison between the two is the whole point. */
  .pk-month-track { display: flex; flex-direction: column; gap: 2px; }
  .pk-month-bar { display: block; height: 0.5rem; border-radius: 2px; min-width: 1px; }
  .pk-month-total {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    text-align: right;
    color: #10160F;
  }

  .pk-codes { list-style: none; margin: 0; padding: 0; }
  .pk-code {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.15rem 1rem;
    padding-block: 0.6rem;
    border-top: 1px solid #E4E9E0;
  }
  .pk-code-name { font-weight: 600; font-size: 0.95rem; color: #10160F; }
  .pk-code-verdict {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.95rem;
    text-align: right;
  }
  .pk-code-detail { grid-column: 1 / -1; font-size: 0.78rem; color: #6B7367; }

  .pk-reasons { list-style: none; margin: 0 0 1rem; padding: 0; }
  .pk-reason {
    display: grid;
    grid-template-columns: minmax(7rem, 1fr) minmax(0, 1.6fr) 6rem 4rem;
    align-items: center;
    gap: 0.75rem;
    padding-block: 0.32rem;
    font-size: 0.86rem;
  }
  .pk-reason-name { color: #10160F; }
  .pk-reason-track { display: block; height: 0.6rem; background: #F1F4EE; border-radius: 2px; }
  .pk-reason-bar { display: block; height: 100%; background: #B3261E; border-radius: 2px; opacity: 0.8; }
  .pk-reason-value {
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: #10160F;
  }
  .pk-reason-count { font-size: 0.76rem; color: #96A08F; text-align: right; }

  @media (max-width: 48rem) {
    .pk-month { grid-template-columns: 4.5rem minmax(0, 1fr) 5.5rem; gap: 0.5rem; }
    .pk-reason { grid-template-columns: minmax(0, 1fr) 5.5rem; }
    .pk-reason-track, .pk-reason-count { display: none; }
  }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
