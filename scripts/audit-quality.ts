/**
 * Curation-quality audit — $0, no AI. Scores every venue in a city against the
 * "20-40 metropolitan, appetizer + a drink" bar so the operator can see the good/bad
 * split and tune the strictness levers BEFORE anything is dropped. READ-ONLY (no DB
 * writes); re-fetches each venue's own pages over plain HTTP (no API spend).
 *
 *   pnpm audit:quality --city <slug> --state <code> [--limit N]
 *   → docs/quality-audit-<city>-<YYYY-MM-DD>.{json,md,csv}
 *
 * Per venue it reports, separately so you can judge each signal's reliability:
 *   - alcohol evidence: TYPE (bar-family only — "restaurant" is ambiguous by design,
 *     NOT excluded), NAME tokens, and SITE content (cocktails/draft/wine list/full bar
 *     read from the venue's OWN homepage + menu/HH page — the reliable positive Google's
 *     servesBeer boolean lacks). anyAlcohol = TYPE | NAME | SITE.
 *   - hhLive: count of live happy-hour windows.
 *   - siteHealth: live / broken-https / dead / squatter / parked / social-only /
 *     menu-platform / no-site.
 *   - verdict (suggestion only, never applied here): "drop?" when a venue has NO live HH
 *     AND (no alcohol evidence anywhere OR a bad site); else "keep".
 *
 * Requires DATABASE_URL only.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { fetchUrl } from "@/lib/verification/fetchUrl";
import { hasAlcoholSignal } from "@/lib/places/chainDenylist";
import { hasAlcoholContent, isSquatterHtml } from "@/lib/places/venueQuality";
import { isMenuPlatformWebsite } from "@/lib/places/menuPlatform";
import { classifyUrl, isParkedHtml } from "@/lib/places/siteTriage";

const DATABASE_URL = process.env.DATABASE_URL;
const args = process.argv.slice(2);
const argValue = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const cityArgs = requireCityArgs(); // city-scoped audit: both --city and --state required

// venue.type values that, on their own, imply alcohol. "restaurant"/"cafe"/"pizzeria"/
// "other" are deliberately ABSENT — ambiguous, so they earn alcohol via SITE content or
// a live HH, never excluded for being typed "restaurant".
const ALCOHOL_TYPES = new Set([
  "bar", "sports_bar", "pub", "dive_bar", "wine_bar", "brewery",
  "tasting_room", "cocktail_lounge", "gastropub", "club", "hotel_bar",
]);

function today() { return new Date().toISOString().slice(0, 10); }
const TLS_ERR = /ssl|tls|certificate|eproto|packet length|err_ssl/i;

interface SiteProbe { health: string; text: string; }

/** Probe a venue's own site for health + alcohol content. Reads homepage + a menu/HH
 *  page (recall for restaurants whose drink list isn't on the landing page). $0 HTTP. */
async function probeSite(websiteUrl: string | null): Promise<SiteProbe> {
  if (!websiteUrl) return { health: "no-site", text: "" };
  if (isMenuPlatformWebsite(websiteUrl)) return { health: "menu-platform", text: "" };
  if (classifyUrl(websiteUrl).kind === "social_only") return { health: "social-only", text: "" };

  let res = await fetchUrl(websiteUrl);
  let brokenHttps = false;
  // HTTPS broken but server alive? retry plain HTTP (Los Metates: serves a squatter over http).
  if (!res.ok && res.error && TLS_ERR.test(res.error) && websiteUrl.startsWith("https://")) {
    brokenHttps = true;
    res = await fetchUrl(websiteUrl.replace(/^https:/, "http:"));
  }
  if (!res.ok || !res.contentText) {
    const status = res.status ? `dead(${res.status})` : "dead";
    return { health: brokenHttps && !res.contentText ? "broken-https" : status, text: "" };
  }
  if (isSquatterHtml(res.contentText)) return { health: "squatter", text: res.contentText };
  if (isParkedHtml(res.contentText)) return { health: "parked", text: res.contentText };

  let text = res.contentText;
  // If no alcohol on the homepage, follow common menu/HH paths to give real restaurants
  // a fair read before we conclude "no alcohol evidence".
  if (!hasAlcoholContent(text)) {
    try {
      const origin = new URL(res.url || websiteUrl).origin;
      for (const path of ["/menu", "/menus", "/drinks", "/happy-hour"]) {
        const sub = await fetchUrl(`${origin}${path}`);
        if (sub.ok && sub.contentText) {
          text += "\n" + sub.contentText;
          if (hasAlcoholContent(text)) break;
        }
      }
    } catch { /* origin unparseable — homepage text only */ }
  }
  return { health: brokenHttps ? "broken-https" : "live", text };
}

