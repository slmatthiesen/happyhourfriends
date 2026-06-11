/**
 * Operator-gated review of gate-hidden happy-hour windows on stub venues — $0, no AI.
 *
 *   Report (no DB writes):
 *     pnpm review:hidden [--city <slug> --state <code>] [--limit N]
 *   → writes docs/hidden-hh-review-<YYYY-MM-DD>.{json,md}
 *     Each window carries a suggested `action` ("promote" for HH-shaped windows,
 *     "keep_hidden" otherwise — see lib/recover/hiddenReview). Edit the JSON.
 *
 *   Apply (after you review + edit the .json's `action` fields):
 *     pnpm review:hidden --apply docs/hidden-hh-review-<date>.json
 *   → promote: active=true + venue → complete; delete: soft-delete. Writes audit_log.
 *     `delete` is performed ONLY if the json explicitly says action: "delete".
 *
 * Requires DATABASE_URL only.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { durationHours, suggestAction, type HiddenAction } from "@/lib/recover/hiddenReview";

const DATABASE_URL = process.env.DATABASE_URL;

const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const applyPath = argValue("--apply");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;

// --city is optional (omit to scan all cities); when provided, --state is required.
const hasCityFlag = args.includes("--city");
const cityArgs = hasCityFlag ? requireCityArgs() : null;

// A YYYY-MM-DD stamp. tsx scripts run ad-hoc, so OS date is fine here.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ReportEntry {
  happyHourId: string;
  venueId: string;
  city: string;
  venue: string;
  websiteUrl: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  timeKnown: boolean;
  durationH: number | null;
  offerings: number;
  extractConfidence: string | null;
  sourceUrl: string | null;
  notes: string | null;
  action: HiddenAction;
}

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtDays = (d: number[]) => d.map((n) => DAY[n] ?? String(n)).join(",");
const fmtTime = (e: ReportEntry) =>
  e.allDay ? "all day" : !e.timeKnown ? "time unknown" : `${e.startTime ?? "?"}–${e.endTime ?? "close"}`;

async function runReport() {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, { max: 4 });
  try {
    const rows = await sql<
      {
        happy_hour_id: string;
        venue_id: string;
        city: string;
        venue: string;
        website_url: string | null;
        days_of_week: number[];
        start_time: string | null;
        end_time: string | null;
        all_day: boolean;
        time_known: boolean;
        offerings: number;
        extract_confidence: string | null;
        source_url: string | null;
        notes: string | null;
      }[]
    >`
      SELECT hh.id AS happy_hour_id, v.id AS venue_id, c.name AS city, v.name AS venue,
             v.website_url, hh.days_of_week, hh.start_time, hh.end_time, hh.all_day,
             hh.time_known,
             (SELECT count(*)::int FROM offerings o WHERE o.happy_hour_id = hh.id AND o.active) AS offerings,
             hh.extract_confidence, hh.source_url, hh.notes
      FROM happy_hours hh
      JOIN venues v ON v.id = hh.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE NOT hh.active AND hh.deleted_at IS NULL
        AND v.deleted_at IS NULL AND v.status = 'active' AND v.data_completeness = 'stub'
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours a
          WHERE a.venue_id = v.id AND a.active AND a.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND c.slug = ${cityArgs.slug} AND c.state = ${cityArgs.state}` : sql``}
      ORDER BY c.name, v.name, hh.start_time NULLS LAST
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    const entries: ReportEntry[] = rows.map((r) => {
      const shape = {
        startTime: r.start_time,
        endTime: r.end_time,
        allDay: r.all_day,
        timeKnown: r.time_known,
      };
      return {
        happyHourId: r.happy_hour_id,
        venueId: r.venue_id,
        city: r.city,
        venue: r.venue,
        websiteUrl: r.website_url,
        daysOfWeek: r.days_of_week,
        startTime: r.start_time,
        endTime: r.end_time,
        allDay: r.all_day,
        timeKnown: r.time_known,
        durationH: durationHours(r.start_time, r.end_time),
        offerings: r.offerings,
        extractConfidence: r.extract_confidence,
        sourceUrl: r.source_url,
        notes: r.notes,
        action: suggestAction(shape),
      };
    });

    const stamp = today();
    const jsonPath = `docs/hidden-hh-review-${stamp}.json`;
    const mdPath = `docs/hidden-hh-review-${stamp}.md`;
    writeFileSync(jsonPath, JSON.stringify({ generatedAt: stamp, entries }, null, 2));

    const promote = entries.filter((e) => e.action === "promote");
    const md = [
      `# Hidden-window review — ${stamp}`,
      "",
      `${entries.length} hidden windows on ${new Set(entries.map((e) => e.venueId)).size} stub venues` +
        (cityArgs ? ` in ${cityArgs.slug}, ${cityArgs.state}` : " across all cities") +
        `. Suggested promote: ${promote.length}.`,
      "",
      `Edit \`action\` fields in \`${jsonPath}\`, then: \`pnpm review:hidden --apply ${jsonPath}\``,
      "",
      "| action | city | venue | days | time | dur(h) | offers | conf | notes |",
      "|---|---|---|---|---|---|---|---|---|",
      ...entries.map(
        (e) =>
          `| ${e.action === "promote" ? "**promote**" : e.action} | ${e.city} | [${e.venue}](${e.websiteUrl ?? ""}) | ${fmtDays(e.daysOfWeek)} | ${fmtTime(e)} | ${e.durationH?.toFixed(1) ?? ""} | ${e.offerings} | ${e.extractConfidence ?? ""} | ${(e.notes ?? "").slice(0, 60)} |`,
      ),
      "",
    ].join("\n");
    writeFileSync(mdPath, md);

    console.log(`${entries.length} hidden windows (${promote.length} suggested promote)`);
    console.log(`report → ${mdPath}`);
    console.log(`actions → ${jsonPath} (edit, then --apply)`);
  } finally {
    await sql.end();
  }
}

async function runApply(path: string) {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries: ReportEntry[] };
  const sql = postgres(DATABASE_URL, { max: 4 });
  let promoted = 0;
  let deleted = 0;
  let kept = 0;
  try {
    for (const e of parsed.entries) {
      if (e.action === "keep_hidden") {
        kept++;
        continue;
      }
      if (e.action === "promote") {
        const [before] = await sql`
          SELECT active, days_of_week, start_time, end_time FROM happy_hours
          WHERE id = ${e.happyHourId} AND deleted_at IS NULL AND NOT active
        `;
        if (!before) continue; // already live / deleted / unknown id — nothing to do
        await sql`UPDATE happy_hours SET active = true, updated_at = now() WHERE id = ${e.happyHourId}`;
        // Mirror resolveVenue's recovery promotion: a live window makes the venue complete.
        await sql`
          UPDATE venues SET data_completeness = 'complete', last_verified_at = now(), updated_at = now()
          WHERE id = ${e.venueId} AND data_completeness = 'stub'
        `;
        await sql`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('happy_hours', ${e.happyHourId}, ${sql.json({ active: false })},
                  ${sql.json({ active: true })}, 'admin', 'hidden-window review: operator promote')
        `;
        promoted++;
      } else if (e.action === "delete") {
        await sql`UPDATE happy_hours SET deleted_at = now(), updated_at = now() WHERE id = ${e.happyHourId} AND deleted_at IS NULL`;
        await sql`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('happy_hours', ${e.happyHourId}, ${sql.json({ deletedAt: null })},
                  ${sql.json({ deletedAt: "now" })}, 'admin', 'hidden-window review: operator delete')
        `;
        deleted++;
      }
    }
    console.log(`promoted ${promoted}, deleted ${deleted}, kept hidden ${kept}`);
  } finally {
    await sql.end();
  }
}

(applyPath ? runApply(applyPath) : runReport()).catch((err) => {
  console.error(err);
  process.exit(1);
});
