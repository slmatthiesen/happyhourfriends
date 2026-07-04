/**
 * Add a metro's constituent towns as COARSE neighborhood polygons, fetched directly from
 * OSM by relation/way id (NOT Nominatim-by-name). Companion to build-aggregate-boundary:
 * build-aggregate-boundary dissolves the same inputs into the discovery boundary; this
 * inserts each input as its own neighborhood so the filter dropdown offers each town by
 * name and venues without a Google sub-label still resolve to their town.
 *
 * Direct OSM-id fetch avoids ambiguous-name mismatches that break Nominatim-by-name for
 * unincorporated CDPs — e.g. "Live Oak" via Nominatim resolves to the city in Sutter
 * County, ~300km from the Santa Cruz CDP; "Twin Lakes" is named in many counties. We
 * already have the exact OSM refs (from enumerating the metro boundary), so use them.
 * Idempotent on (city, slug). Run `backfill:neighborhoods` afterward to assign venues.
 *
 *   tsx scripts/add-metro-locality-neighborhoods.ts --city santa-cruz --state ca \
 *     --items "Santa Cruz=r:111737,Capitola=r:3574370,Twin Lakes=r:7063032,Soquel=r:9408781,\
 * Aptos=r:9408782,Live Oak=w:33167234,Rio del Mar=w:33167250"
 */
import "dotenv/config";
import postgres from "postgres";
import osmtogeojson from "osmtogeojson";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchGeom(ref: string): Promise<{ geojson: string; osm: string }> {
  const isWay = ref.startsWith("w:");
  const id = ref.replace(/^[wr]:/, "");
  const query = `[out:json][timeout:90];${isWay ? "way" : "rel"}(${id});out geom;`;
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "happyhourfriends-boundary-build/1.0 (steven.matthiesen@gmail.com)",
      },
    });
    if (res.status !== 429 && res.status !== 504) break;
    await sleep(5000 * (attempt + 1));
  }
  if (!res || !res.ok) throw new Error(`Overpass ${res?.status} for ${ref}`);
  const osm = await res.json();
  const gj = osmtogeojson(osm) as {
    features: Array<{ geometry: { type: string; coordinates: unknown } | null }>;
  };
  const poly = gj.features.find(
    (f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
  );
  if (!poly?.geometry)
    throw new Error(
      `no polygon geometry for ${ref} (got ${gj.features.map((f) => f.geometry?.type).join(",") || "none"})`,
    );
  return {
    geojson: JSON.stringify(poly.geometry),
    osm: `${isWay ? "way" : "relation"}/${id}`,
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { slug, state } = requireCityArgs();
  void state;
  const sql = postgres(url, { max: 1 });
  try {
    const c = await resolveCity(sql, slug, state);
    const items = arg("items")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let inserted = 0;
    let skipped = 0;
    for (const item of items) {
      const eq = item.lastIndexOf("=");
      if (eq === -1) {
        console.log(`  ! "${item}": no "=ref" — skipping`);
        continue;
      }
      const name = item.slice(0, eq).trim();
      const ref = item.slice(eq + 1).trim();
      const lslug = slugify(name);
      const [{ exists }] = await sql<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM neighborhoods WHERE city_id = ${c.id} AND slug = ${lslug}) AS exists
      `;
      if (exists) {
        console.log(`  = ${name} (${lslug}) already exists — skipping`);
        skipped++;
        continue;
      }
      const { geojson, osm } = await fetchGeom(ref);
      await sleep(2000); // be polite to the public Overpass endpoint
      await sql`
        INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability, in_scope)
        VALUES (
          ${c.id}, ${name}, ${lslug},
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)), 3)),
          'OpenStreetMap locality (admin/census boundary)',
          ${`https://www.openstreetmap.org/${osm}`},
          false, 'coarse', 2, true
        )
      `;
      console.log(`  ✓ ${name} (${lslug}) ← OSM ${osm}`);
      inserted++;
    }
    console.log(
      `\nDone: ${inserted} inserted, ${skipped} skipped. Run backfill:neighborhoods to assign venues.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
