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
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { fetchUrl } from "@/lib/verification/fetchUrl";
import { hasAlcoholSignal } from "@/lib/places/chainDenylist";
import { hasAlcoholContent, isSquatterHtml, classifySiteHealth, qualityVerdict, type SiteHealth } from "@/lib/places/venueQuality";
import { isMenuPlatformWebsite } from "@/lib/places/menuPlatform";
import { classifyUrl, isParkedHtml } from "@/lib/places/siteTriage";
import { toCsv, parseCsv } from "@/lib/recover/hiddenReview";

const DATABASE_URL = process.env.DATABASE_URL;
const args = process.argv.slice(2);
const argValue = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const applyPath = argValue("--apply");
// Report mode is city-scoped (needs --city/--state); --apply operates on a saved file.
const cityArgs = applyPath ? null : requireCityArgs();

// venue.type values that, on their own, imply alcohol. "restaurant"/"cafe"/"pizzeria"/
// "other" are deliberately ABSENT — ambiguous, so they earn alcohol via SITE content or
// a live HH, never excluded for being typed "restaurant".
const ALCOHOL_TYPES = new Set([
  "bar", "sports_bar", "pub", "dive_bar", "wine_bar", "brewery",
  "tasting_room", "cocktail_lounge", "gastropub", "club", "hotel_bar",
]);

function today() { return new Date().toISOString().slice(0, 10); }
const TLS_ERR = /ssl|tls|certificate|eproto|packet length|err_ssl/i;
const DNS_ERR = /enotfound|eai_again|econnrefused|getaddrinfo/i;

interface SiteProbe { health: SiteHealth; text: string; }

/** Classify a fetch error string: DNS/refused is truly dead; everything else (timeout,
 *  reset, bot-block without a status) is "blocked" — alive but unreadable (SACRED). */
function netErr(res: { ok: boolean; status?: number; error?: string }): "dead" | "blocked" | null {
  if (res.ok || typeof res.status === "number" || !res.error) return null;
  return DNS_ERR.test(res.error) ? "dead" : "blocked";
}

/** Probe a venue's own site for health + alcohol content. Reads homepage + a menu/HH
 *  page (recall for restaurants whose drink list isn't on the landing page). $0 HTTP.
 *  Health classification (classifySiteHealth) treats a 403/timeout/empty-200 as ALIVE
 *  but unreadable — never "dead" — so a bot-walled real venue is flagged for review,
 *  not dropped (the Boulevard Cafe 403). */
