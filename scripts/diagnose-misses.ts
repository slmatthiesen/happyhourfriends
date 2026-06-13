/**
 * diagnose-misses — assemble a $0 "diagnostic packet" per operator-noted venue, the
 * deterministic first stage of the extraction-miss diagnosis pass
 * (docs/superpowers/specs/2026-06-12-extraction-miss-diagnosis-design.md).
 *
 * Ground truth = the operator notes left during flag review. This pulls each noted venue's
 * note + stored windows/offerings + flags + a FREE triage of its site (which pages discovery
 * finds), so the operator's manual review can finally be turned into recall/precision fixes.
 *
 * READ-ONLY. No venue writes, no model calls, no paid extraction. triageSite's page probes
 * are the only network. Stage 2 (classify A–F into the report) is judgment done by hand over
 * this output.
 *
 *   pnpm tsx scripts/diagnose-misses.ts                 # all noted venues, with triage
 *   pnpm tsx scripts/diagnose-misses.ts --no-triage     # DB only (fast, offline)
 *   pnpm tsx scripts/diagnose-misses.ts --city slo --state ca
 *
 * Output: docs/diagnosis-packets-<YYYY-MM-DD>.json
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { triageSite } from "@/lib/places/siteTriage";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const noTriage = args.includes("--no-triage");
const citySlug = argValue("--city");
const cityState = argValue("--state");
if (citySlug && !cityState) {
  console.error("ERROR: --city requires --state.");
  process.exit(1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Offering {
  name: string | null;
  description: string | null;
  priceCents: number | null;
  kind: string;
  category: string;
}
interface WindowRow {
  id: string;
  active: boolean;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  timeKnown: boolean;
  sourceUrl: string | null;
  notes: string | null;
  extractConfidence: string | null;
  offerings: Offering[];
}
interface TriageSummary {
  kind: string;
  decision: string;
  reason: string;
  confirmedHhUrls: string[];
  hhSignalUrls: string[];
}
interface Packet {
  venueId: string;
  venue: string;
  city: string;
  citySlug: string;
  state: string;
  websiteUrl: string | null;
  dataCompleteness: string;
  hoursJson: unknown;
  resolution: string;
  flags: unknown;
  operatorNote: string | null;
  agentVerdict: string | null;
  windows: WindowRow[];
  triage: TriageSummary | { error: string } | null;
}

async function run() {
  const sql = postgres(DATABASE_URL!, { max: 4 });
  try {
    // Noted venues = union of the parked-lane note (operator_note) and the kept/hidden note
    // that keepFlaggedVenue stashes in agent_verdict. Either non-empty qualifies.
    const venues = await sql<
      {
        venue_id: string;
        venue: string;
        city: string;
        city_slug: string;
        state: string;
        website_url: string | null;
        data_completeness: string;
        hours_json: unknown;
        resolution: string;
        flags: unknown;
        operator_note: string | null;
        agent_verdict: string | null;
      }[]
    >`
      SELECT v.id AS venue_id, v.name AS venue, c.name AS city, c.slug AS city_slug, c.state,
             v.website_url, v.data_completeness, v.hours_json,
             da.resolution, da.flags, da.operator_note, da.agent_verdict
      FROM data_audit da
      JOIN venues v ON v.id = da.venue_id AND v.deleted_at IS NULL
      JOIN cities c ON c.id = v.city_id
      -- Genuine operator ground truth only. agent_verdict is excluded as a SELECTOR
      -- because it is mostly AI-adjudicator verdicts ("Adjudicator confirmed vs own
      -- site…") — confirmations, not corrections — though it rides along as packet
      -- context. Operator notes only ever reach operator_note (the parked lane); the
      -- Keep button never writes one.
      WHERE da.operator_note IS NOT NULL AND length(trim(da.operator_note)) > 0
      ${citySlug ? sql`AND c.slug = ${citySlug} AND c.state = ${cityState!}` : sql``}
      ORDER BY c.name, v.name
    `;

    const windowsByVenue = new Map<string, WindowRow[]>();
    if (venues.length > 0) {
      const rows = await sql<
        (WindowRow & { venue_id: string })[]
      >`
        SELECT hh.venue_id,
               hh.id, hh.active, hh.days_of_week AS "daysOfWeek", hh.start_time AS "startTime",
               hh.end_time AS "endTime", hh.all_day AS "allDay", hh.time_known AS "timeKnown",
               hh.source_url AS "sourceUrl", hh.notes, hh.extract_confidence AS "extractConfidence",
               coalesce(
                 json_agg(json_build_object(
                   'name', o.name, 'description', o.description, 'priceCents', o.price_cents,
                   'kind', o.kind, 'category', o.category
                 ) ORDER BY o.price_cents DESC NULLS LAST)
                 FILTER (WHERE o.id IS NOT NULL), '[]'
               ) AS offerings
        FROM happy_hours hh
        LEFT JOIN offerings o ON o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active
        WHERE hh.deleted_at IS NULL
          AND hh.venue_id IN ${sql(venues.map((v) => v.venue_id))}
        GROUP BY hh.id
        ORDER BY hh.active DESC, hh.start_time NULLS LAST
      `;
      for (const r of rows) {
        const { venue_id, ...win } = r;
        const list = windowsByVenue.get(venue_id) ?? [];
        list.push(win);
        windowsByVenue.set(venue_id, list);
      }
    }

    const packets: Packet[] = [];
    // Triage in small concurrent batches so ~50 sites finish quickly without hammering.
    const BATCH = 6;
    for (let i = 0; i < venues.length; i += BATCH) {
      const slice = venues.slice(i, i + BATCH);
      const triaged = await Promise.all(
        slice.map(async (v): Promise<Packet["triage"]> => {
          if (noTriage || !v.website_url) return null;
          try {
            const t = await triageSite({ websiteUri: v.website_url, name: v.venue, cityName: v.city });
            return {
              kind: t.kind,
              decision: t.decision,
              reason: t.reason,
              confirmedHhUrls: t.confirmedHhUrls,
              hhSignalUrls: t.hhSignalUrls,
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      slice.forEach((v, j) => {
        packets.push({
          venueId: v.venue_id,
          venue: v.venue,
          city: v.city,
          citySlug: v.city_slug,
          state: v.state,
          websiteUrl: v.website_url,
          dataCompleteness: v.data_completeness,
          hoursJson: v.hours_json,
          resolution: v.resolution,
          flags: v.flags,
          operatorNote: v.operator_note,
          agentVerdict: v.agent_verdict,
          windows: windowsByVenue.get(v.venue_id) ?? [],
          triage: triaged[j],
        });
      });
      process.stderr.write(`  triaged ${Math.min(i + BATCH, venues.length)}/${venues.length}\n`);
    }

    const path = `docs/diagnosis-packets-${today()}.json`;
    writeFileSync(path, JSON.stringify({ generated: today(), count: packets.length, packets }, null, 2));

    // Console summary so the run is legible without opening the file.
    const byCity = new Map<string, number>();
    for (const p of packets) byCity.set(p.city, (byCity.get(p.city) ?? 0) + 1);
    console.log(`\n${packets.length} noted venues → ${path}`);
    for (const [city, n] of [...byCity.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${city}`);
    }
  } finally {
    await sql.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
