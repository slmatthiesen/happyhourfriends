/**
 * Operator-gated review of LIVE happy-hour windows that look like meal service —
 * lunch menus, dinner specials, prix fixes, events — rather than happy hours. $0, no AI.
 *
 * Born from the 2026-06-12 all-city price scan ($12-average heuristic). The meal-special
 * gate (lib/places/realnessGate.mealSpecialEvidence) now hides these at ingest; this
 * script sweeps what's ALREADY live, so the operator can review before anything is
 * hidden or deleted. Nothing is written in report mode.
 *
 *   Report (no DB writes):
 *     pnpm review:meal-specials [--city <slug> --state <code>]
 *   → writes docs/meal-special-review-<YYYY-MM-DD>.{json,md,csv}
 *     Includes every live window where the gate's evidence fires OR the average
 *     priced offering exceeds $12. Suggested `action` is "hide" only when the gate
 *     states evidence; price alone suggests "keep" (upscale happy hours are real).
 *     `delete` is NEVER suggested — operator-set only.
 *
 *   Apply (after you review + edit the `action` fields, .json or .csv):
 *     pnpm review:meal-specials --apply docs/meal-special-review-<date>.csv
 *   → hide: active=false (reversible, eligible for re-extract/review);
 *     delete: soft-delete — the persist path refuses to ever re-insert an
 *     operator-deleted window (no resurrection on re-extract).
 *     Either way, a venue left with zero live windows downgrades to stub.
 *     Writes audit_log for every change.
 *
 * Requires DATABASE_URL only.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { mealSpecialEvidence, MEAL_AVG_PRICE_CENTS } from "@/lib/places/realnessGate";
import { toCsv, parseCsv } from "@/lib/recover/hiddenReview";

const DATABASE_URL = process.env.DATABASE_URL;

const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const applyPath = argValue("--apply");

// --city is optional (omit to scan all cities); when provided, --state is required.
const hasCityFlag = args.includes("--city");
const cityArgs = hasCityFlag ? requireCityArgs() : null;

// A YYYY-MM-DD stamp. tsx scripts run ad-hoc, so OS date is fine here.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type MealAction = "keep" | "hide" | "delete";

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
  avgPrice: string | null;
  offerings: number;
  /** Top-priced offering names, for at-a-glance review. */
  sample: string;
  sourceUrl: string | null;
  notes: string | null;
  /** The gate's stated evidence (null = listed on price alone). A hide is never
   *  suggested without it — price alone is how upscale HH gets falsely flagged. */
  evidence: string | null;
  action: MealAction;
}

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtDays = (d: number[]) => d.map((n) => DAY[n] ?? String(n)).join(",");
const fmtTime = (e: ReportEntry) =>
  e.allDay ? "all day" : `${e.startTime ?? "open"}–${e.endTime ?? "close"}`;

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
        source_url: string | null;
        notes: string | null;
        offerings: Array<{ name: string | null; description: string | null; priceCents: number | null }>;
      }[]
    >`
      SELECT hh.id AS happy_hour_id, v.id AS venue_id, c.name AS city, v.name AS venue,
             v.website_url, hh.days_of_week, hh.start_time, hh.end_time, hh.all_day,
             hh.source_url, hh.notes,
             coalesce(
               json_agg(json_build_object(
                 'name', o.name, 'description', o.description, 'priceCents', o.price_cents
               ) ORDER BY o.price_cents DESC NULLS LAST)
               FILTER (WHERE o.id IS NOT NULL), '[]'
             ) AS offerings
      FROM happy_hours hh
      JOIN venues v ON v.id = hh.venue_id AND v.deleted_at IS NULL
      JOIN cities c ON c.id = v.city_id
      LEFT JOIN offerings o
        ON o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active
      WHERE hh.deleted_at IS NULL AND hh.active
        ${cityArgs ? sql`AND lower(c.slug) = ${cityArgs.slug} AND lower(c.state) = ${cityArgs.state}` : sql``}
      GROUP BY hh.id, v.id, c.name, v.name, v.website_url
    `;

    const entries: ReportEntry[] = [];
    for (const r of rows) {
      const evidence = mealSpecialEvidence({
        startTime: r.start_time,
        endTime: r.end_time,
        notes: r.notes,
        sourceUrl: r.source_url,
        offerings: r.offerings,
      });
      const priced = r.offerings
        .map((o) => o.priceCents)
        .filter((p): p is number => p != null && p > 0);
      const avg = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;
      if (!evidence && (avg == null || avg <= MEAL_AVG_PRICE_CENTS)) continue;
      entries.push({
        happyHourId: r.happy_hour_id,
        venueId: r.venue_id,
        city: r.city,
        venue: r.venue,
        websiteUrl: r.website_url,
        daysOfWeek: r.days_of_week,
        startTime: r.start_time,
        endTime: r.end_time,
        allDay: r.all_day,
        avgPrice: avg == null ? null : (avg / 100).toFixed(2),
        offerings: r.offerings.length,
        sample: r.offerings
          .slice(0, 3)
          .map((o) => `${o.name ?? "?"}${o.priceCents != null ? ` $${(o.priceCents / 100).toFixed(0)}` : ""}`)
          .join(" | "),
        sourceUrl: r.source_url,
        notes: r.notes,
        evidence,
        action: evidence ? "hide" : "keep",
      });
    }
    entries.sort(
      (a, b) =>
        Number(b.evidence != null) - Number(a.evidence != null) ||
        Number(b.avgPrice ?? 0) - Number(a.avgPrice ?? 0),
    );

    const stamp = today();
    const base = `docs/meal-special-review-${stamp}`;
    const jsonPath = `${base}.json`;
    const csvPath = `${base}.csv`;
    const mdPath = `${base}.md`;

    writeFileSync(jsonPath, JSON.stringify({ generated: stamp, entries }, null, 2));
    writeFileSync(
      csvPath,
      toCsv(
        entries.map((e) => ({
          ...e,
          days: fmtDays(e.daysOfWeek),
          time: fmtTime(e),
        })),
        // action first so it's the obvious edit column; ids last (needed by --apply).
        ["action", "evidence", "avgPrice", "city", "venue", "days", "time", "offerings",
         "sample", "sourceUrl", "websiteUrl", "notes", "happyHourId", "venueId"],
      ),
    );

    const hides = entries.filter((e) => e.action === "hide");
    const md = [
      `# Meal-special review — ${stamp}`,
      "",
      `${entries.length} live windows flagged on ${new Set(entries.map((e) => e.venueId)).size} venues` +
        (cityArgs ? ` in ${cityArgs.slug}, ${cityArgs.state}` : " across all cities") +
        `. Suggested hide (evidence-backed): ${hides.length}; the rest are listed on price`,
      `alone (avg > $${MEAL_AVG_PRICE_CENTS / 100}) and default to keep — upscale happy hours are real.`,
      "",
      "Actions: `keep` = no change; `hide` = active=false (reversible — back in the",
      "hidden-review/re-extract pool); `delete` = permanent soft-delete, the window can",
      "never be re-created by a future re-extraction. A hide is only ever suggested with",
      "stated evidence; explicit happy-hour wording anywhere vetoes the suggestion.",
      "",
      `Edit \`action\` fields in \`${jsonPath}\` — or sort/filter \`${csvPath}\` in a`,
      `spreadsheet and edit its action column — then: \`pnpm review:meal-specials --apply <file>\``,
      "(accepts .json or .csv).",
      "",
      "| action | evidence | avg $ | city | venue | days | time | sample |",
      "|---|---|---|---|---|---|---|---|",
      ...entries.map(
        (e) =>
          `| ${e.action === "hide" ? "**hide**" : e.action} | ${e.evidence ?? ""} | ${e.avgPrice ?? ""} | ${e.city} | [${e.venue}](${e.websiteUrl ?? ""}) | ${fmtDays(e.daysOfWeek)} | ${fmtTime(e)} | ${e.sample.slice(0, 90)} |`,
      ),
      "",
    ].join("\n");
    writeFileSync(mdPath, md);

    console.log(`${entries.length} live windows flagged (${hides.length} suggested hide, rest keep)`);
    console.log(`report → ${mdPath}`);
    console.log(`actions → ${jsonPath} or ${csvPath} (edit either, then --apply <file>)`);
  } finally {
    await sql.end();
  }
}

