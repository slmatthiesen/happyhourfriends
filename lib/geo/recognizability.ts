/**
 * Neighborhood recognizability + tier helpers.
 *
 * The product problem: official neighborhood layers are full of names locals don't say
 * (Tucson's "Limberlost" NA). OSM carries a free, globally-consistent, NON-hallucinated
 * signal for fame — famous neighborhoods (Arcadia, Sam Hughes) carry `wikidata`/`wikipedia`
 * tags; obscure registrations don't. We turn that plus the OSM `place` tier into:
 *   - tier: "fine" (a named neighborhood) vs "coarse" (a broad rollup district)
 *   - recognizability: 0..2, higher = more likely a name people actually use
 * Assignment (lib/geo/assignNeighborhoods.ts) prefers a recognizable FINE neighborhood,
 * else rolls a venue up to its COARSE district. Pure functions — unit-tested, no I/O.
 */

export type NeighborhoodTier = "fine" | "coarse";

/** OSM `place` values that denote a broad district rather than a single neighborhood. */
const COARSE_PLACES = new Set(["suburb", "city_district", "borough"]);

/** Map an OSM `place` tag to our tier. Unknown/missing defaults to "fine". */
export function tierForPlace(place: string | null | undefined): NeighborhoodTier {
  return place && COARSE_PLACES.has(place) ? "coarse" : "fine";
}

/** OSM tags relevant to scoring (subset of a feature's properties). */
export interface RecognizabilityTags {
  place?: string | null;
  wikidata?: string | null;
  wikipedia?: string | null;
}

/**
 * 0..2 recognizability:
 *   2 — has a wikidata or wikipedia tag (a documented, named place; the fame proxy)
 *   1 — a bare `place=suburb` (a genuine district even without a wiki link)
 *   0 — anything else (plain neighbourhood/quarter with no notability signal)
 */
export function recognizabilityScore(tags: RecognizabilityTags): number {
  if (tags.wikidata || tags.wikipedia) return 2;
  if (tags.place === "suburb") return 1;
  return 0;
}

/** A fine name may surface only at/above this recognizability score. Tunable. */
export const RECOGNIZABLE_BAR = 1;

/** True when a neighborhood is a fine name recognizable enough to surface on its own. */
export function isRecognizableFine(tier: NeighborhoodTier, recognizability: number): boolean {
  return tier === "fine" && recognizability >= RECOGNIZABLE_BAR;
}
