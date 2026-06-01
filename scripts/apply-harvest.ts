/**
 * Write reviewed happy-hour data recovered by the FREE harvester.
 *
 * Reads a hand-curated JSON file (default docs/hh-recovered.json) produced by
 * reading docs/hh-harvest.jsonl and structuring only the CLEAR wins — data that
 * literally appears on the venue's own page (PRD §13: never fabricate). Inserts
 * happy_hours + offerings, dedupes on the natural key, writes an audit_log row,
 * and promotes the venue out of 'stub'. NO Anthropic API — this is the $0 path.
 *
 * Dry-run by DEFAULT. Pass --apply to actually write.
 *
 * Usage:
 *   npx tsx scripts/apply-harvest.ts                 # dry-run, docs/hh-recovered.json
 *   npx tsx scripts/apply-harvest.ts --file foo.json # dry-run, custom file
 *   npx tsx scripts/apply-harvest.ts --apply         # write
 *
 * Input shape (docs/hh-recovered.json) — an array of:
 *   {
 *     "venueId": "uuid",
 *     "name": "Aunt Chilada's",          // readability only; not used to match
 *     "windows": [{
 *       "daysOfWeek": [1,2,3,4,5],        // ISO 1=Mon..7=Sun, non-empty
 *       "allDay": false,
 *       "startTime": "15:00" | "open" | null,  // "open" → derive from hours_json
 *       "endTime": "18:00" | null,
 *       "locationWithinVenue": "all",     // bar|patio|dining|all (default all)
 *       "notes": "...",                   // optional
 *       "sourceUrl": "https://…/happy-hour",   // REQUIRED (the page it came from)
 *       "offerings": [{
 *         "kind": "drink",                // food|drink|other
 *         "category": "beer",             // beer|wine|cocktail|spirit|appetizer|entree|dessert|other
 *         "name": "$4 drafts",
 *         "priceCents": 400,              // optional
 *         "description": "...",           // optional
 *         "conditions": "...",            // optional
 *         "sourceUrl": "https://…"        // optional; defaults to the window's sourceUrl
 *       }]
 *     }]
 *   }
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";

type Sql = ReturnType<typeof postgres>;

const APPLY = process.argv.includes("--apply");
function arg(f: string) { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; }
const FILE = arg("--file") ?? "docs/hh-recovered.json";

const KINDS = new Set(["food", "drink", "other"]);
const CATEGORIES = new Set(["beer", "wine", "cocktail", "spirit", "appetizer", "entree", "dessert", "other"]);
const LOCATIONS = new Set(["bar", "patio", "dining", "all"]);
const ACTOR = "harvest-recovery";

interface InOffering {
  kind: string; category: string; name?: string | null;
  priceCents?: number | null; discountCents?: number | null;
  description?: string | null; conditions?: string | null;
  sourceUrl?: string | null;
}
interface InWindow {
  daysOfWeek: number[]; allDay?: boolean;
  startTime?: string | null; endTime?: string | null;
  locationWithinVenue?: string; notes?: string | null;
  sourceUrl: string; offerings?: InOffering[];
}
interface InVenue { venueId: string; name?: string; windows: InWindow[]; }

interface HoursRec { openDay: number; openMin: number; closeDay: number; closeMin: number; }

function minToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** Normalise "15:00" / "3:00 pm" style — but we expect HH:MM 24h from curation. */
function normTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim());
  if (!m) throw new Error(`bad time "${t}" (want HH:MM 24h)`);
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (h > 23 || mm > 59) throw new Error(`out-of-range time "${t}"`);
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

/** Derive a start time for "opens-until-X" windows from the venue's hours_json:
 *  the open minute for the days in this window. Returns null if unavailable or
 *  ambiguous (different open times across the window's days). */