/** Bounded-concurrency map (plain HTTP probes; be polite). */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
    }),
  );
  return out;
}

const BAD_SITE = new Set(["dead", "squatter", "parked", "social-only", "menu-platform", "no-site", "broken-https"]);

async function main() {
  if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL is required."); process.exit(1); }
  const sql = postgres(DATABASE_URL, { max: 4 });
  try {
    const venues = await sql<
      { id: string; name: string; type: string | null; website_url: string | null; hh_live: number }[]
    >`
      SELECT v.id, v.name, v.type, v.website_url,
        (SELECT count(*)::int FROM happy_hours h WHERE h.venue_id = v.id AND h.active AND h.deleted_at IS NULL) AS hh_live
      FROM venues v JOIN cities c ON c.id = v.city_id
      WHERE v.deleted_at IS NULL AND v.status = 'active'
        AND c.slug = ${cityArgs.slug} AND c.state = ${cityArgs.state}
      ORDER BY v.name
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    const rows = await pool(venues, 6, async (v) => {
      const probe = await probeSite(v.website_url);
      const typeSig = v.type ? ALCOHOL_TYPES.has(v.type) : false;
      const nameSig = hasAlcoholSignal(v.name, null, null);
      const siteSig = hasAlcoholContent(probe.text);
      const anyAlcohol = typeSig || nameSig || siteSig;
      const badSite = BAD_SITE.has(probe.health);
      const verdict = v.hh_live > 0 || (anyAlcohol && !badSite) ? "keep" : "drop?";
      return {
        venue: v.name, type: v.type ?? "", hhLive: v.hh_live,
        alcType: typeSig, alcName: nameSig, alcSite: siteSig, anyAlcohol,
        siteHealth: probe.health, websiteUrl: v.website_url ?? "", verdict,
      };
    });

    const drop = rows.filter((r) => r.verdict === "drop?");
    const keep = rows.filter((r) => r.verdict === "keep");
    const tally = (key: (r: typeof rows[number]) => string) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };

    const stamp = today();
    const base = `docs/quality-audit-${cityArgs.slug}-${stamp}`;
    writeFileSync(`${base}.json`, JSON.stringify({ generatedAt: stamp, city: cityArgs, scanned: rows.length, keep: keep.length, drop: drop.length, rows }, null, 2));
    const yn = (b: boolean) => (b ? "Y" : "·");
    const line = (r: typeof rows[number]) =>
      `| ${r.verdict} | ${r.venue} | ${r.type} | ${r.hhLive} | ${yn(r.alcType)} | ${yn(r.alcName)} | ${yn(r.alcSite)} | ${r.siteHealth} | ${r.websiteUrl} |`;
    const md = [
      `# Quality audit — ${cityArgs.slug}, ${cityArgs.state} — ${stamp}`,
      "",
      `Scanned **${rows.length}** active venues. Suggested **keep ${keep.length}**, **drop? ${drop.length}**.`,
      "Verdict is a SUGGESTION (nothing applied). `drop?` = no live HH AND (no alcohol evidence OR bad site).",
      "Alcohol columns: aT=by type (bar-family only), aN=by name, aS=by site-menu content. `restaurant` earns alcohol via aS or a live HH — never excluded for its type.",
      "",
      `### Site health: ${tally((r) => r.siteHealth).map(([k, n]) => `${k}×${n}`).join(", ")}`,
      "",
      "## drop? candidates",
      "",
      "| verdict | venue | type | HH | aT | aN | aS | site | url |",
      "|---|---|---|--:|:--:|:--:|:--:|---|---|",
      ...drop.map(line),
      "",
      "## keep",
      "",
      "| verdict | venue | type | HH | aT | aN | aS | site | url |",
      "|---|---|---|--:|:--:|:--:|:--:|---|---|",
      ...keep.map(line),
      "",
    ].join("\n");
    writeFileSync(`${base}.md`, md);

    console.log(`scanned ${rows.length}: keep ${keep.length}, drop? ${drop.length}`);
    console.log(`site health: ${tally((r) => r.siteHealth).map(([k, n]) => `${k}×${n}`).join(", ")}`);
    console.log(`report → ${base}.md`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
