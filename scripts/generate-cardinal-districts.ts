/**
 * Generate a gap-free coarse "cardinal district" layer for a city, clipped to its real
 * boundary. The friendly-rollup floor: only surfaces where no recognizable named or admin
 * coarse area covers a venue.
 *
 *   npm run generate:cardinal-districts -- --city tucson
 *   npm run generate:cardinal-districts -- --city tucson --boundary ./data/tucson-boundary.geojson
 *   npm run generate:cardinal-districts -- --city tucson --downtown 32.2226,-110.9747
 *
 * Boundary source order: --boundary file → data/<city>-boundary.geojson. The bbox of that
 * boundary feeds cardinalRects(); each rectangle is intersected with the boundary so zones
 * never spill outside the city. Downtown = a 1.5km buffer around the anchor (--downtown
 * "lat,lng", else the boundary centroid), clipped to the boundary, layered on top. Zone
 * names can be overridden via data/<city>-cardinal-aliases.json
 * (e.g. {"Central":"Midtown","North":"Foothills"}). Idempotent: skips slugs already
 * present. Re-runs assignment at the end.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";
import {
  cardinalRects,
  type Bbox,
  type CardinalAliases,
} from "@/lib/geo/cardinalDistricts";

const DOWNTOWN_RADIUS_M = 1500;

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

interface GeoJsonFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown> | null;
}

interface GeoJsonFc {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

/** Extract all geometry JSON strings from a FeatureCollection or bare Feature/Geometry. */
function extractGeometries(raw: unknown): string[] {
  const r = raw as Record<string, unknown>;
  if (r.type === "FeatureCollection") {
    return (r as unknown as GeoJsonFc).features
      .map((f) => (f.geometry ? JSON.stringify(f.geometry) : null))
      .filter((g): g is string => g !== null);
  }
  if (r.type === "Feature") {
    const f = r as unknown as GeoJsonFeature;
    return f.geometry ? [JSON.stringify(f.geometry)] : [];
  }
  // Bare geometry
  return [JSON.stringify(r)];
}

async function main() {
  const city = getArg("--city");
  if (!city) throw new Error("Required: --city <slug> [--boundary file] [--downtown lat,lng]");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const boundaryPath = getArg("--boundary") ?? `./data/${city}-boundary.geojson`;
  if (!existsSync(boundaryPath)) {
    throw new Error(`No boundary file at ${boundaryPath}. Pass --boundary <path>.`);
  }
  const boundaryRaw = JSON.parse(readFileSync(boundaryPath, "utf8")) as unknown;
  const boundaryGeoms = extractGeometries(boundaryRaw);
  if (boundaryGeoms.length === 0) {
    throw new Error(`Boundary file at ${boundaryPath} contains no geometries.`);
  }

  const aliasPath = `./data/${city}-cardinal-aliases.json`;
  const aliases: CardinalAliases = existsSync(aliasPath)
    ? (JSON.parse(readFileSync(aliasPath, "utf8")) as CardinalAliases)
    : {};

  const sql = postgres(url, { max: 1 });
  try {
    const [c] = await sql<{ id: string }[]>`SELECT id FROM cities WHERE slug = ${city}`;
    if (!c) throw new Error(`City '${city}' not found.`);

    // Build the merged boundary geometry in Postgres: union all parts, compute bbox +
    // centroid in one query. Each geometry string is a separate row in a VALUES clause.
    const geomValues = boundaryGeoms
      .map((g) => sql`(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${g}), 4326)))`)
      .reduce(
        (acc, expr, i) =>
          i === 0 ? sql`${expr}` : sql`${acc}, ${expr}`,
      );

    const [b] = await sql<{
      minx: number;
      miny: number;
      maxx: number;
      maxy: number;
      clat: number;
      clng: number;
      boundaryWkt: string;
    }[]>`
      WITH parts(geom) AS (VALUES ${geomValues}),
      g AS (SELECT ST_SetSRID(ST_Collect(geom), 4326) AS geom FROM parts)
      SELECT ST_XMin(geom) AS minx, ST_YMin(geom) AS miny,
             ST_XMax(geom) AS maxx, ST_YMax(geom) AS maxy,
             ST_Y(ST_Centroid(geom)) AS clat, ST_X(ST_Centroid(geom)) AS clng,
             ST_AsText(geom) AS "boundaryWkt"
      FROM g
    `;
    const bbox: Bbox = { west: b.minx, south: b.miny, east: b.maxx, north: b.maxy };

    // Downtown anchor: --downtown "lat,lng" or the boundary centroid.
    const dtArg = getArg("--downtown");
    const [anchorLat, anchorLng] = dtArg
      ? dtArg.split(",").map(Number)
      : [b.clat, b.clng];

    // The boundary as a reusable SQL expression from its WKT.
    const boundarySql = sql`ST_SetSRID(ST_GeomFromText(${b.boundaryWkt}), 4326)`;

    const rects = cardinalRects(bbox, aliases);
    let inserted = 0;
    let skipped = 0;

    for (const r of rects) {
      const slug = slugify(r.name);
      const geomJson = JSON.stringify(r.geometry);
      const res = await sql<{ id: string }[]>`
        INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability)
        SELECT ${c.id}, ${r.name}, ${slug},
          ST_Multi(ST_CollectionExtract(
            ST_Intersection(${boundarySql}, ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)), 3)),
          'Generated cardinal district', NULL, false, 'coarse', 0
        WHERE NOT EXISTS (
          SELECT 1 FROM neighborhoods WHERE city_id = ${c.id} AND slug = ${slug}
        )
        RETURNING id
      `;
      if (res.length) inserted++;
      else skipped++;
    }

    // Downtown = anchor buffer clipped to boundary.
    const dtSlug = "downtown";
    const dtRes = await sql<{ id: string }[]>`
      INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability)
      SELECT ${c.id}, 'Downtown', ${dtSlug},
        ST_Multi(ST_CollectionExtract(
          ST_Intersection(
            ${boundarySql},
            ST_Buffer(ST_SetSRID(ST_MakePoint(${anchorLng}, ${anchorLat}), 4326)::geography, ${DOWNTOWN_RADIUS_M})::geometry
          ), 3)),
        'Generated cardinal district', NULL, false, 'coarse', 0
      WHERE NOT EXISTS (
        SELECT 1 FROM neighborhoods WHERE city_id = ${c.id} AND slug = ${dtSlug}
      )
      RETURNING id
    `;
    if (dtRes.length) inserted++;
    else skipped++;

    const reassigned = await assignNeighborhoods(sql, c.id);
    console.log(
      `Cardinal districts for '${city}': ${inserted} inserted, ${skipped} already present. ` +
        `Reassigned ${reassigned} venue(s).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
