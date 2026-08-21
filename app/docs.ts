/**
 * Where the app points merchants for help.
 *
 * One place, because these appear in the dashboard, will appear in the App Store
 * listing, and would otherwise drift apart.
 *
 * BOTH ARE EMPTY ON PURPOSE. `hasGuide` / `hasVideo` gate the links, so nothing
 * renders until a URL is confirmed. An onboarding link that goes somewhere wrong
 * is worse than no link at all — see below for how that was learned.
 */

/**
 * Written walkthrough.
 *
 * This previously read "https://profitkit.app/guide", a domain taken from this
 * repo's own docs and never verified. profitkit.app is registered and live, and it
 * belongs to a different company: "ProfitKit — Know your real profit. Pause the
 * ads that lose it", a Shopify ad-spend tool. So the dashboard was sending
 * merchants to a competitor in the same category.
 *
 * Fill this in only with a domain that is confirmed registered to Profitkit. The
 * page itself exists in ../marketing at /guide, so once the site is deployed the
 * value is `https://<your-domain>/guide`.
 */
export const GUIDE_URL = "";

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
