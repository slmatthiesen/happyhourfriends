/**
 * rank-stub-candidates — local, read-only HH-likelihood shortlist over stub venues.
 *
 * Combines three FREE local signals (no network, no API, no DB writes):
 *   1. type prior (lib/places/hhLikelihood, via seed_candidates primaryType/types)
 *   2. the last plain-fetch harvest's on-site HH signal (docs/hh-harvest.jsonl)
 *   3. a small popularity tiebreak (rating x reviews)
 * and emits a per-city ranked markdown + json shortlist the operator hand-verifies.
 *
 * Usage: tsx scripts/rank-stub-candidates.ts [--city <slug> --state <code>] [--limit N] [--min-score X]
 * Env: DATABASE_URL (required). Reads docs/hh-harvest.jsonl if present.
 *
 * See docs/superpowers/specs/2026-06-01-rank-stub-candidates-design.md.
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { scoreStub, LOW_YIELD_PRIOR, type StubScore } from "@/lib/places/stubRank";
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";
import type { VenueType } from "@/lib/places/venueType";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const HARVEST_PATH = "docs/hh-harvest.jsonl";
const DATE = "2026-06-01";
const MD_OUT = `docs/stub-candidates-ranked-${DATE}.md`;
const JSON_OUT = `docs/stub-candidates-ranked-${DATE}.json`;

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    hasCity: a.includes("--city"),
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : null,
    minScore: get("--min-score") ? parseFloat(get("--min-score")!) : null,
  };
}

interface StubRow {
  id: string;
  name: string;
  city: string;
  website_url: string | null;
  type: string | null;
  primary_type: string | null;
  types: string[] | null;
  rating: string | null;
  user_rating_count: number | null;
  business_status: string | null;
}

interface HarvestRec {
  venueId: string;
  name: string;
  city: string;
  signal: boolean;
  sources: { url: string; snippets: string[] }[];
}

/** Load the harvest digest into lookup maps (by id, and by name::city fallback). */
function loadHarvest(): { byId: Map<string, HarvestRec>; byNameCity: Map<string, HarvestRec> } {
  const byId = new Map<string, HarvestRec>();
  const byNameCity = new Map<string, HarvestRec>();
  if (!existsSync(HARVEST_PATH)) {
    console.warn(`⚠  ${HARVEST_PATH} not found — ranking on type prior only.`);
    return { byId, byNameCity };
  }
  for (const line of readFileSync(HARVEST_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as HarvestRec;
      byId.set(r.venueId, r);
      byNameCity.set(`${r.name.toLowerCase()}::${r.city}`, r);
    } catch {
      /* skip malformed line */
    }
  }
  return { byId, byNameCity };
}

/** First snippet that mentions happy hour, trimmed for the "why" column. */
function hhSnippet(rec: HarvestRec | undefined): string | null {
  if (!rec?.signal) return null;
  for (const s of rec.sources) {
    if (isDenylistedSource(s.url)) continue;
    for (const snip of s.snippets) {
      if (/happy\s*hour/i.test(snip)) {
        return snip.replace(/\s+/g, " ").trim().slice(0, 90);
      }
    }
  }
  return null;
}

