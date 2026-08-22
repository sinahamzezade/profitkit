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
 * Verified live: `GET https://profitkit.vercel.app/guide` returns 200. The page now
 * titles itself "How to use Redline" in source, but the deployed copy still says
 * Profitkit until the marketing site is redeployed — that site publishes by CLI, not
 * on push. The URL keeps the old brand because the Vercel subdomain is a real
 * resource and renaming it would break this link.
 *
 * Two earlier states, both worth remembering:
 *
 *  - It read "https://profitkit.app/guide", a domain lifted from this repo's own
 *    docs and never checked. profitkit.app is live and belongs to a *different*
 *    company — a Shopify ad-spend tool in the same category — so the dashboard was
 *    routing merchants to a competitor.
 *  - It was then blank, because the page existed in ../marketing but that route
 *    404ed in production. The site turned out to be deployed by CLI rather than from
 *    git, so pushing the page never published it.
 *
 * The domain is a Vercel preview subdomain and therefore temporary. When a custom
 * domain is registered this needs updating, and the check is the same one both
 * times: request the URL and read the status code.
 */
export const GUIDE_URL = "https://profitkit.vercel.app/guide";

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
