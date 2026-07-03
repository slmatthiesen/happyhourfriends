/**
 * OSM open-space fetcher: large parks / preserves / forests / water → a per-city mask that
 * discovery subtracts from the tiling area so we stop paying Google searchNearby calls for
 * tiles buried in empty land INSIDE the municipal boundary.
 *
 *   pnpm import:osm-open-space -- --city scottsdale --state az
 *   pnpm import:osm-open-space -- --city scottsdale --state az --min-area-km2 2
 *
 * WHY: the discovery tile-keep prune measures distance to the boundary polygon, so it drops
 * tiles OUTSIDE the city line (open desert, ocean) for free — but it is blind to open space
 * INSIDE the boundary. Scottsdale's boundary swallows the McDowell Sonoran Preserve; ~$1.20–1.80
 * of its discovery spend bought empty-preserve tiles. This writes data/<slug>-open-space.geojson,
 * which seed-discover.ts auto-detects and subtracts from the boundary for the tile prune ONLY
 * (the per-candidate boundary gate is untouched, so an edge/clubhouse venue still qualifies).
 *
 * The file is a REVIEW GATE: eyeball it (geojson.io / QGIS) before running discovery. The prune
 * distance is buffer+cell (~4.5km), so a tile is dropped only if its center is that far from any
 * NON-open-space land — i.e. deep in a contiguous preserve. Small urban parks can never trigger
 * it, so the area floor below is about keeping the file readable, not about safety.
 *
 * Source: OpenStreetMap (ODbL). Same Overpass + osmtogeojson path as import:osm-neighborhoods.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";

const require = createRequire(import.meta.url);
// osmtogeojson ships no types; require keeps it `any` and tsc-clean.
const osmtogeojson = require("osmtogeojson") as (json: unknown) => GeoJsonFc;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_MIN_AREA_KM2 = 1;

// "Preserves + forests + water" — validated against the McDowell case. Each entry is one
// OSM key=value; discovery only ever prunes tiles deep inside a CONTIGUOUS blob of these, so
// erring broad here is safe (see header). Golf/cemetery deliberately excluded (edge venues).
const OPEN_SPACE_TAGS: [string, string][] = [
  ["leisure", "nature_reserve"],
  ["boundary", "protected_area"],
  ["leisure", "park"],
  ["landuse", "forest"],
  ["natural", "water"],
];

interface GeoJsonFeature {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
}
interface GeoJsonFc {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

interface Args {
  bbox?: string;
  minAreaKm2: number;
}

/** Derive "south,west,north,east" from data/<slug>-boundary.geojson. Every onboarded city
 * ships this file, so the fetch never needs a manual --bbox. Pure JS walk over all coords. */
function bboxFromBoundaryFile(slug: string): string | undefined {
  const path = `data/${slug}-boundary.geojson`;
  if (!existsSync(path)) return undefined;
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    features?: GeoJsonFeature[];
    geometry?: { coordinates?: unknown };
  };
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const [lng, lat] = c as [number, number];
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const x of c) walk(x);
  };
  // Accept FeatureCollection, Feature, or a bare geometry ({type,coordinates}) — the
  // boundary files in data/ are bare geometries, so fall back to the top-level coordinates.
  const feats = raw.features ?? [raw as GeoJsonFeature];
  for (const f of feats)
    walk(f.geometry?.coordinates ?? (f as { coordinates?: unknown }).coordinates);
  if (!Number.isFinite(minLat)) return undefined;
  return `${minLat},${minLng},${maxLat},${maxLng}`;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const minRaw = get("--min-area-km2");
  return {
    bbox: get("--bbox"),
    minAreaKm2: minRaw ? Number(minRaw) : DEFAULT_MIN_AREA_KM2,
  };
}

/** Best-effort human label for a polygon that has no name (unnamed reservoirs, forest tracts). */
function labelFor(props: Record<string, unknown>): string {
  const name = typeof props.name === "string" ? props.name.trim() : "";
  if (name) return name;
  for (const [k, v] of OPEN_SPACE_TAGS) {
    if (props[k] === v) return `(unnamed ${v.replace(/_/g, " ")})`;
  }
  return "(unnamed open space)";
}

