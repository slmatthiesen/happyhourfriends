/**
 * cleanup-duplicate-windows — retire stale BARE happy-hour windows that a venue's richer
 * windows already cover, across an existing city. The same decision persist now runs
 * automatically (lib/recover/supersedeBareWindows.planBareSupersedes); this applies it
 * retroactively to data written before that fix.
 *
 * $0. Soft-deletes only (active=false + deleted_at) and only BARE windows (0 offerings),
 * only when fully covered by a deal-carrying window or a redundant specific-area copy of a
 * bare 'all' window. Never touches a window that carries offerings — good data is never lost.
 *
 * Usage:
 *   tsx scripts/cleanup-duplicate-windows.ts --city santa-barbara --state ca            # $0 dry-run
 *   tsx scripts/cleanup-duplicate-windows.ts --city santa-barbara --state ca --apply    # soft-delete
 */
import "dotenv/config";
import postgres from "postgres";
import { planBareSupersedes, type SupersedeWindow } from "@/lib/recover/supersedeBareWindows";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

type Row = {
  id: string;
  days: number[];
  start: string | null;
  end: string | null;
  all_day: boolean;
  loc: string | null;
  offs: number;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const city = await resolveCity(sql, slug, state);

    // Venues with ≥2 active windows are the only ones that can have a redundant window.
    const venues = await sql<{ id: string; name: string }[]>`
      SELECT v.id, v.name
      FROM venues v
      WHERE v.city_id = ${city.id} AND v.status = 'active' AND v.deleted_at IS NULL
        AND (SELECT COUNT(*) FROM happy_hours h
               WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL) >= 2
      ORDER BY v.name
    `;

    let venuesAffected = 0;
    let retiredTotal = 0;
    for (const v of venues) {
      const rows = await sql<Row[]>`
        SELECT h.id, h.days_of_week AS days, h.start_time::text AS start, h.end_time::text AS "end",
               h.all_day, h.location_within_venue::text AS loc,
               (SELECT COUNT(*) FROM offerings o
                  WHERE o.happy_hour_id = h.id AND o.active = true AND o.deleted_at IS NULL)::int AS offs
          FROM happy_hours h
         WHERE h.venue_id = ${v.id} AND h.active = true AND h.deleted_at IS NULL
      `;
      const windows: SupersedeWindow[] = rows.map((r) => ({
        id: r.id, daysOfWeek: r.days, startTime: r.start, endTime: r.end,
        allDay: r.all_day, location: r.loc, offeringCount: r.offs,
      }));
      const retire = planBareSupersedes(windows);
      if (retire.size === 0) continue;
      venuesAffected++;
      retiredTotal += retire.size;
      console.log(`\n${v.name}`);
      for (const r of rows) {
        if (!retire.has(r.id)) continue;
        console.log(`  retire  days=${JSON.stringify(r.days)} ${r.start ?? "—"}-${r.end ?? "—"} loc=${r.loc} (bare)`);
      }
      if (apply) {
        await sql`
          UPDATE happy_hours SET active = false, deleted_at = now(), updated_at = now()
          WHERE id IN ${sql([...retire])}`;
      }
    }

    console.log(`\n── ${apply ? "APPLIED" : "DRY RUN"} ─────────────────────────────────────────`);
    console.log(`  ${venuesAffected} venue(s), ${retiredTotal} redundant bare window(s) ${apply ? "retired" : "to retire"}.`);
    if (!apply && retiredTotal > 0) console.log(`  Re-run with --apply to soft-delete them ($0, reversible).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
