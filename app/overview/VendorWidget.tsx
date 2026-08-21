import type { VendorMargin } from "../reports/productMargin";
import { WidgetBody } from "./ShowMore";

/** Margin rolled up by supplier — one negotiation instead of twenty product decisions. */
export function VendorWidget({
  vendors,
  vendorCount,
  formatMoney,
}: {
  vendors: VendorMargin[];
  vendorCount: number;
  formatMoney: (cents: number) => string;
}) {
  if (vendors.length === 0) {
    return (
      <s-section heading="Margin by vendor">
        <WidgetBody>
          <s-paragraph>
            <s-text tone="neutral">No vendors are set on your products.</s-text>
          </s-paragraph>
        </WidgetBody>
      </s-section>
    );
  }
  const peak = Math.max(
    ...vendors.map((v) => Math.abs(v.contributionMargin)),
    1,
  );

  return (
    <s-section heading="Margin by vendor">
      <WidgetBody
        more={
          vendorCount > vendors.length
            ? { href: "/app/products", accessibilityLabel: "Show all products" }
            : undefined
        }
      >
        <ul className="pk-mix">
          {vendors.map((vendor) => {
            const loss = vendor.contributionMargin < 0;
            return (
              <li className="pk-mix-row" key={vendor.vendor}>
                <span className="pk-mix-label">
                  {vendor.vendor}
                  <span className="pk-mix-meta">
                    {vendor.products}{" "}
                    {vendor.products === 1 ? "product" : "products"}
                    {vendor.marginPercent != null
                      ? ` · ${(vendor.marginPercent * 100).toFixed(1)}%`
                      : ""}
                  </span>
                </span>
                <span className="pk-mix-track" aria-hidden="true">
                  <i
                    className={`pk-mix-bar${loss ? " is-loss" : ""}`}
                    style={{
                      transform: `scaleX(${Math.abs(vendor.contributionMargin) / peak})`,
                    }}
                  />
                </span>
                <span
                  className={`pk-mix-value num${loss ? " is-loss" : ""}`}
                >
                  {formatMoney(vendor.contributionMargin)}
                </span>
              </li>
            );
          })}
        </ul>
      </WidgetBody>
    </s-section>
  );
}
