/**
 * stubSiteGate — first-party "should this no-HH stub stay listed?" classifier.
 *
 * Google's place type and `serves_alcohol` flag are unreliable in BOTH directions (a
 * counter-service deli flagged serves_alcohol=true; a closed cocktail bar still typed `bar`),
 * so we don't trust them to keep an embarrassing no-alcohol lunch spot off the site. This gate
 * decides from the venue's OWN fetched page text instead:
 *
 *   keep  → alcohol-positive by type/name (bar/pub/brewery/winery/… — never lose a real bar),
 *           OR the site itself shows alcohol / happy-hour evidence.
 *   hide  → site is dead/parked/empty (no presence to crowdsource from),               [option 3]
 *           OR a live site that shows NO alcohol and NO happy-hour evidence.            [option 1]
 *
 * Pure + hermetic (the fetch happens in the caller) so the rule has one home and a unit test.
 * "hide" maps to venues.status='no_happy_hour' (reversible — revives on a future HH insert).
 */
import { hasAlcoholSignal } from "@/lib/places/chainDenylist";

/**
 * Alcohol / happy-hour evidence in a venue's OWN page text. Deliberately PRECISE: it does NOT
 * include "menu", "special", or a bare "bar" (those fire on any restaurant — a deli has a
 * "menu", a "sushi bar", etc.). Only drink-specific tokens and explicit happy-hour phrasing,
 * matched word-aware so "wine" doesn't hit "winery road" etc.
 */
export const SITE_ALCOHOL_RE = new RegExp(
  "\\b(?:" +
    [
      "happy\\s*hours?", "social\\s*hour", "aperitivo",
      "beers?", "wines?", "winery", "cocktails?", "margaritas?", "sangria", "mimosas?",
      "spirits", "whiske?y", "bourbon", "tequila", "mezcal", "vodka", "sake", "cider",
      "lager", "pilsner", "ipa", "stout", "porter", "prosecco", "champagne", "negroni",
      "martinis?", "mai\\s*tai", "aperol", "spritz", "brewery", "brewing", "taproom",
      "draft\\s*beers?", "draught", "on\\s*tap", "full\\s*bar", "wine\\s*list",
      "beer\\s*list", "craft\\s*beer", "by\\s*the\\s*glass", "wine\\s*bar", "cocktail\\s*bar",
    ].join("|") +
    ")\\b",
  "i",
);

/** Placeholder / parked / suspended page text — a domain with no real venue presence. */
export const PARKED_SITE_RE = new RegExp(
  [
    "website is ready", "content is to be added", "this domain is (?:for sale|parked)",
    "buy this domain", "domain (?:for sale|parking|is for sale)", "under construction",
    "default (?:web ?)?page", "ispsystem", "account suspended", "coming soon",
    "site (?:not found|under maintenance)", "future home of", "page is parked",
  ].join("|"),
  "i",
);

export type StubSiteAction = "keep" | "hide";
export interface StubSiteVerdict {
  action: StubSiteAction;
  reason: string;
}

export interface StubSiteSignals {
  name: string | null;
  primaryType: string | null;
  types: string[] | null;
  /** Did the venue's own site fetch return usable content? false = dead/unreachable/4xx. */
  siteReachable: boolean;
  /** Concatenated text fetched from the venue's own page(s); "" when unreachable. */
  siteText: string;
  /** Site is alive but we couldn't READ it (bot-wall / robots-blocked / 403). Not "dead" —
   *  we just can't assess it, so we don't hide on a guess. */
  siteUnreadable?: boolean;
}

/** Minimum real-content length below which a "reachable" page is treated as empty/placeholder. */
const MIN_CONTENT_CHARS = 200;

export function classifyStubSite(s: StubSiteSignals): StubSiteVerdict {
  // KEEP — alcohol-positive by Google type or venue name (bar/pub/brewery/winery/taproom/public
  // house/tasting room/…). The highest-value crowdsource stub, kept even when the site is
  // dead/parked: a known bar with a dormant website is still worth listing (operator steer).
  if (hasAlcoholSignal(s.name, s.primaryType, s.types)) {
    return { action: "keep", reason: "alcohol-positive type/name" };
  }

  // KEEP — alive but unreadable (bot-wall / robots / 403): we can't assess it, so never hide
  // on a guess. A Cloudflare-challenged page is not a dead site.
  if (s.siteUnreadable && !s.siteText.trim()) {
    return { action: "keep", reason: "site unreadable (bot-walled/robots) — uncertain, not hidden" };
  }

  // HIDE [option 3] — no real first-party presence to crowdsource from.
  if (!s.siteReachable) return { action: "hide", reason: "site dead/unreachable" };
  const text = s.siteText.trim();
  if (text.length < MIN_CONTENT_CHARS || PARKED_SITE_RE.test(text)) {
    return { action: "hide", reason: "parked/placeholder/empty site" };
  }

  // KEEP — the venue's own site shows alcohol or happy-hour evidence.
  if (SITE_ALCOHOL_RE.test(text)) return { action: "keep", reason: "site shows alcohol/HH evidence" };

  // HIDE [option 1] — live site, no alcohol and no happy-hour evidence (the Achilles case).
  return { action: "hide", reason: "live site, no alcohol or HH evidence" };
}
