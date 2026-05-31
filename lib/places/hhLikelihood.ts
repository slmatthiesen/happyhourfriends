/**
 * hhLikelihood — prior probability a venue runs a happy hour, by type.
 *
 * Reconstructs the per-cuisine priors that drove docs/phoenix-stub-hh-review.md
 * (the original generator was ad-hoc and never committed). Keyed on Google
 * primaryType first (per-cuisine), then types[], then the coarse VenueType, then
 * name keywords. Pure, no I/O. The numbers are tunable priors; the only
 * behaviorally load-bearing consumer is the >0.5 no-site rescue gate (enrich pipeline).
 */
import { deriveVenueType, type VenueType } from "@/lib/places/venueType";

// Google primaryType → prior. Values approximated from the Phoenix review doc.
const PRIMARY_TYPE_PRIOR: Record<string, number> = {
  sports_bar: 0.62,
  bar: 0.61,
  pub: 0.58,
  irish_pub: 0.58,
  gastropub: 0.58,
  brewery: 0.56,
  brewpub: 0.56,
  wine_bar: 0.41,
  cocktail_bar: 0.29,
  lounge_bar: 0.29,
  night_club: 0.33,
  american_restaurant: 0.57,
  new_american_restaurant: 0.57,
  italian_restaurant: 0.56,
  bar_and_grill: 0.5,
  restaurant: 0.45,
  pizza_restaurant: 0.32,
  mexican_restaurant: 0.33,
  latin_american_restaurant: 0.33,
  steak_house: 0.2,
  sushi_restaurant: 0.19,
  japanese_restaurant: 0.19,
  ramen_restaurant: 0.17,
  barbecue_restaurant: 0.14,
  chinese_restaurant: 0.08,
  seafood_restaurant: 0.07,
  thai_restaurant: 0.0,
  vegan_restaurant: 0.0,
  vegetarian_restaurant: 0.0,
  indian_restaurant: 0.0,
  cafe: 0.0,
  coffee_shop: 0.0,
  bakery: 0.0,
};

// Coarse fallback when only the collapsed VenueType is known.
const VENUE_TYPE_PRIOR: Partial<Record<VenueType, number>> = {
  sports_bar: 0.62,
  bar: 0.6,
  pub: 0.58,
  dive_bar: 0.5,
  wine_bar: 0.41,
  brewery: 0.56,
  tasting_room: 0.4,
  cocktail_lounge: 0.35,
  gastropub: 0.58,
  club: 0.33,
  hotel_bar: 0.5,
  pizzeria: 0.32,
  cafe: 0.0,
  restaurant: 0.4,
  // `other` intentionally omitted → null
};

// Name keywords that set a FLOOR on the prior (a "Sports Cantina" is HH-likely
// regardless of how Google typed it).
const NAME_FLOORS: Array<[RegExp, number]> = [
  [/\b(sports?\s*bar|cantina|tavern|ale\s*house|brew(ery|pub|ing)?|saloon)\b/i, 0.58],
  [/\b(bar\s*(&|and)\s*grill|grill(e)?|pub|gastropub)\b/i, 0.55],
  [/\b(cocktail|lounge|wine\s*bar)\b/i, 0.41],
];

export function hhLikelihood(input: {
  venueType?: VenueType | null;
  primaryType?: string | null;
  types?: string[] | null;
  name?: string | null;
}): number | null {
  let score: number | null = null;

  const pt = input.primaryType?.toLowerCase();
  if (pt && pt in PRIMARY_TYPE_PRIOR) score = PRIMARY_TYPE_PRIOR[pt];

  if (score === null && input.types) {
    for (const t of input.types) {
      const key = t.toLowerCase();
      if (key in PRIMARY_TYPE_PRIOR) {
        score = PRIMARY_TYPE_PRIOR[key];
        break;
      }
    }
  }

  if (score === null) {
    // Only collapse to coarse VenueType if we have at least SOME signal from
    // primaryType, types[], or name. Genuinely empty inputs should return null.
    const hasSignal =
      input.primaryType ||
      (input.types && input.types.length > 0) ||
      (input.name && input.name.trim().length > 0);

    if (hasSignal) {
      const vt =
        input.venueType ??
        deriveVenueType({
          primaryType: input.primaryType ?? null,
          types: input.types ?? null,
          name: input.name ?? "",
        });
      if (vt in VENUE_TYPE_PRIOR) score = VENUE_TYPE_PRIOR[vt] ?? null;
    }
  }

  // Name-keyword floor — can lift a generic match, but never invents a score
  // from nothing (only applies when we already have some signal OR a name match).
  if (input.name) {
    for (const [re, floor] of NAME_FLOORS) {
      if (re.test(input.name)) {
        score = Math.max(score ?? 0, floor);
        break;
      }
    }
  }

  return score === null ? null : Math.min(1, Math.max(0, score));
}
