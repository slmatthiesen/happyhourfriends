/**
 * Operator-curated neighborhood naming, keyed by `${state}/${citySlug}` (cities are
 * unique by (state, slug)). Two knobs, both keyed by canonicalNeighborhoodKey of any
 * spelling variant:
 *   - display: the name to show when frequency would pick a bad variant (Google spells
 *     St. Philip's Plaza as "Saint Phillips Plaza" on most venues — the landmark's real
 *     name wins by fiat).
 *   - mergeIntoSlug: fold a Google-named area into an existing district row (operator
 *     decision 2026-06-11: Catalina Foothills Estates is not a useful filter distinct
 *     from the Catalina Foothills CDP).
 * Matching/grouping never uses display names — only canonical keys — so curated
 * punctuation/abbreviations here can't break how new Google names cluster.
 */
import type { CityNeighborhoodOverrides } from "@/lib/geo/neighborhoodCanonical";

const OVERRIDES: Record<string, CityNeighborhoodOverrides> = {
  "az/tucson": {
    display: {
      // Both observed Google spellings of the plaza ("Saint Philip's" / "Saint Phillips").
      saintphilipsplaza: "St. Philip's Plaza",
      saintphillipsplaza: "St. Philip's Plaza",
    },
    mergeIntoSlug: {
      catalinafoothillsestates: "catalina-foothills",
    },
  },
  "ca/san-luis-obispo": {
    mergeIntoSlug: {
      // Google splits the same core between "Downtown" and "Downtown Historic District"
      // (both polygon-less Google names, so geometry can't arbitrate); locals say Downtown.
      downtownhistoricdistrict: "downtown",
    },
  },
};

export function neighborhoodOverridesFor(
  state: string,
  citySlug: string,
): CityNeighborhoodOverrides | undefined {
  return OVERRIDES[`${state.toLowerCase()}/${citySlug}`];
}
