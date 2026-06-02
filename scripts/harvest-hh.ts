/**
 * FREE happy-hour harvester — NO Anthropic API, NO web_fetch billing.
 * Plain Node fetch (like curl) over every stub venue that has a real website,
 * pulls the homepage + its happy-hour/menu subpages, and extracts:
 *   - JSON-LD objects whose name/description mention "happy hour"
 *   - visible-text snippets around "happy hour" that carry day/time patterns
 * Writes a per-venue digest to docs/hh-harvest.jsonl for review/extraction.
 *
 * This is the recall step. It NEVER writes venue data. Reading the digests and
 * turning them into happy_hours rows is a separate, deliberate step.
 *
 * Usage: tsx scripts/harvest-hh.ts [--city <slug>] [--limit N] [--concurrency 8]
 */
import "dotenv/config";
import postgres from "postgres";
import { appendFileSync, writeFileSync } from "node:fs";
import { HH_RE, matchesHappyHour, scoreHhUrl } from "@/lib/places/hhText";
import { discoverSitemapUrls } from "@/lib/places/sitemap";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const OUT = "docs/hh-harvest.jsonl";

function arg(f: string) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; }
const CITY = arg("--city");
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const CONC = arg("--concurrency") ? parseInt(arg("--concurrency")!, 10) : 8;

async function fetchText(url: string, ms = 12000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": UA } });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (!/text\/html|json|xml/i.test(ct) && ct) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}

function abs(href: string, base: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

/** HH/menu subpage links worth following. */
function hhLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]; const text = m[2].replace(/<[^>]+>/g, " ").toLowerCase();
    if (/happy|special|drink|menu|food/i.test(href) || HH_RE.test(text) || /specials|drink menu|food menu/.test(text)) {
      const u = abs(href, base); if (u && /^https?:/i.test(u)) out.add(u.split("#")[0]);
    }
    if (out.size >= 6) break;
  }
  return [...out];
}

