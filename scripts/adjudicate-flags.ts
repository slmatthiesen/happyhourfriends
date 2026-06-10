/**
 * adjudicate:flags — run the agentic flag adjudicator (lib/audit/adjudicateFlag) over
 * flagged venues and report verdicts. READ-ONLY on venue data: the only DB write is the
 * ai_usage_ledger row per model call. Applying verdicts stays a separate, operator-gated
 * step (see lib/audit/flagReview).
 *
 * Modes:
 *   --eval               venues parked 'further_review' (operator notes exist). The model
 *                        NEVER sees the notes; they print beside its verdict afterward, so
 *                        the operator's manual review doubles as a golden eval set.
 *   --queue [--limit N]  venues with resolution 'scanned' (the unreviewed flag queue).
 *   --venue <uuid>       one venue regardless of resolution.
 *
 * Cost: ~1–2¢ per venue (one Haiku compare; page fetch + render are $0).
 * Usage: pnpm tsx scripts/adjudicate-flags.ts --eval
 *        pnpm tsx scripts/adjudicate-flags.ts --queue --limit 20
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { triageSite } from "@/lib/places/siteTriage";
import { fetchPages } from "@/lib/ai/siteContent";
import {
  adjudicateFlaggedVenue,
  type AdjudicationInput,
  type StoredWindow,
} from "@/lib/audit/adjudicateFlag";
import { firstOfCurrentMonth } from "@/lib/ai/budget";

const EVAL = process.argv.includes("--eval");
const QUEUE = process.argv.includes("--queue");
const argOf = (f: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const VENUE = argOf("--venue");
const LIMIT = argOf("--limit") ? parseInt(argOf("--limit")!, 10) : null;

interface FlaggedVenueRow {
  venue_id: string;
  name: string;
  website_url: string | null;
  address: string | null;
  city_id: string;
  city_name: string;
  operator_note: string | null;
  flags: unknown;
}

async function fetchOwnPages(websiteUrl: string | null, name: string, cityName: string | null) {
  if (!websiteUrl) return [];
  const verdict = await triageSite({ websiteUri: websiteUrl, name, cityName });
  // Confirmed HH links first (anchors/Wix routes that exist), then the speculative guesses.
  const priority =
    verdict.kind === "real"
      ? [...new Set([...verdict.confirmedHhUrls, ...verdict.hhSignalUrls])].slice(0, 4)
      : [];
  // Lazy renderUrl import mirrors buildExtractRequest — playwright stays out of the
  // app bundle and a missing Chromium degrades to plain fetch.
  let render: typeof import("@/lib/verification/renderUrl").renderUrl | undefined;
  if (process.env.DISABLE_HEADLESS_RENDER !== "1") {
    try {
      render = (await import("@/lib/verification/renderUrl")).renderUrl;
    } catch {
      render = undefined;
    }
  }
  return fetchPages([websiteUrl, ...priority], 5, { maxContent: 12_000, render });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  if (!EVAL && !QUEUE && !VENUE) throw new Error("pass --eval, --queue, or --venue <uuid>");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  try {
    const rows = await sql<FlaggedVenueRow[]>`
      SELECT da.venue_id, v.name, v.website_url, v.address, v.city_id, c.name AS city_name,
             da.operator_note, da.flags
      FROM data_audit da
      JOIN venues v ON v.id = da.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE v.deleted_at IS NULL
        AND ${
          VENUE
            ? sql`da.venue_id = ${VENUE}`
            : EVAL
              ? sql`da.resolution = 'further_review'`
              : sql`da.resolution = 'scanned'`
        }
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
    `;
    console.log(`${rows.length} flagged venue(s) to adjudicate (${EVAL ? "eval" : QUEUE ? "queue" : "single"} mode).\n`);

    const report: object[] = [];
    let spentCents = 0;

    for (const r of rows) {
      const windows = await sql<
        { id: string; days_of_week: number[]; start_time: string | null; end_time: string | null; all_day: boolean; source_url: string | null; notes: string | null }[]
      >`
        SELECT id, days_of_week, start_time, end_time, all_day, source_url, notes
        FROM happy_hours
        WHERE venue_id = ${r.venue_id} AND active AND deleted_at IS NULL
        ORDER BY start_time NULLS LAST
      `;
      const stored: StoredWindow[] = [];
      for (const w of windows) {
        const offs = await sql<
          { kind: string; category: string; name: string | null; price_cents: number | null; description: string | null }[]
        >`
          SELECT kind::text, category::text, name, price_cents, description
          FROM offerings WHERE happy_hour_id = ${w.id} AND active AND deleted_at IS NULL
        `;
        stored.push({
          daysOfWeek: w.days_of_week,
          startTime: w.start_time,
          endTime: w.end_time,
          allDay: w.all_day,
          sourceUrl: w.source_url,
          notes: w.notes,
          offerings: offs.map((o) => ({
            kind: o.kind,
            category: o.category,
            name: o.name,
            priceCents: o.price_cents,
            description: o.description,
          })),
        });
      }

      const pages = await fetchOwnPages(r.website_url, r.name, r.city_name);
      const input: AdjudicationInput = {
        venueName: r.name,
        websiteUrl: r.website_url,
        address: r.address,
        windows: stored,
        pages,
      };
      const res = await adjudicateFlaggedVenue(input);
      spentCents += res.costCents;

      if (res.costCents > 0) {
        await sql`
          INSERT INTO ai_usage_ledger (month, model, input_tokens, output_tokens, cost_cents, stage, city_id, prompt_hash)
          VALUES (${firstOfCurrentMonth()}, ${res.model}, ${res.usage.inputTokens}, ${res.usage.outputTokens},
                  ${res.costCents}, 'verify', ${r.city_id}, ${res.promptHash})
        `;
      }

      console.log(`── ${r.name} ─ verdict: ${res.verdict.toUpperCase()} → ${res.recommendedAction}`);
      if (res.siteSchedule) console.log(`   site says: ${res.siteSchedule}`);
      if (res.evidence) console.log(`   evidence:  "${res.evidence}"`);
      console.log(`   reason:    ${res.reason}`);
      for (const f of res.screens.policyHits) console.log(`   POLICY:    ${f}`);
      for (const f of res.screens.findings) console.log(`   screen:    ${f}`);
      if (EVAL && r.operator_note) {
        console.log(`   operator:  ${r.operator_note.replace(/\s+/g, " ").slice(0, 180)}`);
      }
      console.log("");

      report.push({
        venueId: r.venue_id,
        venue: r.name,
        verdict: res.verdict,
        recommendedAction: res.recommendedAction,
        siteSchedule: res.siteSchedule,
        evidence: res.evidence,
        reason: res.reason,
        screens: res.screens,
        pagesJudged: res.pagesJudged,
        operatorNote: EVAL ? r.operator_note : undefined,
        stored,
        costCents: res.costCents,
      });
    }

    mkdirSync("docs/audits", { recursive: true });
    const out = `docs/audits/flag-adjudication-${EVAL ? "eval" : "queue"}-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`── done ── ${rows.length} venue(s), spend $${(spentCents / 100).toFixed(2)}, report → ${out}`);
  } finally {
    await sql.end();
    await (await import("@/lib/verification/renderUrl")).closeRenderBrowser().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
