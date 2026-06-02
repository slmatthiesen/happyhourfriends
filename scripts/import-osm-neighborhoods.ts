/**
 * OSM neighborhood importer: OpenStreetMap `place` polygons → PostGIS `neighborhoods`.
 *
 *   npm run import:osm-neighborhoods -- --city phoenix-central
 *   npm run import:osm-neighborhoods -- --city tucson --bbox 31.9,-111.2,32.4,-110.7
 *   npm run import:osm-neighborhoods -- --city phoenix-central --fallback
 *
 * OSM carries the vernacular / "what locals and Redfin call it" neighborhood names
 * (Arcadia, Biltmore, Sam Hughes) that administrative layers (urban villages, council
 * wards) and residential-association layers miss. This is the PRIMARY neighborhood
 * source going forward; other layers (Zillow, Census CDPs, official GIS) fill gaps.
 *
 * Queries the Overpass API for `place=neighbourhood|suburb|quarter` areas within the
 * city's bbox (read from cities.bbox, or pass --bbox "south,west,north,east"), converts
 * to GeoJSON with osmtogeojson (handles multipolygon relations), and INSERTS each named
 * polygon that doesn't already exist for the city (slug not taken — never clobbers an
 * existing neighborhood from another source). Then re-runs the §3.7 venue→neighborhood
 * assignment. Idempotent: re-runs skip slugs already present.
 *
 * Default is_fallback = false (primary). Pass --fallback to layer OSM under an existing
 * primary set instead.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";
import {
  tierForPlace,
  recognizabilityScore,
} from "@/lib/geo/recognizability";

const require = createRequire(import.meta.url);
// osmtogeojson ships no types; require keeps it `any` and tsc-clean.
const osmtogeojson = require("osmtogeojson") as (json: unknown) => GeoJsonFc;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_PLACE_TYPES = ["neighbourhood", "suburb", "quarter"];

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
  city: string;
  bbox?: string;
  fallback: boolean;
  placeTypes: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const city = get("--city");
  if (!city) throw new Error("Required: --city <slug> [--bbox s,w,n,e] [--fallback]");
  const pt = get("--place-types");
  return {
    city,
    bbox: get("--bbox"),
    fallback: argv.includes("--fallback"),
    placeTypes: pt ? pt.split(",").map((s) => s.trim()) : DEFAULT_PLACE_TYPES,
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const args = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });

  try {
    const [city] = await sql<{ id: string; bbox: string | null }[]>`
      SELECT id,
             CASE WHEN bbox IS NOT NULL THEN
               ST_YMin(bbox::geometry)::text || ',' || ST_XMin(bbox::geometry)::text || ',' ||
               ST_YMax(bbox::geometry)::text || ',' || ST_XMax(bbox::geometry)::text
             END AS bbox
      FROM cities WHERE slug = ${args.city}
    `;
    if (!city) throw new Error(`City '${args.city}' not found.`);

    const bbox = args.bbox ?? city.bbox;
    if (!bbox) {
      throw new Error(
        `No bbox for '${args.city}' (cities.bbox is null). Pass --bbox "south,west,north,east".`,
      );
    }
    const [s, w, n, e] = bbox.split(",").map((x) => Number(x.trim()));
    if ([s, w, n, e].some((x) => !Number.isFinite(x))) {
      throw new Error(`Bad bbox "${bbox}" — expected "south,west,north,east".`);
    }

    const filter = args.placeTypes.join("|");
    const query = `[out:json][timeout:180];
(
  way["place"~"^(${filter})$"]["name"](${s},${w},${n},${e});
  relation["place"~"^(${filter})$"]["name"](${s},${w},${n},${e});
);
out geom;`;

    console.log(`Querying Overpass for ${args.city} place=${filter} in [${bbox}]…`);
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "happyhourfriends/1.0 (neighborhood import)",
      },
      body: "data=" + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
    const overpass = await res.json();
    const fc = osmtogeojson(overpass);

    // Existing slugs for this city — never clobber another source's neighborhood.
    const existing = await sql<{ slug: string }[]>`
      SELECT slug FROM neighborhoods WHERE city_id = ${city.id}
    `;
    const taken = new Set(existing.map((r) => r.slug));

    // OSM `place=neighbourhood` is polluted with apartment complexes / condos /
    // subdivisions ("Wispering Firs Condomiums"). Keep only REAL neighborhoods:
    // OSM-presence IS the recognizability signal — any non-junk named polygon whose
    // `place` is suburb/neighbourhood/quarter qualifies. Wikidata/wikipedia raise the
    // recognizability score to 2 but are NOT required; real barrios (Sam Hughes,
    // Armory Park) map in OSM without wikidata.
    // Global junk-name regex catches apartment complexes / mobile estates / subdivisions.
    const JUNK =
      /\b(apartments?|apts?|condo\w*|condomin\w*|townhom\w*|mobile|rv\s*park|trailer|villas?|subdivision|estates?)\b/i;
    const isReal = (p: Record<string, unknown>): boolean => {
      const place = String(p.place ?? "");
      const name = String(p.name ?? "");
      if (JUNK.test(name)) return false;
      return place === "suburb" || place === "neighbourhood" || place === "quarter";
    };
    const polys = fc.features.filter(
      (f) =>
        f.geometry &&
        (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") &&
        typeof f.properties?.name === "string" &&
        (f.properties.name as string).trim().length > 0 &&
        isReal(f.properties as Record<string, unknown>),
    );

    let inserted = 0;
    let promoted = 0;
    let failed = 0;
    const seen = new Set<string>();
    for (const f of polys) {
      const name = (f.properties!.name as string).trim();
      const slug = slugify(name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      // A slug already present for this city is an existing row from another source (e.g.
      // a demoted Neighborhood-Association polygon). We DON'T skip it — we let it flow into
      // the INSERT ... ON CONFLICT DO UPDATE below, which PROMOTES that row's recognizability
      // (keeping its geometry/name/source). OSM-presence is the recognizability signal: a name
      // OSM maps gets promoted; one it doesn't (e.g. Limberlost) stays shadowed.
      const isExisting = taken.has(slug);
      const geomJson = JSON.stringify(f.geometry);
      const props = f.properties as Record<string, unknown>;
      const tier = tierForPlace(props.place as string | undefined);
      const recognizability = recognizabilityScore({
        place: props.place as string | undefined,
        wikidata: props.wikidata as string | undefined,
        wikipedia: props.wikipedia as string | undefined,
      });
      try {
        await sql`
          INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability)
          VALUES (
            ${city.id}, ${name}, ${slug},
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)), 3)),
            'OpenStreetMap (ODbL)', 'https://www.openstreetmap.org/', ${args.fallback}, ${tier}, ${recognizability}
          )
          ON CONFLICT (city_id, slug) DO UPDATE
          SET recognizability = GREATEST(neighborhoods.recognizability, EXCLUDED.recognizability),
              tier = CASE WHEN EXCLUDED.recognizability > neighborhoods.recognizability
                          THEN EXCLUDED.tier ELSE neighborhoods.tier END,
              is_fallback = CASE WHEN EXCLUDED.recognizability > neighborhoods.recognizability
                                 THEN false ELSE neighborhoods.is_fallback END
        `;
        if (isExisting) promoted++;
        else inserted++;
      } catch (err) {
        failed++;
        console.warn(`  skip "${name}": ${(err as Error).message}`);
      }
    }

    const reassigned = await assignNeighborhoods(sql, city.id);
    console.log(
      `OSM neighborhoods for '${args.city}': ${polys.length} polygons found, ` +
        `${inserted} inserted, ${promoted} promoted (recognizability bumped), ${failed} failed. ` +
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
