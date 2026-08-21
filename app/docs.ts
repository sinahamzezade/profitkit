/**
 * Where the app points merchants for help.
 *
 * One place, because these appear in the dashboard, will appear in the App Store
 * listing, and would otherwise drift apart.
 */

/** Written walkthrough on the marketing site. */
export const GUIDE_URL = "https://profitkit.app/guide";

/**
 * Video walkthrough. Empty until a real video exists.
 *
 * Deliberately blank rather than a placeholder link: `hasVideo` gates the UI, so
 * the link simply does not render until this is filled in. A dead or wrong URL in
 * an onboarding card is worse than no link — the merchant clicks it once, gets
 * nothing, and stops trusting the rest of the card.
 *
 * To enable: paste the watch URL here. Nothing else needs changing.
 */
export const VIDEO_URL = "";

export const hasVideo = VIDEO_URL.trim().length > 0;
