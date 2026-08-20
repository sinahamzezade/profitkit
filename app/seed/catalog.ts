import type { Rng } from "./rng";

export type LossDriver = "cogs" | "shipping" | "discount_refund";

export interface SeedVariant {
  id: string;
  sku: string;
  /** Cents. */
  price: number;
  /** Native Shopify inventoryItem.unitCost — only present for a minority of variants, like real stores. */
  nativeCogs: number | null;
  /** Ground truth cost, always known to the generator even when nativeCogs is null (mirrors a merchant-entered figure). */
  trueCogs: number;
  /** Ground-truth actual shipping cost per unit — never exposed via the Shopify API. */
  trueShippingCostPerUnit: number;
}

export interface SeedProduct {
  id: string;
  title: string;
  vendor: string;
  variant: SeedVariant;
  isPlantedLoser: boolean;
  lossDriver: LossDriver | null;
}

const VENDORS = [
  "Northline Goods",
  "Amberwood Supply",
  "Coastal & Co",
  "Ferro Works",
  "Meadowlane",
  "Pinegate Studio",
] as const;

const PRICE_TIERS: Array<{ value: readonly [number, number]; weight: number }> = [
  { value: [1500, 2500], weight: 20 },
  { value: [3500, 6500], weight: 40 },
  { value: [7000, 12000], weight: 25 },
  { value: [13000, 25000], weight: 15 },
];

const PRODUCT_NOUNS = [
  "Tote",
  "Mug",
  "Candle",
  "Notebook",
  "Blanket",
  "Lamp",
  "Planter",
  "Cutting Board",
  "Backpack",
  "Water Bottle",
  "Coaster Set",
  "Throw Pillow",
  "Apron",
  "Desk Organizer",
  "Wall Print",
];

const PRODUCT_ADJECTIVES = [
  "Classic",
  "Woodland",
  "Coastal",
  "Minimal",
  "Heritage",
  "Everyday",
  "Studio",
  "Prairie",
  "Harbor",
  "Alpine",
];

export function generateCatalog(rng: Rng, count = 62, plantedLosers = 8): SeedProduct[] {
  const products: SeedProduct[] = [];
  const loserIndices = new Set<number>();
  while (loserIndices.size < plantedLosers) {
    loserIndices.add(rng.int(0, count - 1));
  }

  const lossDrivers: LossDriver[] = ["cogs", "shipping", "discount_refund"];

  for (let i = 0; i < count; i++) {
    const [min, max] = rng.weighted(PRICE_TIERS);
    const price = Math.round(rng.int(min, max) / 100) * 100 - 1; // e.g. 4999 cents = $49.99

    const isPlantedLoser = loserIndices.has(i);
    const lossDriver = isPlantedLoser ? lossDrivers[i % lossDrivers.length] : null;

    let cogsPercent: number;
    let shippingCostPerUnit: number;
    if (lossDriver === "cogs") {
      // Cost alone exceeds price on average — negative before fees, shipping, anything.
      cogsPercent = rng.float(0.95, 1.15);
      shippingCostPerUnit = rng.int(300, 600);
    } else if (lossDriver === "shipping") {
      cogsPercent = rng.float(0.4, 0.55);
      // Scaled to price, not a flat amount — a heavy/bulky item costs a fraction of
      // its own price to ship regardless of price tier, so the loss actually shows
      // up whether it's a $20 or $200 product.
      shippingCostPerUnit = Math.round(price * rng.float(0.6, 0.8));
    } else if (lossDriver === "discount_refund") {
      cogsPercent = rng.float(0.55, 0.68);
      shippingCostPerUnit = rng.int(400, 700);
    } else {
      cogsPercent = rng.float(0.35, 0.55);
      shippingCostPerUnit = rng.int(300, 700);
    }

    const trueCogs = Math.round(price * cogsPercent);
    // Real stores rarely have native cost data filled in — mirror the ~0% fill rate we found in the audit.
    const nativeCogs = rng.bool(0.08) ? trueCogs : null;

    const title = `${rng.pick(PRODUCT_ADJECTIVES)} ${rng.pick(PRODUCT_NOUNS)}`;
    const id = `gid://shopify/Product/${9000000 + i}`;
    const variantId = `gid://shopify/ProductVariant/${9100000 + i}`;

    products.push({
      id,
      title,
      vendor: rng.pick(VENDORS),
      isPlantedLoser,
      lossDriver,
      variant: {
        id: variantId,
        sku: `SKU-${String(i + 1).padStart(4, "0")}`,
        price,
        nativeCogs,
        trueCogs,
        trueShippingCostPerUnit: shippingCostPerUnit,
      },
    });
  }

  return products;
}
