import { NO_REASON_RECORDED } from "../reports/erosion";
import { WidgetBody } from "./ShowMore";
import type { OverviewErosion } from "./types";

/**
 * Discounts and refunds as two figures plus a composition track.
 *
 * The track is why this is a dashboard and not a two-line list: refunds on the
 * seeded store are several times the discounts, and two right-aligned currency
 * strings of similar width hide that. Both amounts are money leaving, so they
 * take loss red — same rule as the Given back card above.
 */
export function ErosionPanel({
  erosion,
  formatMoney,
}: {
  erosion: OverviewErosion;
  formatMoney: (cents: number) => string;
}) {
  const given = erosion.totalDiscounts + erosion.totalRefunds;
  const discountNote = erosion.topCode
    ? `${erosion.topCode.label} is the largest`
    : "No codes used";
  const refundNote = !erosion.topReason
    ? "None"
    : erosion.topReason.label === NO_REASON_RECORDED
      ? "Most have no reason recorded"
      : `Mostly ${erosion.topReason.label.toLowerCase()}`;

  return (
    <s-section heading="Discounts and refunds">
      <WidgetBody
        more={{
          href: "/app/leaks",
          accessibilityLabel: "Show discounts and refunds by code and reason",
        }}
      >
        <div className="pk-pair">
          <div>
            <p className="pk-blotter-kicker">Discounts</p>
            <p
              className={`pk-dash-figure${erosion.totalDiscounts > 0 ? " is-loss" : ""}`}
            >
              {formatMoney(erosion.totalDiscounts)}
            </p>
            <p className="pk-blotter-support">{discountNote}</p>
          </div>
          <div>
            <p className="pk-blotter-kicker">Refunds</p>
            <p
              className={`pk-dash-figure${erosion.totalRefunds > 0 ? " is-loss" : ""}`}
            >
              {formatMoney(erosion.totalRefunds)}
            </p>
            <p className="pk-blotter-support">{refundNote}</p>
          </div>
        </div>

        {given > 0 && (
          <span
            className="pk-conf"
            role="img"
            aria-label={`${formatMoney(erosion.totalDiscounts)} discounts, ${formatMoney(erosion.totalRefunds)} refunds`}
          >
            {erosion.totalDiscounts > 0 && (
              <i
                className="pk-conf-seg pk-conf-disc"
                style={{ flexGrow: erosion.totalDiscounts }}
                title="Discounts"
              />
            )}
            {erosion.totalRefunds > 0 && (
              <i
                className="pk-conf-seg pk-conf-refund"
                style={{ flexGrow: erosion.totalRefunds }}
                title="Refunds"
              />
            )}
          </span>
        )}
      </WidgetBody>
    </s-section>
  );
}