/** Recursively collect JSON-LD nodes mentioning happy hour. */
function jsonLdHits(html: string): { name?: string; description?: string }[] {
  const hits: { name?: string; description?: string }[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let data: unknown;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (node && typeof node === "object") {
        const o = node as Record<string, unknown>;
        const blob = `${o.name ?? ""} ${o.description ?? ""}`;
        if (matchesHappyHour(blob)) {
          hits.push({ name: typeof o.name === "string" ? o.name : undefined, description: typeof o.description === "string" ? o.description : undefined });
        }
        for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return hits;
}

const DAY_TIME = /\b(mon|tue|wed|thu|fri|sat|sun|daily|weekday)|\b\d{1,2}\s?(:\d{2})?\s?(a|p)\.?m\.?\b|\b\d{1,2}\s?-\s?\d{1,2}\s?(a|p|pm|am)|open|close/i;

/** Snippets around "happy hour" carrying a day or time. Scans BOTH the visible
 * text AND the raw HTML — many sites bury "Happy Hour: Mon-Fri 2-5PM" inside an
 * inline <script> data blob (Arizona Wilderness), which tag-stripping would lose. */
function textSnippets(html: string): string[] {
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const decode = (s: string) => s
    .replace(/\\u003c|\\u003e|<[^>]*>/gi, " ")
    .replace(/&nbsp;|\\u0026nbsp;/gi, " ").replace(/&amp;|\\u0026/gi, "&")
    .replace(/&#39;|&rsquo;|&apos;|\\u0027/gi, "'").replace(/\\n|\\t/g, " ")
    .replace(/\s+/g, " ").trim();
  const out = new Set<string>();
  for (const hay of [visible, html]) {
    // Canonical HH pattern (happy / happy-hour / happyhour) with surrounding context.
    const re = new RegExp(`.{0,40}${HH_RE.source}.{0,180}`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) {
      const s = decode(m[0]);
      if (s.length > 12 && DAY_TIME.test(s)) out.add(s);
      if (out.size >= 8) break;
    }
  }
  return [...out];
}

type Sql = ReturnType<typeof postgres>;
interface Stub { id: string; name: string; website_url: string; city: string; }

// Last-resort path GUESSES (most→least specific) for sites with no usable sitemap
// and no homepage HH/menu links. Primary discovery is the sitemap (real URLs).
const GUESS_PATHS = ["/happy-hour", "/happyhour", "/happy-hour-menu", "/menu/happy-hour", "/specials", "/drink-menu", "/drinks", "/menu", "/menus"];

async function harvest(v: Stub): Promise<{ venueId: string; name: string; city: string; website: string; signal: boolean; sources: { url: string; jsonld: { name?: string; description?: string }[]; snippets: string[] }[] }> {
  const home = await fetchText(v.website_url);
  const pages = new Map<string, string>();
  if (home) pages.set(v.website_url, home);

  let origin: string | null = null;
  try { origin = new URL(v.website_url).origin; } catch { /* skip */ }

  // Build an ordered candidate list (most→least likely), dedup, then fetch up to the
  // cap. Order: (1) homepage HH/menu anchor links, (2) sitemap-declared URLs that look
  // like HH/menu pages — the site's REAL urls, beats guessing — (3) last-resort guesses.
  const PAGE_CAP = 6;
  const candidates: string[] = [];
  const pushCand = (u: string | null) => {
    if (u && /^https?:/i.test(u) && !candidates.includes(u)) candidates.push(u);
  };

  if (home) for (const link of hhLinks(home, v.website_url)) pushCand(link);
  if (origin) {
    const declared = await discoverSitemapUrls(origin, fetchText).catch(() => []);
    declared
      .map((u) => ({ u, s: scoreHhUrl(u) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .forEach((x) => pushCand(x.u));
  }
  if (origin) for (const p of GUESS_PATHS) pushCand(origin + p);

  const norm = (k: string) => k.replace(/\/$/, "");
  for (const u of candidates) {
    if (pages.size >= PAGE_CAP) break;
    if ([...pages.keys()].some((k) => norm(k) === norm(u))) continue;
    const h = await fetchText(u);
    if (h) pages.set(u, h);
  }
  const sources: { url: string; jsonld: { name?: string; description?: string }[]; snippets: string[] }[] = [];
  for (const [url, html] of pages) {
    const jsonld = jsonLdHits(html);
    const snippets = textSnippets(html);
    if (jsonld.length || snippets.length) sources.push({ url, jsonld, snippets });
  }
  return { venueId: v.id, name: v.name, city: v.city, website: v.website_url, signal: sources.length > 0, sources };
}

async function main() {
  const sql: Sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const stubs = await sql<Stub[]>`
    SELECT v.id, v.name, v.website_url, c.slug AS city
    FROM venues v JOIN cities c ON c.id = v.city_id
    WHERE v.deleted_at IS NULL AND v.website_url IS NOT NULL
      AND v.website_url !~* 'facebook|instagram|doordash|linktr|ubereats|grubhub|toasttab'
      AND NOT EXISTS (SELECT 1 FROM happy_hours hh WHERE hh.venue_id=v.id AND hh.active AND hh.deleted_at IS NULL)
      ${CITY ? sql`AND c.slug = ${CITY}` : sql``}
    ORDER BY c.slug, v.name
    ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;
  console.log(`Harvesting ${stubs.length} stub site(s)  (concurrency ${CONC})…`);
  writeFileSync(OUT, "");

  let done = 0, withSignal = 0;
  for (let i = 0; i < stubs.length; i += CONC) {
    const batch = stubs.slice(i, i + CONC);
    const results = await Promise.all(batch.map((s) => harvest(s).catch(() => ({ venueId: s.id, name: s.name, city: s.city, website: s.website_url, signal: false, sources: [] }))));
    for (const r of results) {
      appendFileSync(OUT, JSON.stringify(r) + "\n");
      done++; if (r.signal) withSignal++;
      console.log(`[${done}/${stubs.length}] ${r.signal ? "✓ HH signal" : "·  none    "}  ${r.name} (${r.city})`);
    }
  }
  console.log(`\nHarvest complete: ${withSignal}/${done} venues have an on-site happy-hour signal → ${OUT}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
