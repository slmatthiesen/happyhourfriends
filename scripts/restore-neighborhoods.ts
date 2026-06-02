/**
 * Revert neighborhoods + venue assignments to the last snapshot taken before a bulk
 * OSM re-import. Restores from the `nb_snapshot` / `venue_nb_snapshot` tables.
 *
 *   npm run restore:neighborhoods
 *
 * Order matters (FK venues.neighborhood_id -> neighborhoods.id):
 *   1. restore venue->neighborhood assignments (so no venue points at a row we're about to delete)
 *   2. restore mutated neighborhood rows (recognizability/tier/is_fallback/etc.)
 *   3. delete neighborhood rows inserted after the snapshot
 * Safe to re-run. Does nothing useful if no snapshot tables exist (errors clearly).
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  try {
    const [snap] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.nb_snapshot') IS NOT NULL
         AND to_regclass('public.venue_nb_snapshot') IS NOT NULL AS exists`;
    if (!snap.exists) {
      throw new Error(
        "No snapshot found (nb_snapshot / venue_nb_snapshot missing). Nothing to restore.",
      );
    }

    const assignments = await sql`
      UPDATE venues v
      SET neighborhood_id = s.neighborhood_id, updated_at = now()
      FROM venue_nb_snapshot s
      WHERE v.id = s.id AND v.neighborhood_id IS DISTINCT FROM s.neighborhood_id
      RETURNING v.id`;

    const restored = await sql`
      UPDATE neighborhoods n
      SET name = s.name, slug = s.slug, polygon = s.polygon, source = s.source,
          source_url = s.source_url, is_fallback = s.is_fallback, in_scope = s.in_scope,
          tier = s.tier, recognizability = s.recognizability, parent_id = s.parent_id,
          updated_at = s.updated_at
      FROM nb_snapshot s
      WHERE n.id = s.id
        AND (n.tier, n.recognizability, n.is_fallback, n.name, n.slug)
            IS DISTINCT FROM (s.tier, s.recognizability, s.is_fallback, s.name, s.slug)
      RETURNING n.id`;

    // Clear any venue assignment that points at a neighborhood inserted AFTER the snapshot
    // (e.g. a venue seeded/assigned during the window we're reverting). Step 1 only restores
    // venues present in the snapshot; this guards the FK so the DELETE below can't violate it.
    // Such venues are left unassigned — re-run assignment afterwards if needed.
    const orphaned = await sql`
      UPDATE venues SET neighborhood_id = NULL, updated_at = now()
      WHERE neighborhood_id IS NOT NULL
        AND neighborhood_id NOT IN (SELECT id FROM nb_snapshot)
      RETURNING id`;

    const deleted = await sql`
      DELETE FROM neighborhoods
      WHERE id NOT IN (SELECT id FROM nb_snapshot)
      RETURNING id`;

    console.log(
      `Restored: ${assignments.length} venue assignments reverted, ` +
        `${restored.length} neighborhood rows reverted, ${orphaned.length} post-snapshot ` +
        `assignments cleared, ${deleted.length} inserted rows deleted.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
