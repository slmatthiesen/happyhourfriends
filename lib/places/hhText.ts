/**
 * hhText — the ONE canonical happy-hour text/URL matcher.
 *
 * Historically three places matched "happy hour" with three different regexes:
 * harvest-hh.ts used the spaced form only (`"happy hour"`) in its content/JSON-LD/
 * snippet scanners, so sites styling it "Happy-Hour" or "HappyHour" were missed and
 * the venue wrongly stayed a stub. siteTriage.ts used the correct `/happy[-_ ]?hour/i`.
 * Everyone imports from here now so the spellings can never drift again.
 */

/** Matches `happy hour` / `happy-hour` / `happyhour` / `happy_hour`, any case. */
export const HH_RE = /happy[-_ ]?hour/i;

/** True when the text mentions happy hour in any common spelling/case. */
export function matchesHappyHour(text: string): boolean {
  return HH_RE.test(text);
}

/**
 * A broader "any inkling of a deal" signal: specials / daily / industry night /
 * drink deals / "happy hr" / a time-range like 3-6pm (the second time must carry am/pm so
 * plain dates and "Mon-Fri" don't false-match). Deliberately permissive — it gates the
 * PAID extractor and the operator's rule is "skip only pages with ZERO indication".
 */
export const DEAL_RE =
  /\bspecials?\b|drink\s*deals?|\bdaily\b|industry\s*night|happy\s*hr\b|\b\d{1,2}\s*(?:[ap]\.?m\.?)?\s*[-–—]+\s*\d{1,2}\s*[ap]\.?m\.?/i;

/**
 * True when page text shows ANY happy-hour or deal signal. This is the free local gate
 * in front of the paid Claude extractor: no signal → don't spend a token (the page has no
 * happy hour to find). The inverse of the realness gate in [[capture-everything-realness-filter]].
 */
export function hasHhOrDealSignal(text: string): boolean {
  return HH_RE.test(text) || DEAL_RE.test(text);
}

/**
 * Likelihood that a URL points at HH info, for ordering candidate pages
 * most→least likely. Higher = check first. 0 = no signal.
 *
 *   explicit happy-hour page         100  (+10 if it also says "menu")
 *   specials                          70
 *   drink / cocktail / wine / beer    60   (a drinks menu often carries HH)
 *   food menu                         40
 *   generic menu(s)                   30
 *   anything else                      0
 */
export function scoreHhUrl(url: string): number {
  const u = url.toLowerCase();
  if (HH_RE.test(u)) return 100 + (/menu/.test(u) ? 10 : 0);
  if (/special/.test(u)) return 70;
  if (/(beer|drink|cocktail|wine)[-_ ]?menu|\/(drinks|cocktails)\b/.test(u)) return 60;
  if (/food[-_ ]?menu/.test(u)) return 40;
  if (/\/menus?\b/.test(u)) return 30;
  return 0;
}
