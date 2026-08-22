import {
  DRIVER_LABELS,
  type LossDriver,
  type LossLeader,
} from "../reports/lossLeaders";
import { dayWord } from "../text";
import { LeadMedia } from "./LeadMedia";
import { OVERVIEW_PREVIEW } from "./types";

/**
 * The period finding, as a blotter rather than a paragraph.
 *
 * Window and comparison live in the section header above, per Growth, which puts
 * the range beside the label rather than inside the card. Cost quality has its own
 * widget below — repeating the track here made the finding compete with a caveat
 * that needs a destination of its own.
 *
 * Deliberately not a second KPI row. The four cards under this already hold
 * margin, revenue, the losing count and money given back.
 */
export function OverviewLead({
  losers,
  totalLost,
  periodDays,
  productCount,
  formatMoney,
}: {
  losers: LossLeader[];
  totalLost: number;
  periodDays: number;
  productCount: number;
  formatMoney: (cents: number) => string;
}) {
  const losing = losers.length;
  const lost = Math.abs(totalLost);
  const drivers = rollupDrivers(losers).slice(0, OVERVIEW_PREVIEW.drivers);

  return (
    <s-section accessibilityLabel="Summary">
      <div className={`pk-blotter${losing > 0 ? " has-drivers" : ""}`}>
        <div className="pk-blotter-hero">
          <div className="pk-blotter-copy">
            <p className="pk-blotter-kicker">
              {losing === 0 ? "This period" : "Lost this period"}
            </p>
            <p
              className={`pk-blotter-figure${losing > 0 ? " is-loss" : ""}`}
            >
              {formatMoney(lost)}
            </p>
            <p className="pk-blotter-support">
              {losing === 0 ? (
                <>
                  Nothing sold at a loss over the last {periodDays}{" "}
                  {dayWord(periodDays)}.
                </>
              ) : (
                <>
                  <span className="num">{losing}</span>{" "}
                  {losing === 1 ? "product" : "products"} of{" "}
                  <span className="num">{productCount}</span> sold · last{" "}
                  <span className="num">{periodDays}</span> {dayWord(periodDays)}
                </>
              )}
            </p>
          </div>
          {losing === 0 && <LeadMedia falling={false} />}
        </div>

        {drivers.length > 0 && (
          <DriverMix drivers={drivers} formatMoney={formatMoney} />
        )}
      </div>
    </s-section>
  );
}

/**
 * Window and comparison, for the section header above this card.
 *
 * They used to sit in a foot inside the card. Growth puts the range in the section
 * header instead, next to the label and opposite the details link, and moving them
 * there also removed a duplication: the window was stated in this card's foot and
 * again as "Last N days" over the cards below it.
 */
export function describeWindow({
  from,
  to,
  compared,
}: {
  from: string | null;
  to: string | null;
  compared: boolean;
}): string {
  const dateFmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  if (!from || !to) return "No orders in this period yet";

  const window = `${dateFmt.format(new Date(from))} – ${dateFmt.format(
    new Date(to),
  )}`;
  return compared
    ? `${window} · compared with the previous period`
    : `${window} · not enough history on this plan to compare`;
}

type DriverSlice = {
  driver: LossDriver;
  cents: number;
  products: number;
};

function rollupDrivers(losers: LossLeader[]): DriverSlice[] {
  const byDriver = new Map<LossDriver, DriverSlice>();
  for (const leader of losers) {
    const current = byDriver.get(leader.driver) ?? {
      driver: leader.driver,
      cents: 0,
      products: 0,
    };
    current.cents += Math.abs(leader.row.contributionMargin);
    current.products += 1;
    byDriver.set(leader.driver, current);
  }
  return [...byDriver.values()].sort((a, b) => b.cents - a.cents);
}

/**
 * The full product loss attributed to whichever driver the ranking named —
 * diagnosis, not a cost-component waterfall. The table below does this per
 * product; this is the same answer rolled up, so a merchant sees whether the
 * period is one problem or five.
 */
function DriverMix({
  drivers,
  formatMoney,
}: {
  drivers: DriverSlice[];
  formatMoney: (cents: number) => string;
}) {
  const peak = Math.max(...drivers.map((d) => d.cents), 1);

  return (
    <div className="pk-blotter-drivers">
      <p className="pk-blotter-kicker">What&apos;s behind it</p>
      <ul className="pk-drivers">
        {drivers.map((slice) => (
          <li className="pk-driver" key={slice.driver}>
            <span className="pk-driver-label">
              {DRIVER_LABELS[slice.driver]}
              <span className="pk-driver-count">
                {slice.products} {slice.products === 1 ? "product" : "products"}
              </span>
            </span>
            <span className="pk-driver-track" aria-hidden="true">
              <i
                className="pk-driver-bar"
                style={{ transform: `scaleX(${slice.cents / peak})` }}
              />
            </span>
            <span className="pk-driver-value num">
              {formatMoney(slice.cents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
