import { useEffect, useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { loadShopCostConfig } from "../ingestion/dbToDomain";
import { hasAnyCogsConfigured } from "../costs/cogs";
import { resolveTierForShop, resolveTierLimits } from "../billing/tier";
import { type ProductMarginRow, type SortKey } from "../reports/productMargin";
import { buildProductMarginReport } from "../reports/productMargin.server";

const PAGE_SIZE = 50;

/**
 * Sorting is a control now, not nine clickable column headers — the table shows
 * three columns, so header-sorting would only reach a third of the fields.
 */
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "contributionMargin", label: "Margin" },
  { key: "marginPercent", label: "Margin %" },
  { key: "revenue", label: "Revenue" },
  { key: "unitsSold", label: "Units sold" },
  { key: "title", label: "Product name" },
];

const SORT_KEYS = new Set(SORTS.map((s) => s.key));

function parseSortKey(value: string | null): SortKey {
  return value != null && SORT_KEYS.has(value as SortKey)
    ? (value as SortKey)
    : "contributionMargin";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const url = new URL(request.url);

  const shop = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) {
    return {
      ready: false as const,
      report: null,
      currencyCode: "USD",
      hasCostData: false,
    };
  }

  // Tier bound is applied to the query, not to what gets rendered.
  const limits = resolveTierLimits(await resolveTierForShop(session.shop, billing), new Date());

  const config = await loadShopCostConfig(shop.id);
  const report = await buildProductMarginReport(
    shop.id,
    config,
    {
      sortKey: parseSortKey(url.searchParams.get("sort")),
      sortDirection: url.searchParams.get("dir") === "desc" ? "desc" : "asc",
      search: url.searchParams.get("q") ?? "",
      onlyNegative: url.searchParams.get("negative") === "1",
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: PAGE_SIZE,
    },
    limits.since ?? undefined,
  );

  const anyOrder = await prisma.order.findFirst({
    where: { shopId: shop.id },
    select: { currencyCode: true },
  });

  return {
    ready: true as const,
    report,
    currencyCode: anyOrder?.currencyCode ?? "USD",
    hasCostData: hasAnyCogsConfigured(config.cogsEntries),
  };
};

/**
 * The four costs, always in this order. Position carries as much identity as
 * tone does — you learn the order once and then read every bar without a legend.
 */
const COST_PARTS = [
  { key: "cogs", label: "Cost of goods", tone: "var(--pk-cost-1)" },
  { key: "fees", label: "Payment fees", tone: "var(--pk-cost-2)" },
  { key: "shippingDelta", label: "Shipping", tone: "var(--pk-cost-3)" },
  { key: "refunds", label: "Refunds", tone: "var(--pk-cost-4)" },
] as const;

interface Segment {
  key: string;
  label: string;
  tone: string;
  value: number;
  width: number;
}

/**
 * Lays a product's revenue out as a flattened waterfall.
 *
 * The track spans whichever is larger — revenue or total cost — so a product that
 * spent more than it earned still fits, with the revenue line falling short of the
 * end. Everything past that line is loss by definition.
 */
function composeBar(row: ProductMarginRow) {
  // A negative shipping delta means shipping was charged above cost. That's a gain,
  // not a cost segment; it lands in what's kept rather than being drawn as width.
  const costs = COST_PARTS.map((part) => ({
    ...part,
    value: Math.max(0, row[part.key as keyof ProductMarginRow] as number),
  }));

  const totalCost = costs.reduce((sum, c) => sum + c.value, 0);
  const span = Math.max(row.revenue, totalCost);

  if (span <= 0) {
    return { segments: [] as Segment[], revenueLine: 100, overspent: false };
  }

  const segments: Segment[] = costs
    .filter((c) => c.value > 0)
    .map((c) => ({ ...c, width: (c.value / span) * 100 }));

  // What's kept is the *unfilled* remainder of the track, not a segment. Drawing it
  // as a pale fill made refunds — often the second-largest cost — read as empty space.
  return {
    segments,
    revenueLine: (row.revenue / span) * 100,
    overspent: totalCost > row.revenue,
  };
}

