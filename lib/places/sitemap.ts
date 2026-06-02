/**
 * sitemap — discover a site's declared URLs (free, robots-aware) instead of
 * guessing paths. Reads robots.txt for `Sitemap:` directives (fallback
 * /sitemap.xml), fetches the sitemap(s), follows a sitemap index one level, and
 * returns the `<loc>` URLs. The caller filters/ranks them (see hhText.scoreHhUrl).
 *
 * The fetcher is INJECTED so this module does no network I/O of its own: the
 * harvester passes its browser-UA fetchText; tests pass a fake map. Best-effort
 * throughout — any fetch/parse failure yields fewer URLs and never throws.
 */

export type TextFetcher = (url: string) => Promise<string | null>;

export interface SitemapOpts {
  /** Max sitemap documents to fetch (index + children combined). Default 5. */
  maxSitemaps?: number;
  /** Max URLs to return. Default 200. */
  maxUrls?: number;
}

/** Pure parse: classify a sitemap doc and pull its <loc> values. */
export function parseSitemapXml(xml: string): {
  kind: "index" | "urlset";
  locs: string[];
} {
  const kind = /<sitemapindex[\s>]/i.test(xml) ? "index" : "urlset";
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const url = m[1].trim();
    if (/^https?:\/\//i.test(url)) locs.push(url);
  }
  return { kind, locs };
}

/** Extract `Sitemap:` directive targets from a robots.txt body. */
export function sitemapsFromRobots(robots: string): string[] {
  const out: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const m = /^\s*sitemap:\s*(\S+)/i.exec(line);
    if (m && /^https?:\/\//i.test(m[1])) out.push(m[1].trim());
  }
  return out;
}

/**
 * Return the site's declared URLs (capped, deduped). origin must be a bare
 * origin like "https://example.com".
 */
export async function discoverSitemapUrls(
  origin: string,
  fetchText: TextFetcher,
  opts: SitemapOpts = {},
): Promise<string[]> {
  const maxSitemaps = opts.maxSitemaps ?? 5;
  const maxUrls = opts.maxUrls ?? 200;

  // 1. robots.txt → Sitemap: directives, else fall back to /sitemap.xml
  let roots: string[] = [];
  const robots = await fetchText(`${origin}/robots.txt`).catch(() => null);
  if (robots) roots = sitemapsFromRobots(robots);
  if (roots.length === 0) roots = [`${origin}/sitemap.xml`];

  const seenSitemaps = new Set<string>();
  const urls = new Set<string>();
  const queue = [...new Set(roots)];

  // 2. drain the queue; a <sitemapindex> enqueues its children (one level deep,
  //    bounded by maxSitemaps total fetches).
  while (queue.length > 0 && seenSitemaps.size < maxSitemaps && urls.size < maxUrls) {
    const sm = queue.shift()!;
    if (seenSitemaps.has(sm)) continue;
    seenSitemaps.add(sm);

    const xml = await fetchText(sm).catch(() => null);
    if (!xml) continue;
    const { kind, locs } = parseSitemapXml(xml);
    if (kind === "index") {
      for (const child of locs) {
        if (!seenSitemaps.has(child)) queue.push(child);
      }
    } else {
      for (const u of locs) {
        urls.add(u);
        if (urls.size >= maxUrls) break;
      }
    }
  }

  return [...urls];
}
