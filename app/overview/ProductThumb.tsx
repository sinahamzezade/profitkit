import { useState } from "react";

/**
 * Product cut via Polaris `s-thumbnail`.
 *
 * No `src` is the documented empty state — Shopify draws the placeholder icon.
 * Same path when the CDN 404s: drop `src` and the placeholder takes over.
 * `alt` is empty because the product name sits next to it.
 *
 * The loss tick lives on the wrapper. Polaris rejects `style` on the tag itself,
 * and red is only for rows that actually lost money.
 */
export function ProductThumb({
  url,
  loss,
}: {
  url: string | null;
  loss: boolean;
}) {
  const [src, setSrc] = useState<string | null>(url);

  return (
    <span className={`pk-thumb${loss ? " is-loss" : ""}`}>
      <s-thumbnail
        alt=""
        size="small-200"
        {...(src ? { src } : {})}
        onError={() => setSrc(null)}
      />
    </span>
  );
}
