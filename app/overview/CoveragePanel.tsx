import { TIER_LABELS, type CostCoverage } from "../reports/costCoverage";
import { WidgetBody } from "./ShowMore";

/**
 * How much of the catalog's cost data is measured rather than guessed.
 *
 * The percentage is a caveat, not a loss — ink, not red. The track is share of
 * revenue. The rung-by-rung mix lives on cost settings, not here.
 */
export function CoveragePanel({
  coverage,
  formatMoney,
}: {
  coverage: CostCoverage;
  formatMoney: (cents: number) => string;
}) {
  if (coverage.totalProducts === 0) return null;

  const loosePercent = Math.round(coverage.looseShare * 100);

  return (
    <s-section heading="How solid these numbers are">
      <WidgetBody
        more={{ href: "/app/settings", accessibilityLabel: "Show cost settings" }}
      >
        <div>
          <p className="pk-dash-figure">{loosePercent}%</p>
          <p className="pk-blotter-support">
            of revenue has a cost that&apos;s a guess.
          </p>
        </div>

        <span
          className="pk-conf"
          role="img"
          aria-label={`${loosePercent}% of revenue rests on a cost that is an estimate`}
        >
          {coverage.bands.map((band) => (
            <i
              key={band.tier}
              className={`pk-conf-seg pk-tier-${band.tier}`}
              style={{ flexGrow: Math.max(band.revenue, 1) }}
              title={`${TIER_LABELS[band.tier]} · ${band.products}`}
            />
          ))}
        </span>

        {coverage.nextStep && (
          <p className="pk-panel-note">
            Biggest single improvement: set a cost for{" "}
            <s-link href="/app/settings">{coverage.nextStep.vendor}</s-link>
            {" — "}
            {coverage.nextStep.products}{" "}
            {coverage.nextStep.products === 1 ? "product" : "products"} carrying{" "}
            {formatMoney(coverage.nextStep.revenue)} of revenue.
          </p>
        )}

        {/* The panel that tells a merchant their numbers are estimates is the place
            to offer the thing that stops them being estimates. */}
        {loosePercent > 0 && (
          <p className="pk-panel-note">
            Or replace the guesswork outright:{" "}
            <s-link href="/app/costs/import">import a cost sheet</s-link>.
          </p>
        )}
      </WidgetBody>
    </s-section>
  );
}