export default function Products() {
  const { ready, report, currencyCode, hasCostData } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const formatMoney = (cents: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(
      cents / 100,
    );

  const sortKey = parseSortKey(searchParams.get("sort"));
  const sortDirection = searchParams.get("dir") === "desc" ? "desc" : "asc";

  const updateParams = (
    changes: Record<string, string | null>,
    options?: { replace?: boolean },
  ) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any change to sorting or filtering invalidates the current page number.
    if (!("page" in changes)) next.delete("page");
    setSearchParams(next, options);
  };

  // The search box is controlled locally and pushed into the URL on a delay:
  // Polaris only fires `change` on blur, so without this a merchant types and
  // nothing happens until they click away. `replace` keeps every keystroke out
  // of browser history.
  const urlQuery = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(urlQuery);
  const lastPushedQuery = useRef(urlQuery);

  useEffect(() => {
    if (urlQuery !== lastPushedQuery.current) {
      lastPushedQuery.current = urlQuery;
      setSearchInput(urlQuery);
    }
  }, [urlQuery]);

  useEffect(() => {
    if (searchInput === lastPushedQuery.current) return;
    const timer = setTimeout(() => {
      lastPushedQuery.current = searchInput;
      updateParams({ q: searchInput }, { replace: true });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  if (!ready || !report) {
    return (
      <s-page heading="Product margin">
        <s-section>
          <s-banner tone="info" heading="No data yet">
            This store hasn&apos;t been backfilled. Once orders are ingested, every
            product&apos;s contribution margin shows up here.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  const lastPage = Math.max(1, Math.ceil(report.totalRows / report.pageSize));
  const isFiltered = urlQuery !== "" || searchParams.get("negative") === "1";

  return (
    <s-page heading="Product margin">
      <style>{PK_STYLES}</style>

      <s-section>
        {!hasCostData && (
          <s-banner tone="warning" heading="No cost data yet">
            Every margin below treats cost of goods as zero, so these are revenue
            figures, not profit. Set a global cost estimate to get a real answer in
            under a minute.
          </s-banner>
        )}

        {/* Polaris stacks these full-width, which pushed the first row of data past
            the fold. Laid out here instead so the answer is visible on arrival. */}
        <div className="pk-controls">
          {/* Polaris fields fill their container by design and don't accept style
              overrides, so the sizing lives on wrappers rather than fighting them. */}
          <div className="pk-control pk-control-search">
            <s-text-field
              label="Search products"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search by product or vendor"
              value={searchInput}
              onInput={(event) => setSearchInput(event.currentTarget.value)}
              onChange={(event) => setSearchInput(event.currentTarget.value)}
            />
          </div>
          <div className="pk-control pk-control-sort">
            <s-select
              label="Sort by"
              labelAccessibilityVisibility="exclusive"
              value={sortKey}
              onChange={(event) => updateParams({ sort: event.currentTarget.value })}
            >
              {SORTS.map((s) => (
                <s-option key={s.key} value={s.key}>
                  Sort: {s.label}
                </s-option>
              ))}
            </s-select>
          </div>
          <s-button
            onClick={() => updateParams({ dir: sortDirection === "asc" ? "desc" : "asc" })}
            accessibilityLabel={
              sortDirection === "asc" ? "Sort highest first" : "Sort lowest first"
            }
          >
            {sortDirection === "asc" ? "Lowest first" : "Highest first"}
          </s-button>
          <s-checkbox
            label="Only loss-makers"
            checked={searchParams.get("negative") === "1"}
            onChange={() =>
              updateParams({
                negative: searchParams.get("negative") === "1" ? null : "1",
              })
            }
          />
        </div>

        {/* Counts first, then the reading key. Both earn their line. */}
        <p className="pk-summary">
          {report.totalRows === 0 ? (
            isFiltered ? (
              <>No products match. Clear the search or the loss-maker filter.</>
            ) : (
              <>No products have sold in this period yet.</>
            )
          ) : (
            <>
              <strong>{report.totalRows}</strong> products ·{" "}
              <strong className={report.totals.negativeProducts > 0 ? "pk-is-loss" : undefined}>
                {report.totals.negativeProducts} losing money
              </strong>{" "}
              · {formatMoney(report.totals.contributionMargin)} total margin
              {/* No "showing 1–50" here: the pager below already says which page. */}
            </>
          )}
        </p>

        {report.totalRows > 0 && (
          <>
            <div className="pk-legend" aria-hidden="true">
              <span className="pk-legend-lead">Where revenue went</span>
              {COST_PARTS.map((part) => (
                <span className="pk-legend-item" key={part.key}>
                  <i className="pk-swatch" style={{ background: part.tone }} />
                  {part.label}
                </span>
              ))}
              <span className="pk-legend-item pk-legend-kept">
                <i className="pk-swatch pk-swatch-kept" />
                Unfilled is what&apos;s kept
              </span>
            </div>

            <div className="pk-rows">
              {report.rows.map((row: ProductMarginRow) => {
                const bar = composeBar(row);
                const loss = row.contributionMargin < 0;

                return (
                  <details className="pk-row" key={row.productId}>
                    <summary className="pk-head">
                      <span className="pk-ident">
                        <span className="pk-name">{row.title}</span>
                        <span className="pk-meta">
                          {row.unitsSold} units
                          {row.vendor ? ` · ${row.vendor}` : ""} ·{" "}
                          {formatMoney(row.revenue)} revenue
                          {/* Badge the exception, not the rule: almost everything is
                              estimated, so the badge belongs on what isn't. */}
                          {!row.estimated && <span className="pk-measured">Measured</span>}
                        </span>
                      </span>

                      <span
                        className={`pk-track${bar.overspent ? " pk-overspent" : ""}`}
                        role="img"
                        aria-label={
                          `${formatMoney(row.revenue)} revenue: ` +
                          bar.segments
                            .map((s) => `${s.label} ${formatMoney(s.value)}`)
                            .join(", ") +
                          `. Margin ${formatMoney(row.contributionMargin)}.`
                        }
                      >
                        {bar.segments.map((seg) => (
                          <i
                            className="pk-seg"
                            key={seg.key}
                            style={{ width: `${seg.width}%`, background: seg.tone }}
                          />
                        ))}
                        {bar.overspent && (
                          <i className="pk-revenue-line" style={{ left: `${bar.revenueLine}%` }} />
                        )}
                      </span>

                      <span className="pk-figures">
                        <span className={`pk-margin${loss ? " pk-is-loss" : ""}`}>
                          {formatMoney(row.contributionMargin)}
                        </span>
                        <span className="pk-pct">
                          {row.marginPercent == null
                            ? "—"
                            : `${(row.marginPercent * 100).toFixed(1)}%`}
                        </span>
                      </span>
                    </summary>

                    {/* The numbers the old table showed in nine columns, one click away. */}
                    <div className="pk-ledger">
                      <div className="pk-ledger-line">
                        <span>Revenue after discounts</span>
                        <span>{formatMoney(row.revenue)}</span>
                      </div>
                      {COST_PARTS.map((part) => {
                        const value = row[part.key as keyof ProductMarginRow] as number;
                        return (
                          <div className="pk-ledger-line" key={part.key}>
                            <span>
                              <i className="pk-swatch" style={{ background: part.tone }} />
                              {part.label}
                              {part.key === "shippingDelta" && value < 0 && (
                                <span className="pk-note"> charged above cost</span>
                              )}
                            </span>
                            <span>
                              {value < 0 ? "+" : "−"}
                              {formatMoney(Math.abs(value))}
                            </span>
                          </div>
                        );
                      })}
                      <div className="pk-ledger-rule" />
                      <div className="pk-ledger-line pk-ledger-total">
                        <span>Contribution margin</span>
                        <span className={loss ? "pk-is-loss" : undefined}>
                          {formatMoney(row.contributionMargin)}
                        </span>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </>
        )}

        {lastPage > 1 && (
          <s-stack direction="inline" gap="base">
            <s-button
              disabled={report.page <= 1}
              onClick={() => updateParams({ page: String(report.page - 1) })}
            >
              Previous
            </s-button>
            <s-text>
              Page {report.page} of {lastPage}
            </s-text>
            <s-button
              disabled={report.page >= lastPage}
              onClick={() => updateParams({ page: String(report.page + 1) })}
            >
              Next
            </s-button>
          </s-stack>
        )}
      </s-section>

      <s-section heading="How to read this">
        <s-paragraph>
          Each bar is one product&apos;s revenue, split into what it went on. When the
          costs run past the revenue line, the product sold at a loss.
        </s-paragraph>
        <s-paragraph>
          Shipping cost is never available from Shopify and payment fees are only
          reported for Shopify Payments, so almost every figure here includes at
          least one estimate. Rows built entirely on measured data are marked.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

/**
 * Scoped to `pk-` so nothing here can collide with Polaris. The page chrome stays
 * native to the Shopify admin; only the data surface carries the ledger identity.
 */
const PK_STYLES = `
  .pk-rows {
    /* Four steps far enough apart to separate at 1rem tall. Order is fixed, so
       position identifies a cost as much as tone does. */
    --pk-cost-1: #212B1B;
    --pk-cost-2: #47573E;
    --pk-cost-3: #6E8064;
    --pk-cost-4: #9BAD90;
    --pk-loss:   #B3261E;
    --pk-rule:   #D8DED2;
    margin-top: 0.75rem;
    border-top: 1px solid var(--pk-rule);
  }

  .pk-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }
  .pk-control { min-width: 0; }
  .pk-control-search { flex: 1 1 16rem; }
  .pk-control-sort { flex: 0 0 12rem; }

  .pk-summary {
    margin: 0.8rem 0 0.3rem;
    font-size: 0.9rem;
    color: #4A5348;
  }
  .pk-summary strong { font-weight: 600; color: #10160F; }
  .pk-showing { color: #6B7367; }
  .pk-is-loss { color: #B3261E; }

  .pk-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 1rem;
    padding: 0.5rem 0 0.7rem;
    font-size: 0.75rem;
    color: #6B7367;
    --pk-cost-1: #212B1B;
    --pk-cost-2: #47573E;
    --pk-cost-3: #6E8064;
    --pk-cost-4: #9BAD90;
  }
  .pk-legend-lead { font-weight: 600; color: #4A5348; }
  .pk-legend-item { display: inline-flex; align-items: center; gap: 0.35rem; }
  .pk-swatch {
    display: inline-block;
    width: 0.6rem; height: 0.6rem;
    border-radius: 2px;
    flex: none;
  }
  .pk-swatch-kept { background: #E3EBDB; box-shadow: inset 0 0 0 1px #C6CFC0; }

  .pk-row { border-bottom: 1px solid var(--pk-rule); }

  .pk-head {
    display: grid;
    grid-template-columns: minmax(11rem, 1.15fr) minmax(8rem, 1.6fr) minmax(5.5rem, auto);
    align-items: center;
    gap: 1rem;
    padding: 0.7rem 0.25rem;
    cursor: pointer;
    list-style: none;
  }
  .pk-head::-webkit-details-marker { display: none; }
  .pk-head:hover { background: #F6F8F4; }
  .pk-row[open] .pk-head { background: #F6F8F4; }
  .pk-head:focus-visible { outline: 2px solid #2F4858; outline-offset: -2px; }

  .pk-ident { min-width: 0; }
  .pk-name {
    display: block;
    font-weight: 600;
    font-size: 0.92rem;
    color: #10160F;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pk-meta {
    display: block;
    font-size: 0.75rem;
    color: #6B7367;
    margin-top: 0.1rem;
  }
  .pk-measured {
    display: inline-block;
    margin-left: 0.4rem;
    padding: 0 0.35rem;
    border: 1px solid #C6CFC0;
    border-radius: 2px;
    font-size: 0.68rem;
    color: #4A5348;
  }

  .pk-track {
    position: relative;
    display: flex;
    height: 1.15rem;
    background: #F1F4EE;
    box-shadow: inset 0 0 0 1px #DDE3D7;
    border-radius: 2px;
    overflow: hidden;
  }
  .pk-seg { display: block; height: 100%; }

  /* Past this line the product had already spent everything it earned. */
  .pk-revenue-line {
    position: absolute;
    top: -2px; bottom: -2px;
    width: 2px;
    background: var(--pk-loss);
  }
  .pk-overspent { box-shadow: inset 0 0 0 1px #E0B8B4; }

  .pk-figures { text-align: right; }
  .pk-margin {
    display: block;
    font-variant-numeric: tabular-nums;
    font-feature-settings: "tnum" 1;
    font-weight: 600;
    font-size: 0.95rem;
    color: #10160F;
  }
  .pk-margin.pk-is-loss { color: var(--pk-loss); }
  .pk-pct {
    display: block;
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
    color: #6B7367;
  }

  .pk-ledger {
    padding: 0.2rem 0.25rem 1rem 0.25rem;
    max-width: 26rem;
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
  }
  .pk-ledger-line {
    display: flex;
    justify-content: space-between;
    gap: 1.5rem;
    padding-block: 0.28rem;
    color: #4A5348;
  }
  .pk-ledger-line .pk-swatch { margin-right: 0.45rem; }
  .pk-note { color: #6B7367; font-style: italic; }
  .pk-ledger-rule { border-top: 1px solid #10160F; margin: 0.4rem 0 0.15rem; }
  .pk-ledger-total { font-weight: 600; color: #10160F; }

  @media (max-width: 48rem) {
    .pk-head {
      grid-template-columns: 1fr auto;
      grid-template-areas: "ident figures" "track track";
      gap: 0.5rem 0.75rem;
    }
    .pk-ident { grid-area: ident; }
    .pk-figures { grid-area: figures; }
    .pk-track { grid-area: track; }
    .pk-legend { font-size: 0.7rem; }
  }
`;

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
