/**
 * Venue slug helpers.
 *
 * venues has TWO unique constraints: google_place_id, and (city_id, slug). Per
 * PRD §13 we dedup on google_place_id and NEVER on name — so multiple locations of
 * the same chain are legitimately distinct venues. But slug is derived from name,
 * so two same-name locations in one city would collide on (city_id, slug). This
 * module disambiguates the slug using the stable place_id, so each location gets a
 * unique, deterministic, human-readable slug.
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

/**
 * Resolve a unique slug for a place-id-backed venue. Returns `base` when it's free;
 * otherwise appends the place_id suffix (and a counter as a final backstop). The
 * suffix is derived from the stable place_id, so re-running yields the same slug —
 * the resolution is idempotent for a given (name, place_id).
 *
 * `isTaken(slug)` must report whether the slug is already held by a DIFFERENT venue
 * in the same city (so a venue never reports itself as a collision).
 */
export async function resolveVenueSlug(
  base: string,
  placeId: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  const suffix = placeIdSuffix(placeId);
  let candidate = `${base}-${suffix}`;
  let n = 2;
  while (await isTaken(candidate)) {
    candidate = `${base}-${suffix}-${n}`;
    n++;
  }
  return candidate;
}
