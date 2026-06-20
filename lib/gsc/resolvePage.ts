/**
 * Maps a GSC landing-page URL to the route entity it represents, mirroring the
 * app's route tree: /[state]/[city], /[state]/[city]/[neighborhood],
 * /[state]/[city]/venue/[slug]. Anything else (home, /about, /admin, assets) is static.
 * Pure — no I/O — so it's unit-testable with URL fixtures.
 */
export type ResolvedPage =
  | { kind: "venue"; stateSlug: string; citySlug: string; slug: string }
  | { kind: "city"; stateSlug: string; citySlug: string }
  | { kind: "neighborhood"; stateSlug: string; citySlug: string; neighborhoodSlug: string }
  | { kind: "static"; path: string };

const STATIC_FIRST_SEGMENTS = new Set([
  "about", "faq", "for-restaurants", "submit", "styleguide",
  "admin", "api", "_next", "sitemap.xml", "robots.txt", "llms.txt", "manifest.webmanifest",
]);

export function resolvePage(pageUrl: string): ResolvedPage {
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = pageUrl;
  }
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0 || STATIC_FIRST_SEGMENTS.has(segments[0])) {
    return { kind: "static", path };
  }
  if (segments.length === 4 && segments[2] === "venue") {
    return { kind: "venue", stateSlug: segments[0], citySlug: segments[1], slug: segments[3] };
  }
  if (segments.length === 3) {
    return { kind: "neighborhood", stateSlug: segments[0], citySlug: segments[1], neighborhoodSlug: segments[2] };
  }
  if (segments.length === 2) {
    return { kind: "city", stateSlug: segments[0], citySlug: segments[1] };
  }
  return { kind: "static", path };
}