async function probeSite(websiteUrl: string | null): Promise<SiteProbe> {
  const base = {
    hasUrl: !!websiteUrl,
    isMenuPlatform: !!websiteUrl && isMenuPlatformWebsite(websiteUrl),
    isSocial: !!websiteUrl && classifyUrl(websiteUrl).kind === "social_only",
  };
  const off = { ok: false, status: null, networkError: null, hasText: false, parked: false, squatter: false, brokenHttps: false } as const;
  if (!base.hasUrl || base.isMenuPlatform || base.isSocial) {
    return { health: classifySiteHealth({ ...base, ...off }), text: "" };
  }

  let res = await fetchUrl(websiteUrl!);
  let brokenHttps = false;
  // HTTPS broken but server alive? retry plain HTTP (Los Metates: serves a squatter over http).
  if (!res.ok && res.error && TLS_ERR.test(res.error) && websiteUrl!.startsWith("https://")) {
    brokenHttps = true;
    res = await fetchUrl(websiteUrl!.replace(/^https:/, "http:"));
  }

  let text = res.ok && res.contentText ? res.contentText : "";
  const squatter = !!text && isSquatterHtml(text);
  const parked = !!text && isParkedHtml(text);
  // If readable with no alcohol yet, follow common menu/HH paths so real restaurants
  // get a fair read before we conclude "no alcohol evidence".
  if (text && !squatter && !parked && !hasAlcoholContent(text)) {
    try {
      const origin = new URL(res.url || websiteUrl!).origin;
      for (const path of ["/menu", "/menus", "/drinks", "/happy-hour"]) {
        const sub = await fetchUrl(`${origin}${path}`);
        if (sub.ok && sub.contentText) {
          text += "\n" + sub.contentText;
          if (hasAlcoholContent(text)) break;
        }
      }
    } catch { /* origin unparseable — homepage text only */ }
  }

  const health = classifySiteHealth({
    ...base,
    ok: res.ok,
    status: res.status ?? null,
    networkError: netErr(res),
    hasText: !!(res.ok && res.contentText),
    parked,
    squatter,
    brokenHttps,
  });
  return { health, text };
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

async function runReport() {
  if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL is required."); process.exit(1); }
  const sql = postgres(DATABASE_URL, { max: 4 });
  try {
    // Resolve the (slug, state) pair to one city_id — case-insensitive on both, the
    // canonical path. A raw `c.state = 'ca'` compare silently returns 0 rows when the DB
    // stores state uppercase (the bug that made the first daly-city run scan 0 venues).
    const city = await resolveCity(sql, cityArgs!.slug, cityArgs!.state);
    const venues = await sql<
      { id: string; name: string; type: string | null; website_url: string | null; hh_live: number }[]
    >`
      SELECT v.id, v.name, v.type, v.website_url,
        (SELECT count(*)::int FROM happy_hours h WHERE h.venue_id = v.id AND h.active AND h.deleted_at IS NULL) AS hh_live
      FROM venues v
      WHERE v.deleted_at IS NULL AND v.status = 'active' AND v.city_id = ${city.id}
      ORDER BY v.name
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    const rows = await pool(venues, 6, async (v) => {
      const probe = await probeSite(v.website_url);
      const typeSig = v.type ? ALCOHOL_TYPES.has(v.type) : false;
      const nameSig = hasAlcoholSignal(v.name, null, null);
      const siteSig = hasAlcoholContent(probe.text);
      const anyAlcohol = typeSig || nameSig || siteSig;
      const verdict = qualityVerdict({ hhLive: v.hh_live, anyAlcohol, health: probe.health });
      return {
        // verdict + venueId lead so the CSV's decision column and the id --apply needs
        // are the obvious edit/key columns.
        verdict, venueId: v.id, venue: v.name, type: v.type ?? "", hhLive: v.hh_live,
        alcType: typeSig, alcName: nameSig, alcSite: siteSig, anyAlcohol,
        siteHealth: probe.health, websiteUrl: v.website_url ?? "",
      };
    });

    const drop = rows.filter((r) => r.verdict === "drop?");
    const keep = rows.filter((r) => r.verdict === "keep");
    const review = rows.filter((r) => r.verdict === "review");
    const tally = (key: (r: typeof rows[number]) => string) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };

    const stamp = today();
    const base = `docs/quality-audit-${cityArgs!.slug}-${stamp}`;
    writeFileSync(`${base}.json`, JSON.stringify({ generatedAt: stamp, city: cityArgs, scanned: rows.length, keep: keep.length, drop: drop.length, review: review.length, rows }, null, 2));
    const yn = (b: boolean) => (b ? "Y" : "·");
    const line = (r: typeof rows[number]) =>
      `| ${r.verdict} | ${r.venue} | ${r.type} | ${r.hhLive} | ${yn(r.alcType)} | ${yn(r.alcName)} | ${yn(r.alcSite)} | ${r.siteHealth} | ${r.websiteUrl} |`;
    const md = [
      `# Quality audit — ${cityArgs!.slug}, ${cityArgs!.state} — ${stamp}`,
      "",
      `Scanned **${rows.length}** active venues. Suggested **keep ${keep.length}**, **drop? ${drop.length}**, **review ${review.length}**.`,
      "Verdict is a SUGGESTION (nothing applied). `drop?` = no live HH AND a confidently-bad site",
      "(dead/squatter/parked/menu-platform) OR a site we READ that has no alcohol. `review` = alive",
      "but we couldn't read it (403 bot-wall / timeout / empty / social-only) — flagged, never auto-dropped.",
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
      "## review (alive but unreadable — flag, don't drop)",
      "",
      "| verdict | venue | type | HH | aT | aN | aS | site | url |",
      "|---|---|---|--:|:--:|:--:|:--:|---|---|",
      ...review.map(line),
      "",
      "## keep",
      "",
      "| verdict | venue | type | HH | aT | aN | aS | site | url |",
      "|---|---|---|--:|:--:|:--:|:--:|---|---|",
      ...keep.map(line),
      "",
    ].join("\n");
    writeFileSync(`${base}.md`, md);
    writeFileSync(
      `${base}.csv`,
      toCsv(rows, ["verdict", "venue", "type", "hhLive", "alcType", "alcName", "alcSite", "siteHealth", "websiteUrl", "venueId"]),
    );

    console.log(`scanned ${rows.length}: keep ${keep.length}, drop? ${drop.length}, review ${review.length}`);
    console.log(`site health: ${tally((r) => r.siteHealth).map(([k, n]) => `${k}×${n}`).join(", ")}`);
    console.log(`report → ${base}.md`);
    console.log(`edit verdicts in ${base}.csv (or .json), then: pnpm audit:quality --apply ${base}.csv`);
  } finally {
    await sql.end();
  }
}

