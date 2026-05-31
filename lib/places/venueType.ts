/**
 * Venue type derivation + display labels. Single source of truth shared by the
 * backfill script (existing venues) and the enrich pipeline (new venues). Pure, no I/O.
 *
 * Stored values are the venue_type enum keys (machine values); the UI renders the
 * friendly labels in VENUE_TYPE_LABELS, never the raw key.
 */
import { venueType as venueTypeEnum } from "@/db/schema/enums";

export type VenueType = (typeof venueTypeEnum.enumValues)[number];
export const VENUE_TYPES = venueTypeEnum.enumValues;

const VENUE_TYPE_SET = new Set<string>(VENUE_TYPES);
export function isVenueType(x: unknown): x is VenueType {
  return typeof x === "string" && VENUE_TYPE_SET.has(x);
}

/** Explicit Google primaryType / types[] -> our enum, for the NON-restaurant cases. */
const GOOGLE_TYPE_MAP: Record<string, VenueType> = {
  bar: "bar",
  sports_bar: "sports_bar",
  cocktail_bar: "cocktail_lounge",
  lounge_bar: "cocktail_lounge",
  wine_bar: "wine_bar",
  pub: "pub",
  irish_pub: "pub",
  brewery: "brewery",
  beer_garden: "bar",
  night_club: "club",
  gastropub: "gastropub",
  cafe: "cafe",
  coffee_shop: "cafe",
  pizza_restaurant: "pizzeria",
  pizzeria: "pizzeria",
  live_music_venue: "bar",
  sports_complex: "other",
};

/** Google food types that should collapse to plain "restaurant". */
const RESTAURANT_FALLBACK = new Set<string>([
  "restaurant",
  "bar_and_grill",
  "steak_house",
  "fine_dining_restaurant",
  "brunch_restaurant",
  "buffet_restaurant",
  "diner",
  "food_court",
  "meal_takeaway",
  "meal_delivery",
  "fast_food_restaurant",
]);

/** True for any Google type that means "a place that serves food" -> restaurant. */
function isRestaurantType(t: string): boolean {
  return RESTAURANT_FALLBACK.has(t) || t.endsWith("_restaurant");
}

// NOTE: "brewpub" matches the brewery rule (so a brewpub -> brewery, not pub), and there
// is intentionally no name rule for gastropub (too hard to infer from a name alone; it
// only comes from Google's primaryType). Ordering is specific-before-generic.
/** Ordered name-keyword rules, used ONLY when Google gives us no type. First match wins. */
const NAME_KEYWORD_RULES: Array<{ re: RegExp; type: VenueType }> = [
  { re: /\bsports\s?bar\b/i, type: "sports_bar" },
  { re: /\bwine\s?bar\b/i, type: "wine_bar" },
  { re: /\b(brew(ery|ing)|brewhouse|brewpub)\b/i, type: "brewery" },
  { re: /\b(taproom|tap\s?house|tasting\s?room|cellars?|winery|vineyard)\b/i, type: "tasting_room" },
  { re: /\b(pub|alehouse|ale\s?house)\b/i, type: "pub" },
  { re: /\b(cantina|tequila|saloon)\b/i, type: "bar" },
  { re: /\b(night\s?club|nightclub)\b/i, type: "club" },
  { re: /\blounge\b/i, type: "cocktail_lounge" },
  { re: /\bpizz(a|eria)\b/i, type: "pizzeria" },
  { re: /\b(caf[eé]|coffee|espresso)\b/i, type: "cafe" },
  { re: /\b(bar|tavern)\b/i, type: "bar" },
];

function fromGoogleType(t: string | null | undefined): VenueType | null {
  if (!t) return null;
  if (GOOGLE_TYPE_MAP[t]) return GOOGLE_TYPE_MAP[t];
  if (isRestaurantType(t)) return "restaurant";
  return null;
}

/**
 * Resolve a venue type. Order: Google primaryType -> first matching types[] entry ->
 * name keywords -> "restaurant" default. Never returns null.
 */
export function deriveVenueType(input: {
  primaryType: string | null | undefined;
  types: string[] | null | undefined;
  name: string;
}): VenueType {
  const fromPrimary = fromGoogleType(input.primaryType);
  if (fromPrimary) return fromPrimary;

  for (const t of input.types ?? []) {
    const m = fromGoogleType(t);
    if (m) return m;
  }

  for (const rule of NAME_KEYWORD_RULES) {
    if (rule.re.test(input.name)) return rule.type;
  }

  return "restaurant";
}

/** Friendly, tight display labels. Exhaustive over the enum (compile-checked by Record). */
export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  restaurant: "Restaurant",
  bar: "Bar",
  sports_bar: "Sports Bar",
  pub: "Pub",
  dive_bar: "Dive",
  wine_bar: "Wine Bar",
  brewery: "Brewery",
  tasting_room: "Taproom",
  cocktail_lounge: "Cocktails",
  gastropub: "Gastropub",
  club: "Club",
  cafe: "Café",
  hotel_bar: "Hotel",
  pizzeria: "Pizzeria",
  other: "Venue",
};

/** Display label for a (possibly null) type. Null -> "" (render nothing, never a dash). */
export function labelForVenueType(type: VenueType | string | null | undefined): string {
  if (type && isVenueType(type)) return VENUE_TYPE_LABELS[type];
  return "";
}
