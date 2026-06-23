/**
 * FetchProvider — provider-abstracted anti-bot fetch tier (PRD-style provider/factory split).
 *
 * The normal robots-respecting fetch (lib/verification/fetchUrl) and the headless render tier
 * can't pass managed bot challenges (Cloudflare "Just a moment…", Toast/Squarespace SPA shells).
 * A FetchProvider is the LAST resort in the fetch ladder: a cloud reader that renders the page
 * server-side and returns either cleaned text or a full-page screenshot we feed to vision.
 *
 * One implementation today (Jina Reader). The interface keeps it swappable — selected via the
 * factory in ./index, which returns null when no provider is configured (clean no-op).
 */
export interface AntiBotFetchResult {
  ok: boolean;
  /** Cleaned page text (markdown), present for fetchText successes. */
  contentText?: string;
  /** Full-page screenshot PNG bytes (base64), present for fetchScreenshot successes. */
  imageBase64?: string;
  imageMediaType?: "image/png";
  /** The provider itself reported the target blocked/unreachable (distinct from a thrown error). */
  blocked?: boolean;
  error?: string;
}

export interface FetchProvider {
  /** Stable identifier for ledger attribution / logs (e.g. "jina-reader"). */
  readonly name: string;
  /** Cleaned-text read of the URL (cheaper). */
  fetchText(url: string): Promise<AntiBotFetchResult>;
  /** Full-page screenshot of the URL (for image/Toast menus the text read can't see). */
  fetchScreenshot(url: string): Promise<AntiBotFetchResult>;
}