/** First harvest source URL that isn't a banned competitor aggregator. */
function harvestSourceUrl(rec: HarvestRec | undefined): string | null {
  if (!rec?.signal) return null;
  for (const s of rec.sources) {
    if (s.url && !isDenylistedSource(s.url)) return s.url;
  }
  return null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** A harvest hit on a different host than the venue's own site — confirm first-party. */
function harvestIsThirdParty(row: StubRow, rec: HarvestRec | undefined): boolean {
  const src = harvestSourceUrl(rec);
  const srcHost = hostOf(src);
  const siteHost = hostOf(row.website_url);
  return !!srcHost && !!siteHost && srcHost !== siteHost;
}

function whereToCheck(row: StubRow, rec: HarvestRec | undefined): string {
  // Prefer the exact URL the free harvest already confirmed carries HH text.
  const src = harvestSourceUrl(rec);
  if (src) return src;
  if (row.website_url) {
    // No confirmed HH page — send the operator to the venue's real homepage to
    // navigate from. (We used to guess `${origin}/happy-hour`, but that path
    // 404s on most sites, which corrupts manual triage: a real-HH venue gets
    // marked "no" because the GUESS was dead. The homepage is always real.)
    try {
      return new URL(row.website_url).origin;
    } catch {
      return row.website_url;
    }
  }
  return `search "${row.name} ${row.city} happy hour"`;
}

interface Ranked {
  row: StubRow;
  s: StubScore;
  snippet: string | null;
  where: string;
  boosted: boolean;
}

function mdEscape(x: string): string {
  return x.replace(/\|/g, "\\|");
}

function renderCity(city: string, ranked: Ranked[], limit: number | null): string {
  const live = ranked.filter((r) => !r.s.closed);
  const closed = ranked.filter((r) => r.s.closed);
  const shown = limit ? live.slice(0, limit) : live;

  const lines: string[] = [];
  lines.push(`## ${city} — ${live.length} ranked stub(s)`);
  lines.push("");
  // Triage-first column order: venue, website, your mark, then type/score/why.
  lines.push("| # | venue | website | mark | type | score | why |");
  lines.push("|---|-------|---------|------|------|------:|-----|");

  let dividerShown = false;
  shown.forEach((r, i) => {
    if (!dividerShown && r.s.score < LOW_YIELD_PRIOR) {
      lines.push(`| | _— low-yield below (score < ${LOW_YIELD_PRIOR}) —_ | | | | | |`);
      dividerShown = true;
    }
    const type = r.row.primary_type ?? r.row.type ?? "—";
    const why = [r.s.reasons.join("; "), r.snippet ? `“${r.snippet}”` : ""]
      .filter(Boolean)
      .join(" — ");
    lines.push(
      `| ${i + 1} | ${mdEscape(r.row.name)} | ${mdEscape(r.where)} |  | ${mdEscape(type)} | ${r.s.score.toFixed(2)} | ${mdEscape(why)} |`,
    );
  });

  const noSite = live.filter((r) => r.s.noSite).length;
  lines.push("");
  lines.push(
    `_${live.length} ranked · ${noSite} no-site (search by name) · ${closed.length} closed (excluded)_`,
  );
  if (closed.length) {
    lines.push("");
    lines.push(`<details><summary>closed, excluded (${closed.length})</summary>`);
    lines.push("");
    for (const r of closed) lines.push(`- ${r.row.name}`);
    lines.push("");
    lines.push("</details>");
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL not set.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 1 });
  const { byId, byNameCity } = loadHarvest();

  // --city is optional; when provided, --state is also required.
  let cityId: string | undefined;
  if (args.hasCity) {
    const { slug, state } = requireCityArgs();
    const city = await resolveCity(sql, slug, state);
    cityId = city.id;
  }

  const rows = await sql<StubRow[]>`
    SELECT v.id, v.name, c.slug AS city, v.website_url, v.type::text AS type,
           sc.primary_type, sc.types, sc.rating::text AS rating,
           sc.user_rating_count, sc.business_status
    FROM venues v
    JOIN cities c ON c.id = v.city_id
    LEFT JOIN LATERAL (
      SELECT primary_type, types, rating, user_rating_count, business_status
      FROM seed_candidates sc
      WHERE sc.resulting_venue_id = v.id
         OR (v.google_place_id IS NOT NULL AND sc.google_place_id = v.google_place_id)
      ORDER BY (sc.resulting_venue_id = v.id) DESC NULLS LAST
      LIMIT 1
    ) sc ON true
    WHERE v.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM happy_hours hh
        WHERE hh.venue_id = v.id AND hh.active AND hh.deleted_at IS NULL
      )
      ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
    ORDER BY c.slug, v.name`;

  const ranked: Ranked[] = rows.map((row) => {
    const rec = byId.get(row.id) ?? byNameCity.get(`${row.name.toLowerCase()}::${row.city}`);
    // Only count a harvest hit if it has a usable (non-competitor) source — a hit
    // seen only on a banned aggregator can't justify a boost.
    const usableHarvest = harvestSourceUrl(rec) !== null;
    const s = scoreStub({
      name: row.name,
      venueType: (row.type as VenueType | null) ?? null,
      primaryType: row.primary_type,
      types: row.types,
      harvestSignal: usableHarvest,
      rating: row.rating !== null ? Number(row.rating) : null,
      userRatingCount: row.user_rating_count,
      businessStatus: row.business_status,
      hasWebsite: !!row.website_url,
    });
    if (usableHarvest && harvestIsThirdParty(row, rec)) {
      s.reasons.push("harvest hit is 3rd-party — confirm on first-party site");
    }
    return { row, s, snippet: hhSnippet(rec), where: whereToCheck(row, rec), boosted: usableHarvest };
  });

  // Sort within city: score desc, popularity desc, name asc.
  ranked.sort(
    (a, b) =>
      a.row.city.localeCompare(b.row.city) ||
      b.s.score - a.s.score ||
      b.s.popBump - a.s.popBump ||
      a.row.name.localeCompare(b.row.name),
  );

  const cities = [...new Set(ranked.map((r) => r.row.city))];
  const totalLive = ranked.filter((r) => !r.s.closed).length;
  const harvestBoosted = ranked.filter((r) => r.boosted).length;

  const md: string[] = [];
  md.push(`# Stub HH candidates — ranked (${DATE})`);
  md.push("");
  md.push(
    `${totalLive} stub venues ranked by P(findable happy hour), local signals only ` +
      `(type prior + harvest on-site signal + popularity). ${harvestBoosted} carry a ` +
      `live harvest HH snippet — work those first. No API, no DB writes.`,
  );
  md.push("");
  md.push(
    "Triage: open the **website** URL, then fill the **mark** column — " +
      "`y` = has a real HH, `n` = no HH / not relevant, `?` = unsure. For each `y`, " +
      "note in **why** *where* you found it (homepage / `/happy-hour` page / PDF menu / " +
      "Facebook / Instagram / Google) — that's what tells us where the extractor missed.",
  );
  md.push("");
  for (const city of cities) {
    const filtered = ranked
      .filter((r) => r.row.city === city)
      .filter((r) => (args.minScore !== null ? r.s.score >= args.minScore : true));
    md.push(renderCity(city, filtered, args.limit));
  }

  writeFileSync(MD_OUT, md.join("\n"));
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      ranked.map((r) => ({
        id: r.row.id,
        name: r.row.name,
        city: r.row.city,
        type: r.row.primary_type ?? r.row.type,
        score: Number(r.s.score.toFixed(4)),
        base: r.s.base,
        harvestSignal: r.boosted,
        closed: r.s.closed,
        noSite: r.s.noSite,
        reasons: r.s.reasons,
        snippet: r.snippet,
        where: r.where,
      })),
      null,
      2,
    ),
  );

  console.log(`Ranked ${totalLive} stubs across ${cities.length} city(ies).`);
  console.log(`  ${harvestBoosted} have a live harvest HH snippet (highest-confidence finds).`);
  console.log(`→ ${MD_OUT}`);
  console.log(`→ ${JSON_OUT}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
