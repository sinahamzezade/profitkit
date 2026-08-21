import type { VendorMargin } from "../reports/productMargin";
import { ErosionPanel } from "./ErosionPanel";
import type { OverviewErosion } from "./types";
import { VendorWidget } from "./VendorWidget";

export function LeaksAndVendors({
  erosion,
  vendors,
  vendorCount,
  formatMoney,
}: {
  erosion: OverviewErosion;
  vendors: VendorMargin[];
  vendorCount: number;
  formatMoney: (cents: number) => string;
}) {
  return (
    <s-grid
      gap="base"
      gridTemplateColumns="repeat(auto-fit, minmax(18rem, 1fr))"
    >
      <ErosionPanel erosion={erosion} formatMoney={formatMoney} />
      <VendorWidget
        vendors={vendors}
        vendorCount={vendorCount}
        formatMoney={formatMoney}
      />
    </s-grid>
  );
}
