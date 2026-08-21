import type { CostCoverage } from "../reports/costCoverage";
import type { ErosionBucket } from "../reports/erosion";
import type { HeroReport } from "../reports/lossLeaders";
import type {
  MarginDay,
  ProductMarginRow,
  VendorMargin,
} from "../reports/productMargin";
import type { SetupState } from "./setup";

/** How many rows a homepage widget keeps. The rest lives on the destination page. */
export const OVERVIEW_PREVIEW = {
  products: 3,
  vendors: 3,
  suspects: 2,
  drivers: 2,
} as const;

export type OverviewPrevious = {
  contributionMargin: number;
  revenue: number;
  negativeProducts: number;
  givenBack: number;
};

export type OverviewStats = {
  from: string | null;
  to: string | null;
  days: MarginDay[];
  previous: OverviewPrevious | null;
};

export type OverviewErosion = {
  totalDiscounts: number;
  totalRefunds: number;
  topCode: ErosionBucket | null;
  topReason: ErosionBucket | null;
};

export type OverviewReady = {
  state: "ready";
  hero: HeroReport;
  coverage: CostCoverage;
  earners: ProductMarginRow[];
  vendors: VendorMargin[];
  vendorCount: number;
  totalRevenue: number;
  erosion: OverviewErosion;
  currency: string;
  hasCostData: boolean;
  setup: SetupState;
  stats: OverviewStats;
  productCount: number;
  totalMargin: number;
};
