/**
 * Apply data/curated-venue-removals.json: soft-delete venues that should never
 * appear on the site (member-only clubs, non-venues, private event rentals).
 *
 * Keyed on google_place_id so the same curated file applies identically to any
 * environment's DB (local + prod). Soft delete (deleted_at) — never hard delete:
 * the surviving row's google_place_id unique constraint is the resurrection guard
 * against re-discovery. Also deactivates any active happy_hours on the venue so
 * nothing keeps surfacing through HH-side queries. Idempotent and re-runnable.
 *
 * Usage:  tsx scripts/remove-venues.ts [--dry-run]
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

type Removal = { googlePlaceId: string; name: string; city: string; reason: string };

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");

  const file = path.join(process.cwd(), "data", "curated-venue-removals.json");
  const { removals } = JSON.parse(readFileSync(file, "utf8")) as { removals: Removal[] };
  const byPlaceId = new Map(removals.map((r) => [r.googlePlaceId, r]));

  const sql = postgres(dbUrl, { max: 1 });
  try {
    const targets = await sql<
      { id: string; name: string; google_place_id: string; city: string; hh_active: number }[]
    >`
      SELECT v.id, v.name, v.google_place_id, c.slug AS city,
        (SELECT count(*)::int FROM happy_hours h
          WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL) AS hh_active
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      WHERE v.google_place_id = ANY(${[...byPlaceId.keys()]})
        AND v.deleted_at IS NULL
      ORDER BY c.slug, v.name
    `;

    const alreadyDone = removals.length - targets.length;
    console.log(
      `${removals.length} curated removal(s); ${targets.length} pending, ${alreadyDone} already removed/absent.`,
    );
    for (const t of targets) {
      const reason = byPlaceId.get(t.google_place_id)?.reason ?? "";
      console.log(`  - [${t.city}] ${t.name} (${t.hh_active} active HH) — ${reason}`);
    }

    if (dryRun) {
      console.log("\n--dry-run: nothing changed.");
      return;
    }
    if (targets.length === 0) return;

    const ids = targets.map((t) => t.id);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE happy_hours SET active = false, updated_at = now()
        WHERE venue_id = ANY(${ids}) AND active = true AND deleted_at IS NULL
      `;
      await tx`
        UPDATE venues SET deleted_at = now(), updated_at = now()
        WHERE id = ANY(${ids})
      `;
    });
    console.log(`\nSoft-deleted ${targets.length} venue(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
