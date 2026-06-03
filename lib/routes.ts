/**
 * Single source of truth for the public URL shape. Every internal link is built
 * here so the route structure (/[state]/[city]/...) is defined in exactly one
 * place. Pure + dependency-free so it's trivially unit-testable and safe to import
 * from both server and client components.
 */

/** Lowercase + trim a state code into its URL slug ("WA" → "wa"). */
export function normalizeStateSlug(state: string): string {
  return state.trim().toLowerCase();
}

/** /<state>/<city> — the city listing page. */
export function cityPath(state: string, citySlug: string): string {
  return `/${normalizeStateSlug(state)}/${citySlug}`;
}

/** /<state>/<city>/<neighborhood> — a neighborhood-filtered listing. */
export function neighborhoodPath(
  state: string,
  citySlug: string,
  neighborhoodSlug: string,
): string {
  return `${cityPath(state, citySlug)}/${neighborhoodSlug}`;
}

/** /<state>/<city>/venue/<slug> — a venue detail page. */
export function venuePath(
  state: string,
  citySlug: string,
  venueSlug: string,
): string {
  return `${cityPath(state, citySlug)}/venue/${venueSlug}`;
}

export interface LegacyCity {
  /** The old globally-unique bare slug, e.g. "tacoma". */
  bareSlug: string;
  /** The lowercased state slug it now lives under, e.g. "wa". */
  stateSlug: string;
}

/**
 * Build the Next.js `redirects()` rules that 301 the old flat URLs to their nested
 * equivalents. Each city needs two rules: the exact bare slug AND a child wildcard
 * (neighborhoods + venue pages). Hardcoded list — redirects can't query the DB, and
 * only these four cities ever had bare URLs.
 */
export function legacyCityRedirects(
  cities: LegacyCity[],
): { source: string; destination: string; permanent: true }[] {
  return cities.flatMap((c) => [
    {
      source: `/${c.bareSlug}`,
      destination: `/${c.stateSlug}/${c.bareSlug}`,
      permanent: true,
    },
    {
      source: `/${c.bareSlug}/:path*`,
      destination: `/${c.stateSlug}/${c.bareSlug}/:path*`,
      permanent: true,
    },
  ]);
}
