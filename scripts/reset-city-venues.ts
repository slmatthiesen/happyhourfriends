/**
 * Wipe all venue data for one city (venues + happy_hours + offerings + venue_tags) so
 * a seed can be reloaded cleanly. The JSON loader is insert-only, so editing the seed
 * after a prior load layers new rows on top of stale ones — this gives a clean slate.
 *
 * DESTRUCTIVE but city-scoped and only touches seed-derived/derived data. It decouples
 * any seed_candidates pointing at the deleted venues first (FK safety). Use before
 * re-running seed:venues. Also handy for the new-city automation (idempotent reseed).
 *
 * Usage:  tsx scripts/reset-city-venues.ts --city tacoma --state wa
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
  const { slug, state } = requireCityArgs();
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const city = await resolveCity(sql, slug, state);

    const result = await sql.begin(async (tx) => {
      // Decouple seed_candidates so the venue delete can't hit an FK.
      await tx`
        UPDATE seed_candidates
        SET resulting_venue_id = NULL
        WHERE resulting_venue_id IN (SELECT id FROM venues WHERE city_id = ${city.id})
      `;
      const off = await tx`
        DELETE FROM offerings WHERE happy_hour_id IN (
          SELECT id FROM happy_hours WHERE venue_id IN (
            SELECT id FROM venues WHERE city_id = ${city.id}
          )
        )
      `;
      const hh = await tx`
        DELETE FROM happy_hours WHERE venue_id IN (
          SELECT id FROM venues WHERE city_id = ${city.id}
        )
      `;
      const vt = await tx`
        DELETE FROM venue_tags WHERE venue_id IN (
          SELECT id FROM venues WHERE city_id = ${city.id}
        )
      `;
      const v = await tx`DELETE FROM venues WHERE city_id = ${city.id}`;
      return {
        offerings: off.count,
        happyHours: hh.count,
        venueTags: vt.count,
        venues: v.count,
      };
    });

    console.log(`\n── Reset complete for '${city.slug}' ─────────────────────`);
    console.log(`  venues deleted:      ${result.venues}`);
    console.log(`  happy_hours deleted: ${result.happyHours}`);
    console.log(`  offerings deleted:   ${result.offerings}`);
    console.log(`  venue_tags deleted:  ${result.venueTags}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
