import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

/**
 * The app's public root, for anyone who reaches the app URL outside the admin.
 *
 * Two things were wrong with the scaffold version this replaces.
 *
 * It carried a shop-domain form — a `name="shop"` input hinting
 * `my-shop-domain.myshopify.com` — which App Store requirement 2.3.1 forbids:
 * installation has to start from a Shopify-owned surface, not from the merchant
 * typing their own domain. The same field was removed from /auth/login, and this
 * page is where it actually faced the public.
 *
 * It also still held the template's placeholder copy: "A short heading about
 * [your app]" and three "Product feature" bullets. A reviewer opening the app URL
 * would have seen an unfinished app.
 *
 * The form posted to /auth/login, whose action no longer exists, so it was broken
 * as well as non-compliant.
 *
 * The loader's redirect is kept and is the part that matters: a request arriving
 * with a `shop` parameter is Shopify-originated and goes straight to /app.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Redline</h1>
        <p className={styles.text}>
          Revenue isn&apos;t profit. Redline shows which products lose you money
          once cost of goods, payment fees, shipping and refunds come off.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Contribution margin per product</strong>. Every product
            ranked by what is left after its real costs, not by revenue.
          </li>
          <li>
            <strong>The reason, not just the number</strong>. Each loss-making
            product names the single cost that put it under.
          </li>
          <li>
            <strong>No customer data</strong>. Redline reads the money on an
            order, never the person who placed it.
          </li>
        </ul>
        <p className={styles.text}>
          Redline is installed from the Shopify App Store. If you already have
          it, open it from Apps in your Shopify admin.
        </p>
        <a className={styles.button} href="https://redlineapp.tech">
          About Redline
        </a>
      </div>
    </div>
  );
}
