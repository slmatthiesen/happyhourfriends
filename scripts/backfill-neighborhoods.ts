/**
 * Backfill venues.neighborhood_id by point-in-polygon (PostGIS). Standalone runner for
 * lib/geo/assignNeighborhoods — useful after geocoding venues or importing new polygons.
 * seed:enrich also runs this automatically once venues have coordinates.
 *
 * Usage:  tsx scripts/backfill-neighborhoods.ts [--city tacoma]   (omit --city = all)
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

function parseArgs(): { city: string | null } {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--city");
  return { city: i >= 0 ? argv[i + 1] : null };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const { city } = parseArgs();
  const sql = postgres(dbUrl, { max: 1 });
  try {
    let cityId: string | null = null;
    if (city) {
      const [c] = await sql<{ id: string }[]>`
        SELECT id FROM cities WHERE slug = ${city}
      `;
      if (!c) throw new Error(`City '${city}' not found — run npm run seed:cities first.`);
      cityId = c.id;
    }

    const n = await assignNeighborhoods(sql, cityId);
    console.log(`Neighborhood backfill: assigned/updated ${n} venue(s).`);
    if (n === 0) {
      console.log(
        "(0 is expected until venues have lat/lng — geocoding happens in seed:enrich.)",
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
