/**
 * Source-agnostic neighborhood importer: GeoJSON → PostGIS.
 *
 *   tsx scripts/import-neighborhoods.ts \
 *     --city tacoma \
 *     --geojson ./data/tacoma-council-districts.geojson \
 *     --name-prop NAME \
 *     [--slug-prop NAME] \
 *     [--source "City of Tacoma GIS — Neighborhood Council Districts"] \
 *     [--source-url https://...] \
 *     [--fallback]   # coarse gap-filler layer (e.g. council wards); ranked below
 *                    # precise neighborhoods, used only where none is within snap range
 *
 * Works for any city + any GeoJSON (OSM/Overture/ArcGIS exports), so the same
 * command onboards city #2..N. The city row must already exist in `cities`.
 * Idempotent: upserts on (city_id, slug). Re-runs the §3.7 venue→neighborhood
 * backfill for the city after import.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

interface Args {
  city: string;
  geojson: string;
  nameProp: string;
  slugProp?: string;
  source?: string;
  sourceUrl?: string;
  fallback: boolean;
}

interface GeoJsonFeature {
  properties?: Record<string, string>;
  geometry: unknown;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const city = get("--city");
  const geojson = get("--geojson");
  const nameProp = get("--name-prop") ?? "name";
  if (!city || !geojson) {
    throw new Error("Required: --city <slug> --geojson <path> [--name-prop <prop>]");
  }
  return {
    city,
    geojson,
    nameProp,
    slugProp: get("--slug-prop"),
    source: get("--source"),
    sourceUrl: get("--source-url"),
    fallback: argv.includes("--fallback"),
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
    const [city] = await sql<{ id: string }[]>`
      SELECT id FROM cities WHERE slug = ${args.city}
    `;
    if (!city) {
      throw new Error(
        `City '${args.city}' not found — insert it into cities before importing neighborhoods.`,
      );
    }

    const raw = JSON.parse(readFileSync(args.geojson, "utf8"));
    const features: GeoJsonFeature[] =
      raw.type === "FeatureCollection" ? raw.features : [raw];

    let inserted = 0;
    for (const feature of features) {
      const props = feature.properties ?? {};
      const name = props[args.nameProp];
      if (!name) {
        console.warn(`  skip: feature has no "${args.nameProp}" property`);
        continue;
      }
      const slug = slugify(args.slugProp ? props[args.slugProp] : name);
      const geomJson = JSON.stringify(feature.geometry);

      await sql`
        INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback)
        VALUES (
          ${city.id}, ${name}, ${slug},
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)),
          ${args.source ?? null}, ${args.sourceUrl ?? null}, ${args.fallback}
        )
        ON CONFLICT (city_id, slug) DO UPDATE SET
          name = EXCLUDED.name,
          polygon = EXCLUDED.polygon,
          source = EXCLUDED.source,
          source_url = EXCLUDED.source_url,
          is_fallback = EXCLUDED.is_fallback,
          updated_at = now()
      `;
      inserted++;
    }

    // §3.7 backfill: assign each venue to its most-specific neighborhood. Use the
    // canonical assignNeighborhoods (ST_DWithin 100m snap + distance/most-specific
    // ranking) — NOT a strict ST_Contains — so venues just outside a polygon edge
    // still attach to the nearest one, consistent with `npm run backfill:neighborhoods`.
    const reassigned = await assignNeighborhoods(sql, city.id);

    console.log(
      `Imported/updated ${inserted} neighborhoods for '${args.city}' and reassigned ${reassigned} venue(s).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