/**
 * Apply a reviewed report file (.csv or .json): soft-delete every venue whose verdict is
 * "drop?". Reads ONLY the file you edited — it never re-scans, so your review is final and
 * an apply can't reclassify on a changed site. Soft delete (deleted_at) + deactivate the
 * venue's happy_hours + audit_log, exactly like remove:venues. Idempotent.
 */
async function runApply(path: string) {
  if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL is required."); process.exit(1); }
  const raw = readFileSync(path, "utf8");
  const fileRows: Array<Record<string, string>> = path.endsWith(".csv")
    ? parseCsv(raw)
    : (JSON.parse(raw).rows as Array<Record<string, unknown>>).map(
        (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])),
      );
  const VALID = new Set(["keep", "drop?", "review"]);
  const drops: { venueId: string; venue: string }[] = [];
  fileRows.forEach((r, i) => {
    const verdict = (r.verdict ?? "").trim();
    if (!VALID.has(verdict)) throw new Error(`row ${i + 1}: bad verdict "${verdict}" (venue=${r.venue})`);
    if (verdict === "drop?") {
      if (!r.venueId) throw new Error(`row ${i + 1}: drop? row missing venueId (venue=${r.venue})`);
      drops.push({ venueId: r.venueId, venue: r.venue ?? "" });
    }
  });

  const sql = postgres(DATABASE_URL, { max: 1 });
  let removed = 0;
  try {
    for (const d of drops) {
      const [v] = await sql<{ id: string }[]>`SELECT id FROM venues WHERE id = ${d.venueId} AND deleted_at IS NULL`;
      if (!v) continue; // already removed / unknown id
      await sql.begin(async (tx) => {
        await tx`UPDATE happy_hours SET active = false, updated_at = now() WHERE venue_id = ${d.venueId} AND active = true AND deleted_at IS NULL`;
        await tx`UPDATE venues SET deleted_at = now(), updated_at = now() WHERE id = ${d.venueId}`;
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('venues', ${d.venueId}, ${tx.json({ deletedAt: null })}, ${tx.json({ deletedAt: "now" })},
                  'script', 'quality audit: no happy hour + no alcohol/bar signal')
        `;
      });
      removed++;
    }
    console.log(`soft-deleted ${removed} of ${drops.length} drop? venue(s) from ${path}`);
  } finally {
    await sql.end();
  }
}

(applyPath ? runApply(applyPath) : runReport()).catch((err) => { console.error(err); process.exit(1); });