const ACTIONS: MealAction[] = ["keep", "hide", "delete"];

/** Read operator decisions from the edited .json or .csv report. Fails loud on an
 *  unknown action value or a row missing its ids (a mangled spreadsheet export must
 *  never silently skip — or worse, misroute — a decision). */
function readDecisions(path: string): Array<Pick<ReportEntry, "happyHourId" | "venueId" | "action">> {
  const raw = readFileSync(path, "utf8");
  const rows = path.endsWith(".csv")
    ? parseCsv(raw)
    : (JSON.parse(raw) as { entries: ReportEntry[] }).entries;
  return rows.map((r, i) => {
    const { happyHourId, venueId, action } = r as Record<string, string>;
    if (!happyHourId || !venueId || !ACTIONS.includes(action as MealAction)) {
      throw new Error(`row ${i + 1}: bad decision (happyHourId=${happyHourId}, venueId=${venueId}, action=${action})`);
    }
    return { happyHourId, venueId, action: action as MealAction };
  });
}

async function runApply(path: string) {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const decisions = readDecisions(path);
  const sql = postgres(DATABASE_URL, { max: 4 });
  let hidden = 0;
  let deleted = 0;
  let kept = 0;
  let stubbed = 0;
  try {
    for (const e of decisions) {
      if (e.action === "keep") {
        kept++;
        continue;
      }
      if (e.action === "hide") {
        const [before] = await sql`
          SELECT active FROM happy_hours
          WHERE id = ${e.happyHourId} AND deleted_at IS NULL AND active
        `;
        if (!before) continue; // already hidden / deleted / unknown id — nothing to do
        await sql`UPDATE happy_hours SET active = false, updated_at = now() WHERE id = ${e.happyHourId}`;
        await sql`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('happy_hours', ${e.happyHourId}, ${sql.json({ active: true })},
                  ${sql.json({ active: false })}, 'admin', 'meal-special review: operator hide')
        `;
        hidden++;
      } else if (e.action === "delete") {
        const [before] = await sql`
          SELECT id FROM happy_hours WHERE id = ${e.happyHourId} AND deleted_at IS NULL
        `;
        if (!before) continue;
        await sql`UPDATE happy_hours SET deleted_at = now(), active = false, updated_at = now() WHERE id = ${e.happyHourId}`;
        await sql`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('happy_hours', ${e.happyHourId}, ${sql.json({ deletedAt: null })},
                  ${sql.json({ deletedAt: "now" })}, 'admin', 'meal-special review: operator delete')
        `;
        deleted++;
      }
      // A venue whose last live window just went away is a help-wanted stub again.
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM happy_hours
        WHERE venue_id = ${e.venueId} AND deleted_at IS NULL AND active
      `;
      if (count === "0") {
        const updated = await sql`
          UPDATE venues SET data_completeness = 'stub', last_verified_at = NULL, updated_at = now()
          WHERE id = ${e.venueId} AND data_completeness <> 'stub'
        `;
        if (updated.count > 0) stubbed++;
      }
    }
    console.log(`hidden ${hidden}, deleted ${deleted}, kept ${kept}; ${stubbed} venue(s) downgraded to stub`);
  } finally {
    await sql.end();
  }
}

(applyPath ? runApply(applyPath) : runReport()).catch((err) => {
  console.error(err);
  process.exit(1);
});
