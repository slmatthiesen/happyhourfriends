/**
 * Backfill venues.timezone from the venue's city default_timezone. The seed loader
 * historically omitted this column, leaving venues with a null tz — which silently
 * disabled "happening now" and the live "Now" badge (both bail when tz is null).
 *
 * Only fills NULLs; venues with an explicit tz (e.g. enriched) are left untouched.
 *
 * Usage:  tsx scripts/backfill-timezones.ts [--city tacoma --state wa]   (omit --city = all)
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const hasCityFlag = process.argv.includes("--city");
  const sql = postgres(dbUrl, { max: 1 });
  try {
    let cityId: string | null = null;
    if (hasCityFlag) {
      const { slug, state } = requireCityArgs();
      const city = await resolveCity(sql, slug, state);
      cityId = city.id;
    }

    const updated = await sql<{ id: string }[]>`
      UPDATE venues v
      SET timezone = c.default_timezone
      FROM cities c
      WHERE v.city_id = c.id
        AND v.timezone IS NULL
        AND ${cityId == null ? sql`true` : sql`v.city_id = ${cityId}`}
      RETURNING v.id
    `;
    console.log(`Timezone backfill: set ${updated.length} venue(s) from city default.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
