/**
 * Where the app points merchants for help.
 *
 * One place, because these appear in the dashboard, will appear in the App Store
 * listing, and would otherwise drift apart.
 *
 * `hasGuide` / `hasVideo` gate the links, so nothing renders until a URL is
 * confirmed reachable. An onboarding link that goes somewhere wrong is worse than
 * no link at all — see below for how that was learned twice.
 */

/**
 * Written walkthrough.
 *
 * Now on the registered domain rather than the Vercel preview subdomain that
 * preceded it. `redlineapp.tech` is the marketing site; `app.redlineapp.tech` is
 * this app on Railway.
 *
 * Three earlier states, all worth remembering, because two of them were live:
 *
 *  - It read "https://profitkit.app/guide", a domain lifted from this repo's own
 *    docs and never checked. profitkit.app is live and belongs to a *different*
 *    company — a Shopify ad-spend tool in the same category — so the dashboard was
 *    routing merchants to a competitor.
 *  - It was then blank, because the page existed in ../marketing but that route
 *    404ed in production. The site turned out to be deployed by CLI rather than from
 *    git, so pushing the page never published it.
 *  - It then read "https://profitkit.vercel.app/guide", correct but temporary.
 *
 * The check that settles it is the same one every time, and it is the reason two of
 * those three were caught: request the URL and read the status code.
 */
export const GUIDE_URL = "https://redlineapp.tech/guide";

/**
 * Video walkthrough. Empty until a real video exists.
 *
 * Deliberately blank rather than a placeholder link: a dead or wrong URL in an
 * onboarding card is worse than no link — the merchant clicks it once, gets
 * nothing, and stops trusting the rest of the card.
 */
export const VIDEO_URL = "";

export const hasGuide = GUIDE_URL.trim().length > 0;
export const hasVideo = VIDEO_URL.trim().length > 0;
