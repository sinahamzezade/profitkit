import { useNavigate } from "react-router";

import { DRIVER_LABELS } from "../reports/lossLeaders";
import type { ProductMarginRow } from "../reports/productMargin";
import { CostEstimatePrompt } from "./CostEstimatePrompt";
import { CoveragePanel } from "./CoveragePanel";
import { ErosionPanel } from "./ErosionPanel";
import { makeMoneyFormatter, productHref } from "./money";
import type { MoneyRow } from "./MoneyTable";
import { describeWindow, OverviewLead } from "./OverviewLead";
import { setupProgress } from "./setup";
import { SectionHead } from "./SectionHead";
import { SetupGuide } from "./SetupGuide";
import { TrendPanel } from "./TrendPanel";
import { StatBand } from "./StatBand";
import { PK_STYLES } from "./styles";
import { SuspectCosts } from "./SuspectCosts";
import { OVERVIEW_PREVIEW, type OverviewReady } from "./types";
import { VendorWidget } from "./VendorWidget";
import { WhereMoneyGoes } from "./WhereMoneyGoes";

export function OverviewPage({ data }: { data: OverviewReady }) {
  const navigate = useNavigate();
  const {
    hero,
    currency,
    hasCostData,
    setup,
    stats,
    productCount,
    coverage,
    months,
    erosion,
    totalMargin,
    totalRevenue,
    earners,
    vendors,
    vendorCount,
  } = data;
  const formatMoney = makeMoneyFormatter(currency);
  const openProduct = (title: string) => navigate(productHref(title));

  const setupDone = setupProgress(setup).complete;

  const shownLosers = hero.losers.slice(0, OVERVIEW_PREVIEW.products);
  const shownEarners = earners.slice(0, OVERVIEW_PREVIEW.products);

  const moneyRows: MoneyRow[] =
    shownLosers.length > 0
      ? shownLosers.map((leader) => ({
          productId: leader.row.productId,
          title: leader.row.title,
          imageUrl: leader.row.imageUrl,
          unitsSold: leader.row.unitsSold,
          contributionMargin: leader.row.contributionMargin,
          note:
            leader.lossPerUnit != null
              ? `${DRIVER_LABELS[leader.driver]} · loses ${formatMoney(
                  Math.abs(leader.lossPerUnit),
                )} a sale`
              : DRIVER_LABELS[leader.driver],
        }))
      : shownEarners.map((row: ProductMarginRow) => ({
          productId: row.productId,
          title: row.title,
          imageUrl: row.imageUrl,
          unitsSold: row.unitsSold,
          contributionMargin: row.contributionMargin,
          note:
            row.marginPercent == null
              ? undefined
              : `${(row.marginPercent * 100).toFixed(1)}%`,
        }));

  /*
   * The note column asks a different question in each mode, so it is labelled with
   * the question it is actually answering.
   *
   * Ranking losers, the note names the cause the report attributed — "Cost of goods ·
   * loses $14.15 a sale" — and "What's behind it" is the right header. Ranking
   * earners there is no cause: nothing went wrong. The column was filling with
   * "45.0% margin" under a header promising an explanation, which restates the money
   * in the next column as a rate and explains nothing. Labelled "Margin" it is a
   * useful second measure — rate beside amount — and the word drops out of every
   * cell, since the header already says it.
   */
  const moneyNoteHeader = shownLosers.length > 0 ? "What's behind it" : "Margin";

  const moneyLead =
    moneyRows.length === 0
      ? "No products sold in this period."
      : shownLosers.length > 0
        ? `Worst ${moneyRows.length} of ${productCount} sold.`
        : `Nothing sold at a loss. Best ${moneyRows.length} of ${productCount} sold.`;

  return (
    <s-page heading="Profit overview">
      <style>{PK_STYLES}</style>

      {!setupDone && <SetupGuide setup={setup} />}
      {!hasCostData && <CostEstimatePrompt hasCostData={false} />}

      {/*
        Growth's grammar, applied throughout: every group of cards carries a label
        outside it, with the range and a details link opposite. Nothing on the page
        is an unlabelled hero any more — the finding is a labelled section like the
        rest, and the window states itself once, here, instead of in this card's foot
        and again over the cards below.
      */}
      <SectionHead
        title="This period"
        meta={describeWindow({
          from: stats.from,
          to: stats.to,
          compared: stats.previous !== null,
        })}
      />
      <OverviewLead
        losers={hero.losers}
        totalLost={hero.totalLost}
        periodDays={hero.periodDays}
        productCount={productCount}
        formatMoney={formatMoney}
      />

      <StatBand
        days={stats.days}
        previous={stats.previous}
        periodDays={hero.periodDays}
        totalMargin={totalMargin}
        totalRevenue={totalRevenue}
        losingCount={hero.losers.length}
        productCount={productCount}
        givenBack={erosion.totalDiscounts + erosion.totalRefunds}
        formatMoney={formatMoney}
      />

      <WhereMoneyGoes
        lead={moneyLead}
        rows={moneyRows}
        noteHeader={moneyNoteHeader}
        formatMoney={formatMoney}
        onOpen={openProduct}
        moreHref={productCount > moneyRows.length ? "/app/products" : undefined}
      />

      {/*
        Margin by month, which until now was written but never mounted: TrendCoverage
        wrapped it and nothing imported TrendCoverage, so the chart and its whole
        component tree were unreachable. Mounting TrendPanel directly rather than that
        wrapper, because the wrapper also rendered CoveragePanel, which already has a
        tile of its own in the board below.
      */}
      {months.length > 1 && (
        <>
          <SectionHead
            title="Margin over time"
            meta="Whole months only"
            action={
              <s-button variant="tertiary" href="/app/products">
                View details
              </s-button>
            }
          />
          <s-section accessibilityLabel="Margin by month">
            <TrendPanel
              months={months}
              currency={currency}
              formatMoney={formatMoney}
            />
          </s-section>
        </>
      )}

      <SectionHead
        title="Where profit leaks"
        action={
          <s-button variant="tertiary" href="/app/leaks">
            View details
          </s-button>
        }
      />
      <div className="pk-board">
        <div className="pk-tile">
          <ErosionPanel erosion={erosion} formatMoney={formatMoney} />
        </div>
        <div className="pk-tile">
          <VendorWidget
            vendors={vendors}
            vendorCount={vendorCount}
            formatMoney={formatMoney}
          />
        </div>
        {coverage.totalProducts > 0 && (
          <div className="pk-tile">
            <CoveragePanel coverage={coverage} formatMoney={formatMoney} />
          </div>
        )}
      </div>

      <SuspectCosts
        suspects={hero.suspect}
        formatMoney={formatMoney}
        onOpen={openProduct}
      />

      {setupDone && <SetupGuide setup={setup} />}
    </s-page>
  );
}
