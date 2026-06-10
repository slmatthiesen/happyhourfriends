/**
 * export:flag-labels — export every operator-adjudicated flag-review verdict
 * (data_audit.resolution operator_kept/operator_hidden) as a labeled eval case into
 * data/flag-review-goldens.json (checked in; the corpus for eval:flags). $0, read-only.
 *
 * Inputs are pinned: rows scanned after migration 0020 carry audit_input (the exact rule
 * inputs at scan time). Older verdicts are RECONSTRUCTED — current windows, with the
 * window(s) the operator hid (audit_log: table happy_hours, reason 'Flag review%',
 * after.active=false) flipped back to active, since the hide itself mutated them.
 *
 * Usage: pnpm tsx scripts/export-flag-labels.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { offeringsFingerprint } from "@/lib/places/windowReconcile";
import type { AuditWindow, AnomalyFlag, VenueAuditInput } from "@/lib/audit/anomalyRules";
import type { FlagLabelCase } from "@/lib/audit/flagEval";

const OUT = "data/flag-review-goldens.json";

function windowKey(w: { daysOfWeek: number[]; startTime: string | null; endTime: string | null }): string {
  const days = [...new Set(w.daysOfWeek)].sort((a, b) => a - b).join(",");
  const t = (s: string | null) => (s ? s.slice(0, 5) : "");
  return `${days}|${t(w.startTime)}|${t(w.endTime)}`;
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const adjudicated = await sql<
      {
        venue_id: string; name: string; slug: string; city_slug: string;
        website_url: string | null; hours_json: VenueAuditInput["hoursJson"];
        resolution: string; flags: AnomalyFlag[]; agent_verdict: string | null;
        audit_input: VenueAuditInput | null;
      }[]
    >`
      SELECT da.venue_id, v.name, v.slug, c.slug AS city_slug, v.website_url, v.hours_json,
             da.resolution, da.flags, da.agent_verdict, da.audit_input
      FROM data_audit da
      JOIN venues v ON v.id = da.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE da.resolution IN ('operator_kept', 'operator_hidden')
      ORDER BY c.slug, v.slug`;

    const cases: FlagLabelCase[] = [];
    for (const r of adjudicated) {
      // Which windows did the operator hide? (empty for kept)
      const hiddenRows = await sql<{ row_id: string }[]>`
        SELECT al.row_id
        FROM audit_log al
        JOIN happy_hours hh ON hh.id = al.row_id::uuid
        WHERE al.table_name = 'happy_hours'
          AND al.reason LIKE 'Flag review%'
          AND al.after_jsonb->>'active' = 'false'
          AND hh.venue_id = ${r.venue_id}`;
      const hiddenIds = new Set(hiddenRows.map((h) => h.row_id));

      const rawRows = await sql<
        (Omit<AuditWindow, "offeringsKey"> & { id: string; offs: { name: string | null; price_cents: number | null }[] })[]
      >`
        SELECT hh.id, hh.days_of_week AS "daysOfWeek", hh.start_time AS "startTime", hh.end_time AS "endTime",
               hh.all_day AS "allDay", hh.active, hh.source_url AS "sourceUrl", hh.notes,
               coalesce(json_agg(json_build_object('name', o.name, 'price_cents', o.price_cents))
                        FILTER (WHERE o.id IS NOT NULL), '[]') AS offs
        FROM happy_hours hh
        LEFT JOIN offerings o ON o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active = true
        WHERE hh.venue_id = ${r.venue_id} AND hh.deleted_at IS NULL
        GROUP BY hh.id`;
      const hiddenWindows = rawRows.filter((w) => hiddenIds.has(w.id)).map(windowKey);

      let input: VenueAuditInput;
      if (r.audit_input) {
        input = r.audit_input;
      } else {
        // Reconstruct scan-time inputs: un-hide the flag-review-hidden windows.
        const windows: AuditWindow[] = rawRows.map(({ id, offs, ...w }) => ({
          ...w,
          active: hiddenIds.has(id) ? true : w.active,
          offeringsKey: offeringsFingerprint(offs.map((o) => ({ name: o.name, priceCents: o.price_cents }))),
        }));
        input = { websiteUrl: r.website_url, hoursJson: r.hours_json, windows };
      }

      cases.push({
        city: r.city_slug,
        venue: r.name,
        slug: r.slug,
        label: r.resolution === "operator_kept" ? "kept" : "hidden",
        note: r.agent_verdict,
        flagsAtVerdict: r.flags ?? [],
        hiddenWindows,
        input,
      });
    }

    writeFileSync(OUT, JSON.stringify(cases, null, 2) + "\n");
    const kept = cases.filter((c) => c.label === "kept").length;
    console.log(`Exported ${cases.length} labeled case(s) (${kept} kept / ${cases.length - kept} hidden) → ${OUT}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
