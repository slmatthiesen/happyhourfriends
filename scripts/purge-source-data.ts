/**
 * Find and delete ALL data sourced from competitor happy-hour aggregators (the stale
 * "ultimate happy hours" / seattletravel editorial data). Scans happy_hours AND
 * offerings by source_url, deletes the offending rows and any venue left with zero
 * happy hours as a result. Reports exactly what it found. Idempotent.
 *
 * Usage:  tsx scripts/purge-source-data.ts --city tacoma --state wa
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const PATTERNS = ["%ultimatehappyhours%", "%seattletravel%"];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error("ERROR: DATABASE_URL not set."); process.exit(1); }
  const { slug, state } = requireCityArgs();
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const city = await resolveCity(sql, slug, state);

    const like = (col: string) =>
      sql.unsafe(PATTERNS.map((p) => `${col} ILIKE '${p}'`).join(" OR "));

    // What's there now?
    const hhHits = await sql<{ id: string; venue: string; src: string }[]>`
      SELECT h.id, v.name AS venue, h.source_url AS src
      FROM happy_hours h JOIN venues v ON v.id = h.venue_id
      WHERE v.city_id = ${city.id} AND (${like("h.source_url")})`;
    const offHits = await sql<{ id: string }[]>`
      SELECT o.id FROM offerings o
      JOIN happy_hours h ON h.id = o.happy_hour_id
      JOIN venues v ON v.id = h.venue_id
      WHERE v.city_id = ${city.id} AND (${like("o.source_url")})`;

    console.log(`Aggregator-sourced happy_hours: ${hhHits.length}`);
    console.log(`Aggregator-sourced offerings:   ${offHits.length}`);
    for (const h of hhHits) console.log(`  - ${h.venue} :: ${h.src}`);

    if (hhHits.length === 0 && offHits.length === 0) {
      console.log("\n✓ No ultimatehappyhours/seattletravel data present. Clean.");
      return;
    }

    const deleted = await sql.begin(async (tx) => {
      const hhIds = hhHits.map((h) => h.id);
      await tx`DELETE FROM offerings WHERE happy_hour_id = ANY(${hhIds}) OR (${like("source_url")})`;
      await tx`DELETE FROM happy_hours WHERE id = ANY(${hhIds})`;
      // Venues now empty as a result → drop them too (decouple candidates first).
      const empties = await tx<{ id: string }[]>`
        SELECT v.id FROM venues v
        WHERE v.city_id = ${city.id} AND v.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM happy_hours h WHERE h.venue_id = v.id AND h.deleted_at IS NULL)`;
      const eids = empties.map((e) => e.id);
      if (eids.length) {
        await tx`UPDATE seed_candidates SET resulting_venue_id = NULL WHERE resulting_venue_id = ANY(${eids})`;
        await tx`DELETE FROM venue_tags WHERE venue_id = ANY(${eids})`;
        await tx`DELETE FROM venues WHERE id = ANY(${eids})`;
      }
      return { hh: hhIds.length, venues: eids.length };
    });
    console.log(`\nDeleted ${deleted.hh} happy_hours and ${deleted.venues} now-empty venue(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
