# Sitemap-first HH discovery + canonical matcher (harvest path)

**Date:** 2026-06-02
**Scope:** the free `scripts/harvest-hh.ts` path only. No AI/billing. The enrich
pipeline (`siteTriage` → `priorityUrls` → `extractHappyHours`) can adopt the shared
matcher later; this PR does not touch it.

## Problem

Two recall gaps in the free harvester:

1. **Hyphen/spacing drift.** Three different HH-text matchers disagree. The harvest
   content scanners only match the spaced form `"happy hour"`
   (`harvest-hh.ts:49,72,98`), so a site that writes **Happy-Hour** or **HappyHour**
   in headings/JSON-LD/body text is missed → real-HH venue wrongly stays a stub.
   Meanwhile `siteTriage.ts` already uses the correct `/happy[-_ ]?hour/i`.
2. **Blind path guessing.** We probe a fixed `GUESS_PATHS` list (`/happy-hour`,
   `/specials`, …), most of which 404. We never read the URLs the site actually
   declares in its sitemap.

Both bite in every city, so fixing them scales nationally for free. Caveat: this is
an incremental recall win on the automated layer — sites with no sitemap, single-page
sites, or HH-only-on-Instagram/PDF still need crowdsourcing + extractor coverage work.

## Design

### 1. `lib/places/hhText.ts` — one canonical matcher (pure, tested)
- `HH_RE = /happy[-_ ]?hour/i` — matches `happy hour` / `happy-hour` / `happyhour` /
  `happy_hour`, any case.
- `matchesHappyHour(text: string): boolean`.
- `scoreHhUrl(url: string): number` — likelihood rank for ordering candidate URLs,
  most→least likely: explicit happy-hour path (+ "menu" bonus) > `specials` >
  drink/cocktail/wine/beer menu > food menu > generic `menu(s)` > 0.
- Replaces the three drifted matchers in `harvest-hh.ts`.

### 2. `lib/places/sitemap.ts` — free, robots-aware (fetcher injected)
- `discoverSitemapUrls(origin, fetchText, opts?): Promise<string[]>`
  - `fetchText(url) => Promise<string | null>` is **injected** (harvest passes its own
    browser-UA `fetchText`; tests pass a fake map). No network in the module itself.
  - Steps: GET `${origin}/robots.txt` → collect `Sitemap:` directives; fallback to
    `${origin}/sitemap.xml`. Fetch each sitemap. If it's a `<sitemapindex>`, recurse
    **one level** into child sitemaps. Collect `<loc>` URLs.
  - Bounded: `maxSitemaps` (default 5), `maxUrls` (default 200). Dedupe. Best-effort:
    any fetch/parse failure is swallowed and yields fewer URLs (never throws).
- `parseSitemapXml(xml): { kind: "index" | "urlset"; locs: string[] }` — exported pure
  helper for unit testing (regex over `<loc>`, `<sitemapindex>` detection).

### 3. Reworked discovery order in `harvest-hh.ts`
Build a ranked candidate list, dedup, cap (~6), fetch in order, stop early on signal:
1. Homepage anchor links matching `HH_RE`/menu patterns (existing `hhLinks`, now using
   the canonical matcher).
2. **Sitemap URLs** matching `HH_RE`/menu, sorted by `scoreHhUrl` desc.
3. `GUESS_PATHS` (reordered most→least specific) not already found — now a *fallback*.
4. Homepage itself.

### 4. Tests (no network)
- `scripts/test-hh-text.ts`: matcher variants (`Happy Hour`, `happy-hour`, `happyhour`,
  `HAPPY HOUR`, negatives) + `scoreHhUrl` ordering.
- `scripts/test-sitemap.ts`: `parseSitemapXml` on a `<urlset>` and a `<sitemapindex>`
  fixture; `discoverSitemapUrls` with a fake fetcher (robots → index → child → locs),
  asserting bounds + dedupe + best-effort on missing pages.

## Out of scope
- Enrich pipeline wiring (`siteTriage`/`extractHappyHours`).
- Any DB writes (harvest stays read-only).
