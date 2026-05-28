/**
 * Prune venues with no happy hours for a city. The directory is a happy-hour directory:
 * a venue with zero active happy_hours is noise (an empty stub), so we hard-delete it
 * along with its tags. This both cleans up legacy stubs from early enrich runs and
 * enforces the "only list venues that actually have a happy hour" rule.
 *
 * Re-runnable and city-scoped. Decouples seed_candidates first (FK), then deletes
 * offerings → happy_hours (none, by definition) → venue_tags → venues.
 *
 * Usage:  tsx scripts/prune-empty-venues.ts --city tacoma [--dry-run]
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import postgres from "postgres";

function parseArgs() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--city");
  return { city: i >= 0 ? argv[i + 1] : "tacoma", dryRun: argv.includes("--dry-run") };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const { city: citySlug, dryRun } = parseArgs();
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const [city] = await sql<{ id: string }[]>`SELECT id FROM cities WHERE slug = ${citySlug}`;
    if (!city) throw new Error(`City '${citySlug}' not found.`);

    // Venues with no active, non-deleted happy hours.
    const empties = await sql<{ id: string; name: string }[]>`
      SELECT v.id, v.name
      FROM venues v
      WHERE v.city_id = ${city.id}
        AND v.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h
          WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
        )
      ORDER BY v.name
    `;

    console.log(`${empties.length} venue(s) with no happy hours in '${citySlug}':`);
    for (const v of empties) console.log(`  - ${v.name}`);

    if (dryRun) {
      console.log("\n--dry-run: nothing deleted.");
      return;
    }
    if (empties.length === 0) return;

    const ids = empties.map((v) => v.id);
    const deleted = await sql.begin(async (tx) => {
      await tx`UPDATE seed_candidates SET resulting_venue_id = NULL WHERE resulting_venue_id = ANY(${ids})`;
      // Offerings hang off happy_hours; an empty venue has none, but a soft-deleted HH
      // could still carry offerings — clean defensively.
      await tx`DELETE FROM offerings WHERE happy_hour_id IN (SELECT id FROM happy_hours WHERE venue_id = ANY(${ids}))`;
      await tx`DELETE FROM happy_hours WHERE venue_id = ANY(${ids})`;
      await tx`DELETE FROM venue_tags WHERE venue_id = ANY(${ids})`;
      const v = await tx`DELETE FROM venues WHERE id = ANY(${ids})`;
      return v.count;
    });

    console.log(`\nDeleted ${deleted} empty venue(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
