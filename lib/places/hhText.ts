/**
 * hhText — the ONE canonical happy-hour text/URL matcher.
 *
 * Historically three places matched "happy hour" with three different regexes:
 * harvest-hh.ts used the spaced form only (`"happy hour"`) in its content/JSON-LD/
 * snippet scanners, so sites styling it "Happy-Hour" or "HappyHour" were missed and
 * the venue wrongly stayed a stub. siteTriage.ts used the correct `/happy[-_ ]?hour/i`.
 * Everyone imports from here now so the spellings can never drift again.
 */

/** Matches `happy hour` / `happy-hour` / `happyhour` / `happy_hour`, any case — plus the
 *  synonyms venues actually use for the same thing, each found in live data during the
 *  2026-06-11 operator flag review: "Happier Hours" (The Monica), "Social Hour" (PYRO —
 *  operator: "sometimes it's called social hour"), "Power Hour" (Orangedale Lounge).
 *  The plain `happy` branch deliberately also matches "happyhour" URLs/slugs.
 *  Multilingual terms (2026-06-16, Iberia's /vermut-hour/ was missed twice): ethnic venues
 *  label HH in their own language — "vermut hour" / "hora del vermut" / "hora feliz" (Spanish),
 *  "aperitivo" / "apericena" (Italian). Anchored to avoid false hits ("vermut hour" not bare
 *  "vermouth" the ingredient; "hora" only with feliz/vermut). High-value for diverse metros + SF.
 *  Aperitif-time rebrands (2026-06-29, Pausa Bar & Cookery, San Mateo): upscale bars rebrand HH as
 *  "Spritz Hour" / "Sunset Hour" / "Sundowners" and put the deal in a PDF — Google's "happy hour"
 *  search FOUND Pausa, but its "Spritz Hour Menu" anchor scored 0 here, so the PDF lost the byte
 *  budget and we extracted nothing. "Golden hour" is deliberately omitted — it's a photography/patio
 *  term far more often than an HH name, so it would systematically false-escalate. */
export const HH_RE =
  /happ(?:y|ier)[-_ ]?hours?|social[-_ ]?hour|power[-_ ]?hour|spritz[-_ ]?hours?|sunset[-_ ]?hours?|sundowners?|vermut[-_ ]?hours?|hora[-_ ]?(?:feliz|del[-_ ]?vermut)|aperitivo|apericena/i;

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
/** A concrete time-range like "3-6pm" / "3 pm – 6 pm" (the second time must carry am/pm
 *  so plain dates and "Mon-Fri" don't false-match). Exported on its own because it's the
 *  "page text states an actual SCHEDULE" signal — stronger than a mere HH mention. */
export const TIME_RANGE_RE = /\b\d{1,2}\s*(?:[ap]\.?m\.?)?\s*[-–—]+\s*\d{1,2}\s*[ap]\.?m\.?/i;

export const DEAL_RE = new RegExp(
  `\\bspecials?\\b|drink\\s*deals?|\\bdaily\\b|industry\\s*night|happy\\s*hr\\b|${TIME_RANGE_RE.source}`,
  "i",
);

/** URLs embedded in page text (canonical links, JSON, HTTP headers) carry path slugs like
 *  "/menu/happy-hour" that are NOT content. Catch-all sites (kingyenrestaurant.com/menu/<anything>
 *  serves the menu for ANY path) make such a slug meaningless, yet HH_RE would match it and fake a
 *  happy hour. Strip URLs before signal-matching so only real page CONTENT counts — Perle's
 *  "open at 3:00 for happy hour" survives; King Yen's URL slug does not (operator 2026-06-15). */
const URL_NOISE_RE = /https?:\/\/\S+/gi;
const signalText = (text: string): string => text.replace(URL_NOISE_RE, " ");

/**
 * True when page text shows ANY happy-hour or deal signal. This is the free local gate
 * in front of the paid Claude extractor: no signal → don't spend a token (the page has no
 * happy hour to find). The inverse of the realness gate in [[capture-everything-realness-filter]].
 */
export function hasHhOrDealSignal(text: string): boolean {
  const t = signalText(text);
  return HH_RE.test(t) || DEAL_RE.test(t);
}

/** The actual substring that tripped hasHhOrDealSignal — so a review can see WHICH word
 *  escalated a page ("happy hour" vs a loose deal token like "daily"/"specials"/a time range). */
export function hhOrDealMatch(text: string): string | null {
  const t = signalText(text);
  return HH_RE.exec(t)?.[0] ?? DEAL_RE.exec(t)?.[0] ?? null;
}

/** A concrete dollar amount like "$9" / "$ 12" / "$5.50" (some sites render "$ 9"). */
export const PRICE_TOKEN_RE = /\$\s?\d/;

/** Global price matcher for counting — "$8", "$ 9", "$5.50", but not the "$5" inside a URL slug. */
const PRICE_TOKEN_GLOBAL = /\$\s?\d+(?:\.\d{2})?/g;