async function main() {
  const args = parseArgs();
  const { slug, state } = requireCityArgs();
  if (!Number.isFinite(args.minAreaKm2) || args.minAreaKm2 < 0) {
    throw new Error(`Bad --min-area-km2 "${args.minAreaKm2}".`);
  }
  const boundaryFile = `data/${slug}-boundary.geojson`;
  if (!existsSync(boundaryFile)) {
    throw new Error(`No ${boundaryFile}; discovery clips open space to the boundary, so it is required.`);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });

  try {
    const [city] = await sql<{ bbox: string | null }[]>`
      SELECT CASE WHEN bbox IS NOT NULL THEN
               ST_YMin(bbox::geometry)::text || ',' || ST_XMin(bbox::geometry)::text || ',' ||
               ST_YMax(bbox::geometry)::text || ',' || ST_XMax(bbox::geometry)::text
             END AS bbox
      FROM cities WHERE lower(slug) = ${slug} AND lower(state) = ${state}
    `;
    if (!city) throw new Error(`No city found for --city '${slug}' --state '${state}'.`);

    const bbox = args.bbox ?? city.bbox ?? bboxFromBoundaryFile(slug);
    if (!bbox) throw new Error(`No bbox for '${slug}'; pass --bbox "south,west,north,east".`);
    const [s, w, n, e] = bbox.split(",").map((x) => Number(x.trim()));
    if ([s, w, n, e].some((x) => !Number.isFinite(x))) {
      throw new Error(`Bad bbox "${bbox}" — expected "south,west,north,east".`);
    }

    // Overpass: every open-space tag as way + relation, geometry inline.
    const clauses = OPEN_SPACE_TAGS.flatMap(([k, v]) => [
      `  way["${k}"="${v}"](${s},${w},${n},${e});`,
      `  relation["${k}"="${v}"](${s},${w},${n},${e});`,
    ]).join("\n");
    const query = `[out:json][timeout:180];\n(\n${clauses}\n);\nout geom;`;

    console.log(`Querying Overpass for ${slug} open space (${OPEN_SPACE_TAGS.length} tag sets) in [${bbox}]…`);
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "happyhourfriends/1.0 (open-space import)",
      },
      body: "data=" + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
    const fc = osmtogeojson(await res.json());

    const polys = fc.features.filter(
      (f) =>
        f.geometry &&
        (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
    );
    if (polys.length === 0) {
      console.log("No open-space polygons returned. Nothing written.");
      return;
    }

    // Clip each polygon to the boundary and keep those whose CLIPPED area clears the floor.
    // ST_MakeValid + CollectionExtract(3) guards against self-intersecting OSM ways. The
    // boundary is loaded from the same file discovery uses, so the mask lines up exactly.
    const boundaryRaw = JSON.parse(readFileSync(boundaryFile, "utf8"));
    const boundaryGeom =
      boundaryRaw.type === "FeatureCollection"
        ? boundaryRaw.features[0].geometry
        : boundaryRaw.type === "Feature"
          ? boundaryRaw.geometry
          : boundaryRaw;
    await sql`CREATE TEMP TABLE _os_bnd (g geometry)`;
    await sql`INSERT INTO _os_bnd VALUES (ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(boundaryGeom)}), 4326)))`;

    const labels = polys.map((f) => labelFor(f.properties as Record<string, unknown>));
    const geoms = polys.map((f) => JSON.stringify(f.geometry));
    const clipped = await sql<{ label: string; area_km2: number; geojson: string }[]>`
      SELECT c.label,
             ST_Area(c.g::geography) / 1e6 AS area_km2,
             ST_AsGeoJSON(c.g) AS geojson
      FROM (
        SELECT p.label,
               ST_CollectionExtract(
                 ST_MakeValid(ST_Intersection(
                   ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p.geom), 4326)),
                   b.g)),
                 3) AS g
        FROM unnest(${labels}::text[], ${geoms}::text[]) AS p(label, geom), _os_bnd b
      ) c
      WHERE NOT ST_IsEmpty(c.g)
        AND ST_Area(c.g::geography) / 1e6 >= ${args.minAreaKm2}
      ORDER BY area_km2 DESC
    `;

    if (clipped.length === 0) {
      console.log(
        `No open-space polygon inside ${slug} clears the ${args.minAreaKm2} km² floor ` +
          `(fetched ${polys.length}). Nothing written — discovery will tile normally.`,
      );
      return;
    }

    const out: GeoJsonFc = {
      type: "FeatureCollection",
      features: clipped.map((r) => ({
        type: "Feature",
        properties: {
          name: r.label,
          area_km2: Math.round(Number(r.area_km2) * 100) / 100,
          source: "OpenStreetMap (ODbL)",
        },
        geometry: JSON.parse(r.geojson),
      })),
    };
    const outFile = `data/${slug}-open-space.geojson`;
    writeFileSync(outFile, JSON.stringify(out) + "\n");

    const totalKm2 = clipped.reduce((a, r) => a + Number(r.area_km2), 0);
    console.log(
      `\nWrote ${outFile}: ${clipped.length} polygon(s), ${totalKm2.toFixed(1)} km² total (≥${args.minAreaKm2} km² each).`,
    );
    console.log("  Largest:");
    for (const r of clipped.slice(0, 8)) {
      console.log(`    ${Number(r.area_km2).toFixed(1).padStart(6)} km²  ${r.label}`);
    }
    console.log(
      `\n  REVIEW this file before running discovery. seed-discover.ts auto-detects it and\n` +
        `  subtracts it from the boundary for the tile prune only (candidate gate unchanged).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