function deriveOpen(hours: HoursRec[] | null, days: number[]): { time: string | null; warn?: string } {
  if (!hours || hours.length === 0) return { time: null, warn: "no hours_json" };
  const opens = new Set<number>();
  for (const d of days) {
    for (const rec of hours) if (rec.openDay === d) opens.add(rec.openMin);
  }
  if (opens.size === 0) return { time: null, warn: "no open record for those days" };
  if (opens.size > 1) {
    // Different open times across days → can't represent in one window cleanly.
    const earliest = Math.min(...opens);
    return { time: minToTime(earliest), warn: `ambiguous open times ${[...opens].map(minToTime).join("/")}, using earliest` };
  }
  return { time: minToTime([...opens][0]) };
}

function validateVenue(v: InVenue, idx: number): string[] {
  const errs: string[] = [];
  if (!v.venueId || !/^[0-9a-f-]{36}$/i.test(v.venueId)) errs.push(`[#${idx}] venueId missing/invalid`);
  if (!Array.isArray(v.windows) || v.windows.length === 0) errs.push(`[#${idx}] no windows`);
  for (let w = 0; w < (v.windows ?? []).length; w++) {
    const win = v.windows[w];
    const tag = `[#${idx} "${v.name ?? v.venueId}" win ${w}]`;
    if (!win.sourceUrl || !/^https?:\/\//i.test(win.sourceUrl)) errs.push(`${tag} sourceUrl required (http/https)`);
    if (!Array.isArray(win.daysOfWeek) || win.daysOfWeek.length === 0) errs.push(`${tag} daysOfWeek empty`);
    else if (!win.daysOfWeek.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) errs.push(`${tag} daysOfWeek out of ISO 1..7`);
    if (win.allDay) {
      if (win.startTime != null || win.endTime != null) errs.push(`${tag} allDay must have null start/end`);
    }
    const loc = win.locationWithinVenue ?? "all";
    if (!LOCATIONS.has(loc)) errs.push(`${tag} bad locationWithinVenue "${loc}"`);
    for (let o = 0; o < (win.offerings ?? []).length; o++) {
      const off = win.offerings![o];
      if (!KINDS.has(off.kind)) errs.push(`${tag} offering ${o} bad kind "${off.kind}"`);
      if (!CATEGORIES.has(off.category)) errs.push(`${tag} offering ${o} bad category "${off.category}"`);
    }
  }
  return errs;
}

async function main() {
  let raw: string;
  try { raw = readFileSync(FILE, "utf8"); }
  catch { console.error(`Cannot read ${FILE}. Create the reviewed file first.`); process.exit(1); }
  let data: InVenue[];
  try { data = JSON.parse(raw); }
  catch (e) { console.error(`${FILE} is not valid JSON: ${(e as Error).message}`); process.exit(1); }
  if (!Array.isArray(data)) { console.error(`${FILE} must be a JSON array of venues.`); process.exit(1); }

  // Validate everything up front; abort before any write if invalid.
  const allErrs = data.flatMap((v, i) => validateVenue(v, i));
  if (allErrs.length) {
    console.error(`Validation failed (${allErrs.length}):`);
    for (const e of allErrs) console.error("  ✗ " + e);
    process.exit(1);
  }

  const sql: Sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  console.log(`${APPLY ? "APPLYING" : "DRY-RUN"} — ${data.length} venue(s) from ${FILE}\n`);

  let winsPlanned = 0, winsWritten = 0, winsDup = 0, winsSkipped = 0, offWritten = 0, venuesPromoted = 0;

  for (const v of data) {
    const venueRows = await sql<{ id: string; name: string; hours_json: HoursRec[] | null; data_completeness: string }[]>`
      SELECT id, name, hours_json, data_completeness FROM venues WHERE id = ${v.venueId} AND deleted_at IS NULL`;
    if (venueRows.length === 0) { console.log(`✗ ${v.name ?? v.venueId}: venue not found / deleted — skipping`); continue; }
    const venue = venueRows[0];
    console.log(`• ${venue.name}  (${venue.data_completeness})`);

    let venueGotWindow = false;
    for (const win of v.windows) {
      const days = [...new Set(win.daysOfWeek)].sort((a, b) => a - b);
      const allDay = !!win.allDay;
      let startTime: string | null = null;
      let endTime: string | null = win.endTime ? normTime(win.endTime) : null;

      if (allDay) {
        startTime = null; endTime = null;
      } else if (win.startTime === "open") {
        const d = deriveOpen(venue.hours_json, days);
        if (!d.time) { console.log(`    ✗ skip window ${JSON.stringify(days)}: cannot derive open time (${d.warn})`); winsSkipped++; continue; }
        startTime = d.time;
        if (d.warn) console.log(`    ⚠ ${d.warn}`);
      } else if (win.startTime) {
        startTime = normTime(win.startTime);
      } else {
        console.log(`    ✗ skip window ${JSON.stringify(days)}: allDay=false needs startTime`); winsSkipped++; continue;
      }

      winsPlanned++;
      const loc = win.locationWithinVenue ?? "all";

      // Report dup against the natural key (venue_id, days, start, end, location).
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM happy_hours
        WHERE venue_id = ${v.venueId} AND deleted_at IS NULL
          AND days_of_week = ${days}
          AND start_time IS NOT DISTINCT FROM ${startTime}::time
          AND end_time IS NOT DISTINCT FROM ${endTime}::time
          AND location_within_venue = ${loc}::location_within_venue`;
      const timeLabel = allDay ? "ALL DAY" : `${startTime?.slice(0, 5)}–${endTime ? endTime.slice(0, 5) : "close"}`;
      if (existing.length) {
        console.log(`    = dup  days ${JSON.stringify(days)} ${timeLabel} — already present, skip`);
        winsDup++; continue;
      }
      console.log(`    + days ${JSON.stringify(days)} ${timeLabel}  (${(win.offerings ?? []).length} offering(s))  src ${win.sourceUrl}`);
      venueGotWindow = true;

      if (!APPLY) { winsWritten++; offWritten += (win.offerings ?? []).length; continue; }

      await sql.begin(async (tx) => {
        const hh = await tx<{ id: string }[]>`
          INSERT INTO happy_hours
            (venue_id, days_of_week, all_day, start_time, end_time,
             location_within_venue, notes, active, source_url)
          VALUES
            (${v.venueId}, ${days}, ${allDay}, ${startTime}, ${endTime},
             ${loc}::location_within_venue, ${win.notes ?? null}, true, ${win.sourceUrl})
          ON CONFLICT DO NOTHING
          RETURNING id`;
        if (hh.length === 0) { winsDup++; return; }
        const hhId = hh[0].id;
        winsWritten++;
        for (const off of win.offerings ?? []) {
          await tx`
            INSERT INTO offerings
              (happy_hour_id, kind, category, name, price_cents, discount_cents, description, conditions, active, source_url)
            VALUES
              (${hhId}, ${off.kind}::offering_kind, ${off.category}::offering_category,
               ${off.name ?? null}, ${off.priceCents ?? null}, ${off.discountCents ?? null},
               ${off.description ?? null}, ${off.conditions ?? null}, true, ${off.sourceUrl ?? win.sourceUrl})`;
          offWritten++;
        }
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('happy_hours', ${hhId}, NULL,
                  ${tx.json({ days_of_week: days, all_day: allDay, start_time: startTime, end_time: endTime, location_within_venue: loc, source_url: win.sourceUrl, offerings: (win.offerings ?? []).length })},
                  ${ACTOR}, ${`free harvest recovery from ${win.sourceUrl}`})`;
      });
    }

    // Promote the venue out of stub/partial (never downgrade 'verified').
    if (venueGotWindow && (venue.data_completeness === "stub" || venue.data_completeness === "partial")) {
      venuesPromoted++;
      if (APPLY) {
        await sql`UPDATE venues SET data_completeness = 'complete', last_verified_at = now(), updated_at = now() WHERE id = ${v.venueId}`;
      } else {
        console.log(`    ↑ would promote ${venue.data_completeness} → complete`);
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry-run"}: ${winsWritten} window(s) ${APPLY ? "written" : "to write"}, ${offWritten} offering(s), ` +
    `${venuesPromoted} venue(s) promoted. (${winsDup} dup, ${winsSkipped} skipped, ${winsPlanned} planned)`);
  if (!APPLY) console.log(`Re-run with --apply to write.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
