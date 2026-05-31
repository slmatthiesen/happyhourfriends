/**
 * Municipal-boundary scope gate (operator rule 2026-05-31): a city's venue set should be
 * bounded by its actual municipal boundary, not by mailing-address city + a radius. Google's
 * mailing city is unreliable at borders (Mountain Shadows mails as "Scottsdale" though it's in
 * Paradise Valley; Kierland mails as "Scottsdale" though it's Phoenix), so discovery accreted
 * cross-jurisdiction venues. This gate scopes by point-in-boundary + a small tolerance buffer.
 *
 *   npm run scope:venues -- --city scottsdale                 # report in/out of scope
 *   npm run scope:venues -- --city scottsdale --list          # + list the out-of-scope venues
 *   npm run scope:venues -- --city scottsdale --prune         # soft-delete out-of-scope (BY ID)
 *   npm run scope:venues -- --city scottsdale --buffer 500 --boundary data/scottsdale-boundary.geojson
 *
 * In scope = inside the boundary OR within --buffer meters of it (default 500m). The buffer
 * keeps geocode/precision edge cases and immediately-adjacent destinations that read as part
 * of the city (e.g. Kierland Commons, ~300m outside Scottsdale's line) while rejecting venues
 * deep in another jurisdiction (Mountain Shadows ~3km, Salt River ~2km). Standard onboarding
 * step: run after seed:discover/seed:enrich, before launch. --prune is reversible (soft-delete,
 * keyed on venue id — never name; chains share names) so venues re-home by flipping city_id.
 *
 * NOTE: this gate does NOT exclude resort/casino venues inside the boundary — that's a
 * separate, non-type-detectable problem (see memory). It only enforces jurisdiction.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import postgres from "postgres";

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const city = get("--city");
  if (!city) {
    throw new Error(
      "Required: --city <slug> [--boundary <geojson>] [--buffer m] [--list] [--prune]",
    );
  }
  return {
    city,
    boundary: get("--boundary") ?? `data/${city}-boundary.geojson`,
    buffer: Number(get("--buffer") ?? 500),
    list: argv.includes("--list"),
    prune: argv.includes("--prune"),
  };
}

async function main() {
  const args = parseArgs();
  if (!Number.isFinite(args.buffer) || args.buffer < 0) {
    throw new Error(`Bad --buffer "${args.buffer}"`);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });

  try {
    const [city] = await sql<{ id: string }[]>`SELECT id FROM cities WHERE slug = ${args.city}`;
    if (!city) throw new Error(`City '${args.city}' not found.`);

    const raw = JSON.parse(readFileSync(args.boundary, "utf8"));
    const features: { geometry: unknown }[] =
      raw.type === "FeatureCollection" ? raw.features : [raw];
    const geoms = features.map((f) => JSON.stringify(f.geometry));
    if (!geoms.length) throw new Error(`No features in ${args.boundary}`);

    // Boundary as one geography, built inline from the feature geometries (no temp table).
    // A venue is OUT of scope when it is NOT within `buffer` meters of the boundary.
    const point = sql`ST_SetSRID(ST_MakePoint(v.lng::float8, v.lat::float8), 4326)::geography`;
    const boundary = sql`(
      SELECT ST_Collect(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)))::geography AS geom
      FROM unnest(${geoms}::text[]) AS g
    )`;

    const rows = await sql<
      { id: string; name: string; lat: string; lng: string; m: number }[]
    >`
      WITH b AS ${boundary}
      SELECT v.id, v.name, v.lat::text, v.lng::text,
             round(ST_Distance(b.geom, ${point})::numeric, 0)::int AS m
      FROM venues v, b
      WHERE v.city_id = ${city.id}
        AND v.deleted_at IS NULL
        AND v.lat IS NOT NULL AND v.lng IS NOT NULL
        AND NOT ST_DWithin(b.geom, ${point}, ${args.buffer})
      ORDER BY m DESC
    `;

    const [tot] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM venues
      WHERE city_id = ${city.id} AND deleted_at IS NULL AND lat IS NOT NULL
    `;
    const active = tot?.n ?? 0;
    console.log(
      `\n${args.city}: ${active} active geocoded venues — ` +
        `${active - rows.length} in scope, ${rows.length} OUT of scope ` +
        `(boundary + ${args.buffer}m buffer).`,
    );

    if (args.list || (rows.length && !args.prune)) {
      for (const r of rows) console.log(`  ${r.name} — ${r.lat},${r.lng}  (${r.m}m outside)`);
    }

    if (args.prune && rows.length) {
      const ids = rows.map((r) => r.id);
      const pruned = await sql<{ id: string }[]>`
        UPDATE venues SET deleted_at = now(), updated_at = now()
        WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
        RETURNING id
      `;
      console.log(`\nPruned (soft-deleted) ${pruned.length} out-of-scope venue(s) by id. Reversible.`);
    } else if (args.prune) {
      console.log("\nNothing to prune.");
    }

    process.exit(rows.length && !args.prune ? 1 : 0);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
