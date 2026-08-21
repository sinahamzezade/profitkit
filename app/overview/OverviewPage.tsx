import { useNavigate } from "react-router";

import { DRIVER_LABELS } from "../reports/lossLeaders";
import type { ProductMarginRow } from "../reports/productMargin";
import { CostEstimatePrompt } from "./CostEstimatePrompt";
import { CoveragePanel } from "./CoveragePanel";
import { ErosionPanel } from "./ErosionPanel";
import { makeMoneyFormatter, productHref } from "./money";
import type { MoneyRow } from "./MoneyTable";
import { OverviewLead } from "./OverviewLead";
import { setupProgress } from "./setup";
import { SetupGuide } from "./SetupGuide";
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
              : `${(row.marginPercent * 100).toFixed(1)}% margin`,
        }));

  const moneyLead =
    moneyRows.length === 0
      ? "No products sold in this period."
      : shownLosers.length > 0
        ? `Worst ${moneyRows.length} of ${productCount} sold.`
        : `Nothing sold at a loss. Best ${moneyRows.length} of ${productCount} sold.`;

  return (
    <s-page heading="Profit overview" inlineSize="large">
      <style>{PK_STYLES}</style>

      {!setupDone && <SetupGuide setup={setup} />}
      {!hasCostData && <CostEstimatePrompt hasCostData={false} />}

      <OverviewLead
        losers={hero.losers}
        totalLost={hero.totalLost}
        periodDays={hero.periodDays}
        productCount={productCount}
        from={stats.from}
        to={stats.to}
        compared={stats.previous !== null}
        formatMoney={formatMoney}
      />

      <StatBand
        currency={currency}
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
        formatMoney={formatMoney}
        onOpen={openProduct}
        moreHref={
          productCount > moneyRows.length ? "/app/products" : undefined
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
