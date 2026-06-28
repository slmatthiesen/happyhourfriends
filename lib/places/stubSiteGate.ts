/**
 * stubSiteGate — first-party "should this no-HH stub stay listed?" classifier.
 *
 * Google's place type and `serves_alcohol` flag are unreliable in BOTH directions (a
 * counter-service deli flagged serves_alcohol=true; a closed cocktail bar still typed `bar`),
 * so we don't trust them to keep an embarrassing no-alcohol lunch spot off the site. This gate
 * decides from the venue's OWN fetched page instead. CONSERVATIVE by operator steer (2026-06-28):
 * a live-site restaurant is kept as a crowdsource stub even with no alcohol/HH text — it may well
 * run a happy hour a user can add. We only HIDE when there's no presence to crowdsource from.
 *
 *   keep  → alcohol-positive type/name, alive-but-unreadable (bot-wall), OR any reachable live site.
 *   hide  → bowling alley (never featured), OR a dead / parked / empty domain.
 *
 * Pure + hermetic (the fetch happens in the caller) so the rule has one home and a unit test.
 * "hide" maps to venues.status='no_happy_hour' (reversible — revives on a future HH insert).
 */
import { hasAlcoholSignal, isBowlingAlley } from "@/lib/places/chainDenylist";

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
  // HIDE — bowling alley (operator rule: never feature them, anywhere, even with a bar).
  if (isBowlingAlley(s.name, s.primaryType, s.types)) {
    return { action: "hide", reason: "bowling alley (excluded type)" };
  }

  // KEEP — alcohol-positive type/name: highest-value crowdsource stub, kept even if site dead.
  if (hasAlcoholSignal(s.name, s.primaryType, s.types)) {
    return { action: "keep", reason: "alcohol-positive type/name" };
  }

  // KEEP — alive but unreadable (bot-wall / robots / 403): can't assess, don't hide on a guess.
  if (s.siteUnreadable && !s.siteText.trim()) {
    return { action: "keep", reason: "site unreadable (bot-walled/robots) — uncertain, not hidden" };
  }

  // HIDE — no real first-party presence to crowdsource from (dead / parked / empty domain).
  if (!s.siteReachable) return { action: "hide", reason: "site dead/unreachable" };
  const text = s.siteText.trim();
  if (text.length < MIN_CONTENT_CHARS || PARKED_SITE_RE.test(text)) {
    return { action: "hide", reason: "parked/placeholder/empty site" };
  }

  // KEEP — a live site with real content stays a help-wanted stub even with no alcohol/HH text:
  // a sit-down restaurant may well run a happy hour a user can add (operator steer 2026-06-28).
  return { action: "keep", reason: "live site — crowdsource stub" };
}
