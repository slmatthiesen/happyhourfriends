/**
 * Prepare a city for a fresh first-party re-source:
 *  1. DELETE venues whose happy_hours cite a competitor happy-hour aggregator
 *     (ultimatehappyhours / seattletravel / etc.) — stale + off-brand source.
 *  2. Re-arm candidates: any seed_candidate not currently linked to a surviving venue
 *     gets processed_at=null so the next `seed:enrich` reprocesses it with the current
 *     (higher-recall, first-party-only) extractor. Candidates still linked to a
 *     surviving (good, first-party) venue are left alone — enrich skips them.
 *
 * Re-runnable, city-scoped. Usage:  tsx scripts/reset-for-resource.ts --city tacoma --state wa
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const AGGREGATOR_LIKE = ["%ultimatehappyhours%", "%seattletravel%", "%happyhour%", "%groupon%"];

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

    // 1. Venues with any aggregator-sourced happy hour.
    const editorial = await sql<{ id: string; name: string }[]>`
      SELECT DISTINCT v.id, v.name
      FROM venues v
      JOIN happy_hours h ON h.venue_id = v.id
      WHERE v.city_id = ${city.id}
        AND v.deleted_at IS NULL
        AND (${sql.unsafe(
          AGGREGATOR_LIKE.map((p) => `h.source_url ILIKE '${p.replace(/'/g, "''")}'`).join(" OR "),
        )})
      ORDER BY v.name
    `;

    console.log(`Aggregator-sourced venues to delete: ${editorial.length}`);
    for (const v of editorial) console.log(`  - ${v.name}`);

    const ids = editorial.map((v) => v.id);
    const result = await sql.begin(async (tx) => {
      if (ids.length > 0) {
        await tx`UPDATE seed_candidates SET resulting_venue_id = NULL WHERE resulting_venue_id = ANY(${ids})`;
        await tx`DELETE FROM offerings WHERE happy_hour_id IN (SELECT id FROM happy_hours WHERE venue_id = ANY(${ids}))`;
        await tx`DELETE FROM happy_hours WHERE venue_id = ANY(${ids})`;
        await tx`DELETE FROM venue_tags WHERE venue_id = ANY(${ids})`;
        await tx`DELETE FROM venues WHERE id = ANY(${ids})`;
      }
      // 2. Re-arm every candidate not tied to a surviving venue.
      const rearmed = await tx`
        UPDATE seed_candidates
        SET processed_at = NULL, outcome = NULL, updated_at = now()
        WHERE city_id = ${city.id} AND resulting_venue_id IS NULL
      `;
      return rearmed.count;
    });

    console.log(`\nDeleted ${ids.length} venue(s); re-armed ${result} candidate(s) for re-source.`);
    console.log("Next: npx tsx scripts/seed-enrich-candidates.ts");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
