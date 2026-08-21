import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

/*
  No favicon is declared here, deliberately.

  Declaring /icon.png as the app's icon blanks every route in the embedded admin:
  each page renders its s-page heading and nothing else. Reproduced on three
  deploys — raw <link> in <head> broke it, removing it fixed it, and re-adding it
  through the proper `links` export broke it again — so the mechanism is not where
  the tag was placed. The server stays healthy throughout: it answers, auth
  succeeds, and nothing is logged, which is why this symptom has previously been
  misread as needing a restart.

  Cause not yet established. The brand PNGs still exist under public/brand and are
  served fine; only the head declaration is withheld. The favicon is cosmetic, the
  app working is not.
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
