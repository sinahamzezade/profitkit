import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

/*
  No favicon is declared here — but NOT for the reason this comment used to give.

  It previously claimed that declaring /icon.png blanked every route in the embedded
  admin, based on a three-deploy bisect. That was wrong. The bisect was confounded:
  reverting to byte-identical known-good code still reproduced the blank, which
  ruled the favicon out at the time, and the real cause has since been found and
  fixed — the overview's entrance animation ran opacity 0 -> 1 with fill-mode both,
  and CSS animations do not advance while a page produces no frames, so an unfocused
  admin iframe held the content invisible indefinitely. See app/overview/styles.ts.

  That explains every symptom the old note listed: heading present because the
  heading was never animated, server healthy because nothing had failed, and a
  restart appearing to fix it because the window regained focus.

  The favicon is simply still undeclared, which is cosmetic. Adding it back should
  be safe now; nobody has retried it.
*/
export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
