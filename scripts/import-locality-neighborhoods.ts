/**
 * import:locality-neighborhoods — add a multi-town metro's constituent cities as COARSE
 * neighborhoods so venues Google didn't sub-label still get a location (their town) and the
 * filter dropdown offers each town by name.
 *
 * For single-town cities this is a no-op. For metro slugs whose boundary is a dissolved union
 * of several incorporated cities (e.g. san-mateo = San Mateo + Belmont + San Carlos + Foster
 * City + Burlingame, or five-cities), the per-town admin boundary is the right COARSE layer:
 *   - tier='coarse' so a recognizable FINE Google sub-neighborhood (Downtown, Burlingame
 *     Terrace, …) still wins for venues that have one (see lib/geo/assignNeighborhoods ranking);
 *   - blank venues (no Google name) fall to the containing town polygon.
 *
 * Towns are read from cities.seed_config.serviceLocalities and fetched from OSM via Nominatim
 * (admin boundary polygon). Idempotent: a locality whose slug already exists is skipped.
 * Run `backfill:neighborhoods` afterward to assign venues.
 *
 *   tsx scripts/import-locality-neighborhoods.ts --city san-mateo --state ca
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "happyhourfriends-onboard/1.0 (steven.matthiesen@gmail.com)";

async function fetchLocalityGeoJSON(
  locality: string,
  state: string,
): Promise<{ geojson: unknown; osm: string; addrType?: string } | null> {
  // Structured city= query (not free-form q) so an ambiguous name resolves to the CITY admin
  // boundary, not the same-named county — "San Mateo, CA" free-form returns San Mateo County.
  const url =
    `${NOMINATIM}?city=${encodeURIComponent(locality)}&state=${encodeURIComponent(state)}` +
    `&country=USA&format=json&polygon_geojson=1&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for "${locality}, ${state}"`);
  const arr = (await res.json()) as Array<{
    osm_type: string;
    osm_id: number;
    geojson?: { type: string };
    addresstype?: string;
    display_name: string;
  }>;
  const hit = arr[0];
  if (!hit?.geojson) return null;
  if (hit.geojson.type !== "Polygon" && hit.geojson.type !== "MultiPolygon") {
    console.log(`  ! "${locality}": Nominatim returned ${hit.geojson.type}, not a polygon — skipping`);
    return null;
  }
  return { geojson: hit.geojson, osm: `${hit.osm_type}/${hit.osm_id}`, addrType: hit.addresstype };
}

/** Reject a polygon far larger than any city (almost always a county/region mismatch). */
const MAX_CITY_AREA_KM2 = 300;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { slug, state } = requireCityArgs();
  const sql = postgres(url, { max: 1 });
  try {
    const c = await resolveCity(sql, slug, state);
    // seed_config can be a jsonb object OR a JSON-encoded jsonb string (seed-cities stores the
    // latter). Normalize with #>>'{}' (whole-doc as text) → re-parse, so both shapes work.
    const [cfg] = await sql<{ localities: string[] | null }[]>`
      SELECT ((seed_config #>> '{}')::jsonb -> 'serviceLocalities') AS localities FROM cities WHERE id = ${c.id}
    `;
    const raw = cfg?.localities;
    const localities = (Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : []).filter(Boolean);
    if (localities.length < 2) {
      console.log(
        `'${slug}' has ${localities.length} service localit(y/ies) — locality neighborhoods are only ` +
          `meaningful for multi-town metro slugs. Nothing to do.`,
      );
      return;
    }
    console.log(`Importing ${localities.length} locality neighborhood(s) for '${c.name}': ${localities.join(", ")}`);

    let inserted = 0;
    let skipped = 0;
    for (const locality of localities) {
      const lslug = slugify(locality);
      const [{ exists }] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM neighborhoods WHERE city_id = ${c.id} AND slug = ${lslug}) AS exists
      `;
      if (exists) {
        console.log(`  = ${locality} (${lslug}) already exists — skipping`);
        skipped++;
        continue;
      }
      const fetched = await fetchLocalityGeoJSON(locality, state);
      // Nominatim courtesy: ≤1 req/sec.
      await new Promise((r) => setTimeout(r, 1200));
      if (!fetched) {
        console.log(`  ✗ ${locality}: no polygon from Nominatim — skipping`);
        continue;
      }
      const geomJson = JSON.stringify(fetched.geojson);
      const [{ km2 }] = await sql<{ km2: number }[]>`
        SELECT ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)::geography) / 1e6 AS km2
      `;
      if (Number(km2) > MAX_CITY_AREA_KM2) {
        console.log(
          `  ✗ ${locality}: polygon is ${Number(km2).toFixed(0)} km² (> ${MAX_CITY_AREA_KM2}) — ` +
            `likely a county/region, not the city (addrtype=${fetched.addrType}). Skipping.`,
        );
        continue;
      }
      await sql`
        INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability, in_scope)
        VALUES (
          ${c.id}, ${locality}, ${lslug},
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)), 3)),
          'OpenStreetMap locality (admin boundary)',
          ${`https://www.openstreetmap.org/${fetched.osm}`},
          false, 'coarse', 2, true
        )
      `;
      console.log(`  ✓ ${locality} (${lslug}) ← OSM ${fetched.osm}`);
      inserted++;
    }
    console.log(`\nDone: ${inserted} inserted, ${skipped} skipped. Run backfill:neighborhoods to assign venues.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
