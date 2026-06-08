/**
 * Re-apply the deterministic window-reconcile gate to EXISTING happy_hours rows.
 *   pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa            (dry-run report)
 *   pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa --apply    (write changes)
 *
 * Merges exact-duplicate windows (keeps one, unions days, soft-deletes the rest), and
 * flips active=false on operating-hours / overlap-conflict windows. NEVER hard-deletes.
 * See docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md.
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { reconcileWindows, type ReconcileWindow } from "@/lib/places/windowReconcile";
import type { OpenPeriod } from "@/lib/geo/timezone";

const apply = process.argv.includes("--apply");

async function main() {
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [city] = await sql<{ id: string }[]>`
      SELECT id FROM cities WHERE slug = ${slug} AND lower(state) = lower(${state}) LIMIT 1`;
    if (!city) throw new Error(`No city for --city ${slug} --state ${state}`);

    const venues = await sql<{ id: string; name: string; hours_json: OpenPeriod[] | null }[]>`
      SELECT v.id, v.name, v.hours_json
      FROM venues v
      WHERE v.city_id = ${city.id} AND v.deleted_at IS NULL`;

    let hiddenTotal = 0;
    let mergedTotal = 0;
    const report: string[] = [];

    for (const v of venues) {
      const rows = await sql<
        { id: string; days_of_week: number[]; start_time: string | null; end_time: string | null; all_day: boolean; active: boolean }[]
      >`
        SELECT id, days_of_week, start_time, end_time, all_day, active
        FROM happy_hours
        WHERE venue_id = ${v.id} AND deleted_at IS NULL`;
      if (rows.length === 0) continue;

      // Map DB rows to reconcile inputs, remembering the source row id per (key).
      const idsByKey = new Map<string, string[]>();
      const inputs: ReconcileWindow[] = rows.map((r) => {
        const win: ReconcileWindow = {
          daysOfWeek: r.days_of_week,
          startTime: r.start_time,
          endTime: r.end_time,
          allDay: r.all_day,
        };
        const key = `${r.start_time ?? "-"}|${r.end_time ?? "-"}|${r.all_day}`;
        idsByKey.set(key, [...(idsByKey.get(key) ?? []), r.id]);
        return win;
      });

      const results = reconcileWindows(inputs, v.hours_json);

      for (const res of results) {
        const key = `${res.window.startTime ?? "-"}|${res.window.endTime ?? "-"}|${res.window.allDay}`;
        const ids = idsByKey.get(key) ?? [];
        if (ids.length === 0) continue;
        const [keep, ...absorbed] = ids;
        let keepAlive = true;

        // Merge: soft-delete absorbed FIRST so they leave the partial unique index
        // (happy_hours_natural_uq WHERE deleted_at IS NULL) before we expand the kept row's
        // days to the union — otherwise a subset keep colliding with an absorbed copy that
        // already equals the union trips the constraint.
        if (absorbed.length > 0) {
          mergedTotal += absorbed.length;
          report.push(`  MERGE  ${v.name}: ${ids.length} rows ${key} → 1 (days ${res.window.daysOfWeek.join(",")})`);
          if (apply) {
            await sql`UPDATE happy_hours SET deleted_at = now(), active = false, updated_at = now() WHERE id = ANY(${absorbed})`;
            try {
              await sql`UPDATE happy_hours SET days_of_week = ${res.window.daysOfWeek}, updated_at = now() WHERE id = ${keep}`;
            } catch (e) {
              // The natural-key index ignores all_day; a unioned day-set can still collide with
              // a different live row. Soft-delete the kept row — the colliding row already covers it.
              const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
              if (code !== "23505") throw e;
              await sql`UPDATE happy_hours SET deleted_at = now(), active = false, updated_at = now() WHERE id = ${keep}`;
              keepAlive = false;
              report.push(`  COLLIDE ${v.name}: ${key} union collides with a live row; kept row soft-deleted`);
            }
          }
        }

        // Hide: operating-hours / overlap-conflict (skip if a collision already removed keep).
        if (!res.active && keepAlive) {
          hiddenTotal += 1;
          report.push(`  HIDE   ${v.name}: ${key} [${res.reasons.join(",")}]`);
          if (apply) {
            await sql`UPDATE happy_hours SET active = false, updated_at = now() WHERE id = ${keep}`;
          }
        }
      }
    }

    console.log(report.join("\n"));
    console.log(
      `\n${apply ? "APPLIED" : "DRY-RUN"} for '${slug}/${state}': ${mergedTotal} duplicate row(s) merged, ${hiddenTotal} window(s) hidden.`,
    );
    if (!apply) console.log("Re-run with --apply to write.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
