/**
 * Venue slug helpers.
 *
 * venues has TWO unique constraints: google_place_id, and (city_id, slug). Per
 * PRD §13 we dedup on google_place_id and NEVER on name — so multiple locations of
 * the same chain are legitimately distinct venues. But slug is derived from name,
 * so two same-name locations in one city would collide on (city_id, slug). The
 * place_id suffix below disambiguates such a slug deterministically.
 *
 * Uniqueness is enforced at INSERT time (retry on the slug-constraint violation),
 * NOT via a pre-read — a read-then-insert is TOCTOU and races when two same-name
 * candidates are written in the same run. See insertVenueRow in
 * scripts/seed-enrich-candidates.ts.
 */

/** Lowercase, strip diacritics, non-alphanumerics → hyphens. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Short, stable suffix derived from a Google place_id (last 6 alphanumerics). */
export function placeIdSuffix(placeId: string): string {
  const alnum = placeId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return alnum.slice(-6) || "loc";
}