/**
 * Count distinct dollar-prices in page CONTENT (URLs stripped first, so a "$5" buried in a
 * query string or CDN path doesn't inflate the tally). This is the under-capture signal: a
 * block-menu page (Wix OOI / Squarespace / Toast) lists many priced HH items, and when the
 * free parser captures only a fraction of them we escalate to the paid extractor. See
 * [[freeUndercapturedOfferings]].
 */
export function countPriceTokens(text: string): number {
  const content = signalText(text);
  return (content.match(PRICE_TOKEN_GLOBAL) ?? []).length;
}

/** Worded deal signals that imply an actual DISCOUNT or priced offering, NOT a mere
 *  schedule. Deliberately omits the bare time-range, bare "daily", and bare "happy hour"
 *  that DEAL_RE/HH_RE allow — those describe WHEN, not WHAT, so a time-only page never trips
 *  this. */
export const DEAL_WORDS_RE =
  /\bspecials?\b|drink\s*deals?|\$\d+\s*off|\d+%\s*off|half[-\s]?off|half[-\s]?price|1\/2[-\s]?(?:off|price)|\bbogo\b|two[-\s]?for[-\s]?one|industry\s*night/i;

/**
 * True when page CONTENT shows an actual deal or price (dollar amounts or discount wording),
 * as opposed to a bare schedule. This is the escalation trigger for the enrich free-first
 * gate: when the $0 parser captured a window but ZERO offerings yet the page clearly lists
 * priced deals, the shallow text parser dropped them — fall through to the paid extractor
 * (PDF / image / JSON-LD / sub-page) to recover them. Narrower than [[hasHhOrDealSignal]] on
 * purpose: "Happy Hour Mon–Fri 3–6pm" with no prices is genuinely bare and must NOT escalate
 * ($0 path preserved). Operator decision 2026-06-18: price OR deal-words, excluding bare time.
 */
export function hasPriceOrDealSignal(text: string): boolean {
  const t = signalText(text);
  return PRICE_TOKEN_RE.test(t) || DEAL_WORDS_RE.test(t);
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
  // Decode percent-escapes and the '+' that CDNs use for spaces in filenames, so a
  // "happy+hour_2.PNG" / "happy%20hour.pdf" scores as a happy-hour URL instead of 0 (the
  // HH_RE separator class is `[-_ ]`, not `+`). This drove Bei Sushi's HH image to rank 0.
  let u = url.toLowerCase();
  try { u = decodeURIComponent(u); } catch { /* malformed escape — score the raw form */ }
  u = u.replace(/\+/g, " ");
  if (HH_RE.test(u)) return 100 + (/menu/.test(u) ? 10 : 0);
  if (/special/.test(u)) return 70;
  if (/(beer|drink|cocktail|wine)[-_ ]?menu|\/(drinks|cocktails)\b/.test(u)) return 60;
  if (/food[-_ ]?menu/.test(u)) return 40;
  if (/\/menus?\b/.test(u)) return 30;
  return 0;
}

/** A MENU/HH/drink document by NAME — happy/social/power hour, HH, specials, a menu (the word
 *  anywhere, not just a /menu path), drinks/cocktails/bar/wine/beer, or a multilingual HH term.
 *  Deliberately EXCLUDES bare meal words (dinner/lunch/brunch/food) and dish nouns, so a "Dinner
 *  Menu.jpg" matches (via `menu`) but a "Berry-Pie.png" / "item-3.jpg" / "food-2.jpg" dish photo
 *  does not. Operator vocabulary, 2026-06-20. Anchored with word boundaries to avoid false hits
 *  (barbecue ≠ bar). */
const MENU_DOC_RE =
  /happ(?:y|ier)[-_ ]?hours?|social[-_ ]?hour|power[-_ ]?hour|spritz[-_ ]?hours?|sundowners?|\bhh\b|special|\bmenu\b|\bdrinks?\b|cocktail|\bbar\b|\bwine\b|\bbeer\b|aperitivo|vermut|apericena|hora[-_ ]?(?:feliz|del[-_ ]?vermut)|prix[-_ ]?fixe|tasting/i;

/**
 * True when a media file's NAME marks it a menu/HH/drink document worth a paid read — as opposed
 * to a decorative dish photo. Decodes `%20`/`+` first (so "Online%20Menu.jpg" and "happy+hour.png"
 * match — the bug that scoreHhUrl's slash-anchored `/menus?` test missed). The gate for whether an
 * IMAGE escalates to the paid extractor (every page has images; only menu-ish ones earn a read).
 */
export function looksLikeMenuDoc(url: string): boolean {
  let u = url.toLowerCase();
  try { u = decodeURIComponent(u); } catch { /* malformed escape — match the raw form */ }
  // Normalize EVERY non-letter run (`_`, `+`, `-`, `.`, digits, `/`) to a space so the word
  // boundaries are clean: `nudo_menu` / `0menu2` / `drink-menu` all expose the word `menu`.
  // (\bmenu\b failed on "nudo_menu" — `_` is a word char, so there was no boundary; that
  // false-dropped Nudo Ramen's menu image.) Lean inclusive — the goal is maximizing recall.
  u = u.replace(/[^a-z]+/g, " ");
  return MENU_DOC_RE.test(u);
}
