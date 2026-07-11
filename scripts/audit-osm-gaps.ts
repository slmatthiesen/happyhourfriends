/**
 * audit:osm-gaps — free (no Google, no AI) discovery-gap finder.
 *
 * The Google Places Nearby sweep HAD a structural blind spot: a saturated 3000m seed tile
 * truncates to its 20 nearest, and the old single-level r/2 subdivision left an uncovered hole
 * around the tile center, so a venue there — e.g. Fuji Sacramento, a 4.6★/152-review Japanese
 * spot with a real HH — was never discovered. That geometry is now fixed (r/√2 children,
 * MAX_DEPTH=2 in discoveryTiling.ts), but OSM remains a valuable second, independent census:
 * it surfaces venues Google lacks/mis-types entirely and is free to query.
 *
 * This tool loads the city boundary, pulls OSM eat/drink amenities inside it via Overpass
 * (free), and reports which ones have NO matching seed_candidate or venue in our DB — the
 * discovery gap. Report-only: writes docs/<slug>-osm-gaps.csv and prints a summary. Feed the
 * gaps into enrich (those with a website) or a targeted Google Place Details backfill.
 *
 * Usage: tsx scripts/audit-osm-gaps.ts --city sacramento --state ca
 *
 * Requires data/<slug>-boundary.geojson and DATABASE_URL. Makes ONE Overpass call.
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { haversineMeters } from "@/lib/geo/distance";
import { isDenylistedChain, isLikelyNoHappyHourFormat } from "@/lib/places/chainDenylist";

// OSM amenity values we treat as candidate venues. fast_food is excluded — same policy as the
// Google sweep (fast-food chains never run a happy hour and would only add noise).
const OSM_AMENITIES = ["restaurant", "bar", "pub", "biergarten"] as const;
// Cuisine values we drop to mirror the Google sweep's EXCLUDED_PRIMARY_TYPES: thai/indian
// restaurants had zero confirmed happy hours across every onboarded city (validated before
// exclusion). Matched against any token of the OSM `cuisine` tag (e.g. "asian;thai").
const EXCLUDED_CUISINES = new Set(["thai", "indian"]);

function isExcludedCuisine(cuisine: string | null): boolean {
  if (!cuisine) return false;
  return cuisine.toLowerCase().split(/[;,]/).some((c) => EXCLUDED_CUISINES.has(c.trim()));
}
// A DB row within this distance of an OSM venue, with a matching name, counts as "already have
// it". Covers Google-vs-OSM coordinate drift (tens of metres) plus same-block placement.
const MATCH_METERS = 150;
// Tighter co-location tier: a DB row within this distance counts as the SAME venue even when the
// name does NOT match. The name test alone was too strict — a venue we already have under an OSM
// name variant our token/Jaccard match misses (e.g. "Fuji Sacramento" vs "Fuji Japanese Rest.")
// was counted as a gap, inflating counts ~2-3× (measured 2026-07-10: SF 57% of "gaps" sat ≤50m of
// a DB row). At this radius two distinct restaurants are essentially same-storefront, so the rare
// dense-block false-dedup is worth cutting the large false-gap inflation. Deduped count is logged.
const COLOCATION_METERS = 50;

interface OsmVenue {
  name: string;
  lat: number;
  lng: number;
  amenity: string;
  cuisine: string | null;
  website: string | null;
  osmId: string;
}

interface DbRow {
  name: string;
  lat: number;
  lng: number;
  kind: "candidate" | "venue";
}

/** Tokens that carry no identity — dropped before name comparison so "Fuji Sacramento" and
 *  "Fuji" still match, and generic descriptors don't create false matches. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "of", "at", "on", "co", "company", "inc", "llc",
  "restaurant", "restaurante", "bar", "grill", "grille", "kitchen", "cafe", "café",
  "lounge", "pub", "tavern", "eatery", "bistro", "house", "sacramento",
]);

function nameTokens(name: string): Set<string> {
  const toks = name
    .toLowerCase()
    .normalize("NFD") // accents decompose to base + combining mark; the next line drops the marks
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return new Set(toks.length > 0 ? toks : name.toLowerCase().replace(/[^a-z0-9]/g, "").split(""));
}

/** Same-venue name test: token containment (shorter ⊆ longer) OR Jaccard ≥ 0.5. */
function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let inter = 0;
  for (const t of small) if (big.has(t)) inter++;
  if (inter === small.size) return true; // full containment
  const union = ta.size + tb.size - inter;
  return inter / union >= 0.5;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpass(query: string): Promise<OverpassElement[]> {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "User-Agent": "happyhourfriends-discovery/1.0 (+https://happyhourfriends.com)",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) {
    throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()).elements ?? [];
}

