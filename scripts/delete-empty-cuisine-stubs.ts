/**
 * Soft-delete the lowest-converting empty-cuisine stubs (Cleanup, runs AFTER Build A + Build B).
 *
 * After anti-bot recovery (Build B) has had its shot, korean/vietnamese/chinese venues
 * (ZERO_HH_TYPES, lib/places/stubGate) that STILL have no active happy hour are genuine dead
 * weight — cross-city confirmed-HH rate at-or-near zero. Soft-delete them (deleted_at): the
 * google_place_id row stays as the re-discovery guard so they don't resurrect, any active HH is
 * deactivated, and a later VERIFIED HH submission un-deletes one via the apply engine.
 *
 * Distinct from Build A's HIDE: Build A reversibly hides a broad net (no-alcohol + zero-HH
 * cuisine) from the PUBLIC list; this DELETES (gone everywhere) only the 3 lowest-converting
 * cuisines. Run order: regate → Build B recovery → this.
 *
 *   Dry-run (default — by-type report, no writes):
 *     pnpm delete:empty-cuisine-stubs [--city <slug> --state <code>]
 *   Apply:
 *     pnpm delete:empty-cuisine-stubs --apply [--city <slug> --state <code>]
 *
 * Requires DATABASE_URL only. Idempotent + re-runnable. All-cities when --city is omitted.
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { ZERO_HH_TYPES } from "@/lib/places/stubGate";

interface Row {
  id: string;
  name: string;
  city: string;
  primary_type: string | null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const cityArgs = args.includes("--city") ? requireCityArgs() : null;

  const sql = postgres(dbUrl, { max: 1 });
  try {
    const zeroTypes = [...ZERO_HH_TYPES];
    // Non-deleted venues whose discovery primary_type is a zero-HH cuisine and that have NO live
    // happy hour. Includes status='no_happy_hour' rows (Build A may already have hidden them) and
    // 'active' — both are deleted here. The primary_type comes from the candidate.
    const rows = await sql<Row[]>`
      SELECT v.id, v.name, c.slug AS city, sc.primary_type
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      JOIN seed_candidates sc ON sc.google_place_id = v.google_place_id
      WHERE v.deleted_at IS NULL
        AND sc.primary_type = ANY(${zeroTypes})
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h
          WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND lower(c.slug) = ${cityArgs.slug} AND lower(c.state) = ${cityArgs.state}` : sql``}
      ORDER BY c.slug, v.name
    `;

    const scope = cityArgs ? `${cityArgs.slug}, ${cityArgs.state}` : "all cities";
    console.log(`${rows.length} empty zero-HH-cuisine stub(s) to soft-delete in ${scope}:\n`);
    const byType = new Map<string, number>();
    for (const t of rows) byType.set(t.primary_type ?? "?", (byType.get(t.primary_type ?? "?") ?? 0) + 1);
    for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${type}`);
    }

    if (!apply) {
      console.log(`\n(dry-run) nothing changed. Re-run with --apply to soft-delete these ${rows.length}.`);
      return;
    }
    if (rows.length === 0) return;

    const ids = rows.map((t) => t.id);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE happy_hours SET active = false, updated_at = now()
        WHERE venue_id = ANY(${ids}) AND active = true AND deleted_at IS NULL
      `;
      await tx`UPDATE venues SET deleted_at = now(), updated_at = now() WHERE id = ANY(${ids})`;
      for (const t of rows) {
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('venues', ${t.id}, ${tx.json({ deletedAt: null })}, ${tx.json({ deletedAt: "now" })},
                  'script', ${`empty zero-HH-cuisine stub deleted (type=${t.primary_type ?? "?"})`})
        `;
      }
    });
    console.log(`\nSoft-deleted ${rows.length} empty zero-HH-cuisine stub(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
