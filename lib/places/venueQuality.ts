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
