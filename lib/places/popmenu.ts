/**
 * Popmenu menu-route discovery.
 *
 * Popmenu (a major restaurant website platform) serves each menu as a first-party SPA route
 * on the venue's OWN domain — /menus/web-<slug>?location=<loc> — injected client-side by its
 * JS. The happy-hour items (names + prices) live on /menus/web-happy-hour, which:
 *   - never appears in the static landing HTML (JS-injected), so anchor/sitemap discovery misses it;
 *   - is same-origin, not a cross-origin <iframe>, so extractMenuEmbedUrls misses it too.
 * The landing page (once rendered) lists ALL menu routes as anchors. We follow ONLY the
 * happy-hour route(s) — following web-food / web-drinks too would flood the model with regular-
 * menu items (meal-special over-capture). See scripts/test-popmenu-menu.ts for goldens.
 */

const PATH_RE = /(?:https?:\/\/[a-z0-9.-]+)?\/menus\/web-[a-z0-9-]+\?location=[a-z0-9-]+/gi;
const SLUG_RE = /\/menus\/(web-[a-z0-9-]+)\?/i;

/** Is this fetched page content from a Popmenu-hosted site? Matched on the platform's asset/CDN
 *  host and "Made with by Popmenu" footer — brand strings that don't appear on other sites. */
export function isPopmenuContent(content: string | undefined | null): boolean {
  if (!content) return false;
  return content.toLowerCase().includes("popmenu");
}

/** Same-origin /menus/web-*happy*?location=* routes in `content`, absolutized against `baseUrl`,
 *  deduped in discovery order. Returns ONLY happy-hour routes (slug contains "happy"); excludes
 *  regular-menu routes and foreign hosts. Works on rendered markdown or HTML (URL-token match). */
export function extractPopmenuHappyHourRoutes(
  content: string | undefined | null,
  baseUrl: string,
): string[] {
  if (!content) return [];
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).host.toLowerCase();
  } catch {
    return [];
  }
  const out = new Map<string, true>();
  for (const raw of content.match(PATH_RE) ?? []) {
    const slug = raw.match(SLUG_RE)?.[1]?.toLowerCase();
    if (!slug || !slug.includes("happy")) continue;
    let abs: URL;
    try {
      abs = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (abs.host.toLowerCase() !== baseHost) continue;
    out.set(abs.toString(), true);
  }
  return [...out.keys()];
}
