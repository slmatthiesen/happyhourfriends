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
import { reconcileWindows, mergeKey, offeringsFingerprint, type ReconcileWindow } from "@/lib/places/windowReconcile";
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
        {
          id: string;
          days_of_week: number[];
          start_time: string | null;
          end_time: string | null;
          all_day: boolean;
          active: boolean;
          offs: { name: string | null; price_cents: number | null }[];
        }[]
      >`
        SELECT hh.id, hh.days_of_week, hh.start_time, hh.end_time, hh.all_day, hh.active,
               coalesce(json_agg(json_build_object('name', o.name, 'price_cents', o.price_cents))
                        FILTER (WHERE o.id IS NOT NULL), '[]') AS offs
        FROM happy_hours hh
        LEFT JOIN offerings o ON o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active = true
        -- active=true only: already-hidden rows are withheld, so they must NOT drag a live
        -- window into an overlap/duplicate verdict (that re-hid a venue we'd just fixed).
        WHERE hh.venue_id = ${v.id} AND hh.deleted_at IS NULL AND hh.active = true
        GROUP BY hh.id`;
      if (rows.length === 0) continue;

      // Map DB rows to reconcile inputs, remembering the source row id per (key).
      // The key includes the offerings fingerprint: same-time windows with DIFFERENT
      // offerings (per-day specials) are distinct deals and must not merge.
      const idsByKey = new Map<string, string[]>();
      const inputs: ReconcileWindow[] = rows.map((r) => {
        const win: ReconcileWindow = {
          daysOfWeek: r.days_of_week,
          startTime: r.start_time,
          endTime: r.end_time,
          allDay: r.all_day,
          offeringsKey: offeringsFingerprint(r.offs.map((o) => ({ name: o.name, priceCents: o.price_cents }))),
        };
        idsByKey.set(mergeKey(win), [...(idsByKey.get(mergeKey(win)) ?? []), r.id]);
        return win;
      });

      const results = reconcileWindows(inputs, v.hours_json);

      // Human-readable window label for the report (mergeKey is the internal identity).
      const label = (win: ReconcileWindow) => {
        const time = win.allDay ? "all-day" : `${win.startTime ?? "?"}–${win.endTime ?? "close"}`;
        const nOff = win.offeringsKey ? win.offeringsKey.split(";").length : 0;
        return `${time} (${nOff} offering${nOff === 1 ? "" : "s"})`;
      };

      for (const res of results) {
        const key = mergeKey(res.window);
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
          report.push(`  MERGE  ${v.name}: ${ids.length} rows ${label(res.window)} → 1 (days ${res.window.daysOfWeek.join(",")})`);
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
              report.push(`  COLLIDE ${v.name}: ${label(res.window)} union collides with a live row; kept row soft-deleted`);
            }
          }
        }

        // Hide: operating-hours / overlap-conflict (skip if a collision already removed keep).
        if (!res.active && keepAlive) {
          hiddenTotal += 1;
          report.push(`  HIDE   ${v.name}: days ${res.window.daysOfWeek.join(",")} ${label(res.window)} [${res.reasons.join(",")}]`);
          if (apply) {
            await sql`UPDATE happy_hours SET active = false, updated_at = now() WHERE id = ${keep}`;
          }
        }
      }

      // If reconcile hid a venue's LAST active window, it's no longer a complete listing —
      // demote it to a stub so it surfaces for crowdsourced / re-extracted recovery rather
      // than rendering as a "complete" venue with no happy hour.
      if (apply) {
        const [{ n }] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM happy_hours
          WHERE venue_id = ${v.id} AND active = true AND deleted_at IS NULL`;
        if (n === 0) {
          const [demoted] = await sql`
            UPDATE venues SET data_completeness = 'stub', updated_at = now()
            WHERE id = ${v.id} AND data_completeness = 'complete' RETURNING id`;
          if (demoted) report.push(`  STUB   ${v.name}: last active window hidden → demoted to stub`);
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