function csvCell(s: string | null): string {
  const v = s ?? "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main() {
  const { slug, state } = requireCityArgs();
  const boundaryFile = `data/${slug}-boundary.geojson`;
  if (!existsSync(boundaryFile)) {
    throw new Error(`${boundaryFile} not found — this audit needs a city boundary polygon.`);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const city = await resolveCity(sql, slug, state);

    // Boundary → temp table (for in-boundary filtering + bbox).
    const raw = JSON.parse(readFileSync(boundaryFile, "utf8"));
    const geom = raw.type === "FeatureCollection" ? raw.features[0].geometry
      : raw.type === "Feature" ? raw.geometry : raw;
    await sql`CREATE TEMP TABLE _b (g geometry)`;
    await sql`INSERT INTO _b (g) VALUES (ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geom)}), 4326))`;
    const [bb] = await sql<{ xmin: number; ymin: number; xmax: number; ymax: number }[]>`
      SELECT ST_XMin(g) xmin, ST_YMin(g) ymin, ST_XMax(g) xmax, ST_YMax(g) ymax FROM _b`;

    // ---- OSM census (one Overpass call over the bbox) ----
    const amenityRe = `^(${OSM_AMENITIES.join("|")})$`;
    const q = `[out:json][timeout:90];(` +
      `node["amenity"~"${amenityRe}"](${bb.ymin},${bb.xmin},${bb.ymax},${bb.xmax});` +
      `way["amenity"~"${amenityRe}"](${bb.ymin},${bb.xmin},${bb.ymax},${bb.xmax});` +
      `);out tags center;`;
    console.log(`Querying OSM (Overpass) for ${OSM_AMENITIES.join("/")} in ${city.name}…`);
    const els = await overpass(q);

    // Keep named elements with coordinates, inside the boundary polygon.
    const rawVenues: OsmVenue[] = els.map((e) => {
      const t = e.tags ?? {};
      return {
        name: t.name ?? "",
        lat: (e.lat ?? e.center?.lat) as number,
        lng: (e.lon ?? e.center?.lon) as number,
        amenity: t.amenity,
        cuisine: t.cuisine ?? null,
        website: t.website ?? t["contact:website"] ?? null,
        osmId: `${e.type}/${e.id}`,
      };
    }).filter((v: OsmVenue) => v.name && v.lat != null && v.lng != null);

    const vals = rawVenues.map((v, i) => `(${i}, ${v.lng}, ${v.lat})`).join(",");
    const inB = await sql.unsafe<{ i: number }[]>(
      `SELECT v.i FROM (VALUES ${vals}) v(i,lng,lat), _b ` +
      `WHERE ST_Contains(_b.g, ST_SetSRID(ST_MakePoint(v.lng,v.lat),4326))`);
    const inside = new Set(inB.map((r) => Number(r.i)));
    let osm = rawVenues.filter((_, i) => inside.has(i));

    // Dedupe OSM (node + way for one venue): same normalized name within 40m.
    const deduped: OsmVenue[] = [];
    for (const v of osm) {
      if (deduped.some((d) => haversineMeters(d, v) < 40 && namesMatch(d.name, v.name))) continue;
      deduped.push(v);
    }
    // Apply the SAME gates the Google sweep uses so gaps are directly actionable, not bloat:
    //  - thai/indian cuisine (zero confirmed HH),
    //  - denylisted chains (IHOP/Sizzler/Denny's… — never a happy hour),
    //  - buffet/AYCE formats (Moonstar Buffet et al).
    const isNoise = (v: OsmVenue) =>
      isExcludedCuisine(v.cuisine) || isDenylistedChain(v.name) || isLikelyNoHappyHourFormat(v.name, v.website);
    const excludedNoise = deduped.filter(isNoise).length;
    osm = deduped.filter((v) => !isNoise(v));

    // ---- Our census (candidates + venues) ----
    const dbRows = await sql<DbRow[]>`
      SELECT name, lat::float8 AS lat, lng::float8 AS lng, 'candidate' AS kind
        FROM seed_candidates WHERE city_id = ${city.id} AND lat IS NOT NULL
      UNION ALL
      SELECT name, lat::float8 AS lat, lng::float8 AS lng, 'venue' AS kind
        FROM venues WHERE city_id = ${city.id} AND deleted_at IS NULL AND lat IS NOT NULL`;

    // ---- Gap detection: OSM venue we don't already have. "Already have it" = a DB row that
    //      name-matches within MATCH_METERS, OR any DB row within the tighter COLOCATION_METERS
    //      (same storefront → same venue even if the OSM name variant doesn't token-match). ----
    const gaps: OsmVenue[] = [];
    let colocationDedups = 0; // caught by co-location but NOT by name-match (the inflation the tier removes)
    for (const v of osm) {
      const nameMatch = dbRows.some((r) => haversineMeters(r, v) <= MATCH_METERS && namesMatch(r.name, v.name));
      const coLocated = dbRows.some((r) => haversineMeters(r, v) <= COLOCATION_METERS);
      if (nameMatch || coLocated) {
        if (!nameMatch && coLocated) colocationDedups++;
        continue;
      }
      gaps.push(v);
    }

    // Sort: enrichable (has website) first, then by name.
    gaps.sort((a, b) => (Number(Boolean(b.website)) - Number(Boolean(a.website))) || a.name.localeCompare(b.name));

    const withSite = gaps.filter((g) => g.website).length;
    const header = "name,amenity,cuisine,website,lat,lng,osm_id\n";
    const body = gaps.map((g) =>
      [g.name, g.amenity, g.cuisine, g.website, g.lat, g.lng, g.osmId].map((c) => csvCell(c == null ? null : String(c))).join(",")
    ).join("\n");
    const outPath = `docs/${slug}-osm-gaps.csv`;
    writeFileSync(outPath, header + body + "\n");

    console.log(`\n=== OSM gap audit: ${city.name}, ${city.state.toUpperCase()} ===`);
    console.log(`  OSM ${OSM_AMENITIES.join("/")} inside boundary: ${osm.length} (dropped ${excludedNoise} chain/buffet/thai/indian per policy)`);
    console.log(`  We already have (candidate/venue match): ${osm.length - gaps.length}  (incl. ${colocationDedups} caught by co-location ≤${COLOCATION_METERS}m, name mismatch)`);
    console.log(`  MISSING (discovery gaps): ${gaps.length}  (${withSite} have a website → enrichable now)`);
    console.log(`  → wrote ${outPath}`);
    if (gaps.length > 0) {
      console.log(`\n  Top gaps (website first):`);
      for (const g of gaps.slice(0, 25)) {
        console.log(`   • ${g.name}${g.cuisine ? ` [${g.cuisine}]` : ""} — ${g.website ?? "no website"}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
