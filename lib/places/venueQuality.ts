/**
 * venueQuality — pure signals for the curation report (scripts/audit-quality.ts), the
 * basis for "get strict": is this a 20–40 metropolitan "appetizer + a drink" spot, or
 * a no-alcohol family/takeout restaurant we shouldn't feature?
 *
 *  - hasAlcoholContent: POSITIVE alcohol evidence from a venue's OWN page text. We can't
 *    trust Google's servesBeer/Wine booleans (false negatives), and we can't prove a
 *    NEGATIVE — so we prove the positive from the menu and bias to RECALL (a false
 *    positive merely keeps a venue; a false negative could wrongly drop a real bar).
 *  - isSquatterHtml: a lapsed-domain / generic restaurant-finder placeholder served
 *    where the venue's real site used to be (Los Metates → "FromTheRestaurant | Find
 *    Restaurants Near You"). Complements siteTriage.isParkedHtml (domain-for-sale).
 *
 * Pure, no I/O.
 */

// Clear drink-menu terms. Deliberately omits ambiguous short tokens (bare "bar", "ale",
// "rum") and uses phrases/word-boundaries so "salad bar", "ginger", "tamale" don't fire.
const ALCOHOL_CONTENT_PATTERNS: RegExp[] = [
  /\bcocktails?\b/i,
  /\bmargaritas?\b/i,
  /\bmartinis?\b/i,
  /\bmojitos?\b/i,
  /\bsangria\b/i,
  /\bmimosas?\b/i,
  /\bprosecco\b/i,
  /\bchampagne\b/i,
  /\btequila\b/i,
  /\bmezcal\b/i,
  /\bwhiske?y\b/i,
  /\bbourbon\b/i,
  /\bvodka\b/i,
  /\bspirits\b/i,
  /\bdraft beer\b/i,
  /\bdraught\b/i,
  /\bon tap\b/i,
  /\bcraft beer\b/i,
  /\bbrewery\b/i,
  /\bipa\b/i,
  /\blagers?\b/i,
  /\bpilsners?\b/i,
  /\bwine list\b/i,
  /\bby the glass\b/i,
  /\b(red|white|glass of) wine\b/i,
  /\bbeer\s*(?:&|and)\s*wine\b/i,
  /\bwine\s*(?:&|and)\s*beer\b/i,
  /\bfull bar\b/i,
  /\bbar menu\b/i,
  /\b(cocktail|wine|sports) bar\b/i,
  /\bhapp(?:y|ier)[-\s]?hours?\b/i,
  /\b21\s*\+|\bmust be 21\b|\b21 (?:and|&) over\b/i,
];

/** True when page text shows clear evidence the venue serves alcohol. */
export function hasAlcoholContent(text: string | null | undefined): boolean {
  if (!text) return false;
  return ALCOHOL_CONTENT_PATTERNS.some((re) => re.test(text));
}

// Generic restaurant-finder / lapsed-domain placeholder templates that replace a real
// venue site when its domain expires. Add markers as new templates surface.
const SQUATTER_MARKERS = [
  "find restaurants near you",
  "fromtherestaurant",
  "discover restaurants near you",
  "browse restaurants near you",
];

/** True when the HTML is a generic restaurant-finder/lapsed-domain squatter page. */
export function isSquatterHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();
  return SQUATTER_MARKERS.some((m) => lower.includes(m));
}

// ── site health ──────────────────────────────────────────────────────────────────
// SACRED (mirrors lib/places/siteTriage): only DNS-failure / 5xx / 404–410 / parked /
// squatter is DEAD. A 403 (bot-wall), 429, timeout, or empty-200 means the site is
// ALIVE but we couldn't read it — that must NEVER read as "dead" and must never let a
// real venue be dropped for "no alcohol" we simply couldn't see (the Boulevard Cafe 403).
export type SiteHealth =
  | "live"          // 2xx with readable text
  | "broken-https"  // TLS failed but readable over plain http
  | "blocked"       // alive but unreadable (403/429/timeout/reset) — bot-wall
  | "unreadable"    // 2xx but no extractable text (JS shell / empty)
  | "dead"          // DNS failure / 5xx / 404–410
  | "squatter"      // lapsed-domain / generic restaurant-finder placeholder
  | "parked"        // domain-for-sale parking page
  | "social-only"   // only a social/ordering link
  | "menu-platform" // only a third-party menu platform (kwickmenu/menu11/wheree)
  | "no-site";      // no website on file

export interface SiteHealthInput {
  hasUrl: boolean;
  isMenuPlatform: boolean;
  isSocial: boolean;
  /** Final fetch (after any https→http fallback): was it a 2xx? */
  ok: boolean;
  status?: number | null;
  /** Pre-classified network error: "dead" (DNS/refused) | "blocked" (timeout/reset) | null. */
  networkError?: "dead" | "blocked" | null;
  hasText: boolean;
  parked: boolean;
  squatter: boolean;
  brokenHttps: boolean;
}

export function classifySiteHealth(p: SiteHealthInput): SiteHealth {
  if (!p.hasUrl) return "no-site";
  if (p.isMenuPlatform) return "menu-platform";
  if (p.isSocial) return "social-only";
  if (p.ok && p.hasText) {
    if (p.squatter) return "squatter";
    if (p.parked) return "parked";
    return p.brokenHttps ? "broken-https" : "live";
  }
  if (p.ok && !p.hasText) return "unreadable";
  if (p.networkError === "dead") return "dead";
  if (p.networkError === "blocked") return "blocked";
  if (typeof p.status === "number") {
    return p.status >= 500 || (p.status >= 404 && p.status <= 410) ? "dead" : "blocked";
  }
  return "blocked"; // unknown failure → SACRED: assume alive, keep
}

// ── curation verdict ───────────────────────────────────────────────────────────
// keep | drop? | review. NEVER "drop?" a venue we couldn't read (blocked/unreadable/
// social-only) — that's "review". And NEVER drop a real bar that simply has no website:
// a no-site venue with alcohol-by-type (Kona Club, Laurel Lounge) is a crowdsource stub,
// flagged for review. A site that EXISTED and is now dead/squatter/parked is different
// (likely closed) → it still overrides alcohol.
const DEAD_SITE = new Set<SiteHealth>(["dead", "squatter", "parked"]);

export function qualityVerdict(p: {
  hhLive: number;
  anyAlcohol: boolean;
  health: SiteHealth;
}): "keep" | "drop?" | "review" {
  if (p.hhLive > 0) return "keep";
  if (p.anyAlcohol) {
    if (p.health === "no-site") return "review"; // real venue, just no website → crowdsource, flag
    if (!DEAD_SITE.has(p.health)) return "keep"; // alcohol on a reachable/unreadable site
    return "drop?"; // alcohol but the site is dead/squatter/parked (likely closed)
  }
  // No alcohol evidence anywhere:
  if (DEAD_SITE.has(p.health) || p.health === "no-site" || p.health === "menu-platform") return "drop?";
  if (p.health === "live" || p.health === "broken-https") return "drop?"; // read it, dry
  return "review"; // blocked / unreadable / social-only — can't confirm dry
}
