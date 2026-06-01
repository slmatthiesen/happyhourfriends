/**
 * One-time, operator-gated review of existing ALL-DAY happy-hour rows.
 *
 *   Report (no DB writes):
 *     npx tsx scripts/reverify-all-day.ts [--city <slug>] [--limit N]
 *   → writes docs/all-day-review-<YYYY-MM-DD>.{json,md}
 *
 *   Apply (after you review + edit the .json's `action` fields):
 *     npx tsx scripts/reverify-all-day.ts --apply docs/all-day-review-<date>.json
 *   → corrects / stubs / deletes per the (operator-approved) actions, writing audit_log.
 *
 * Requires DATABASE_URL; the report phase also needs ANTHROPIC_API_KEY.
 * delete_venue is performed ONLY if the json still says action: "delete_venue".
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { reverifyAllDay } from "@/lib/reverify/adversarial";
import {
  buildReportEntries,
  toJson,
  toMarkdown,
  parseJson,
  type ReverifyRow,
} from "@/lib/reverify/report";
import type { Verdict } from "@/lib/reverify/policy";
import { recordUsage } from "@/lib/ai/ledger";

const DATABASE_URL = process.env.DATABASE_URL;

const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const applyPath = argValue("--apply");
const citySlug = argValue("--city");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;

// A YYYY-MM-DD stamp. tsx scripts run ad-hoc, so OS date is fine here.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runReport() {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY is required for the report phase.");
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, { max: 4 });
  try {
    const rows = await sql<
      {
        happy_hour_id: string;
        venue_id: string;
        venue_name: string;
        city: string;
        days_of_week: number[];
        website_url: string | null;
        source_url: string | null;
        address: string | null;
      }[]
    >`
      SELECT hh.id AS happy_hour_id, v.id AS venue_id, v.name AS venue_name,
             c.slug AS city, hh.days_of_week, v.website_url, hh.source_url, v.address
      FROM happy_hours hh
      JOIN venues v ON v.id = hh.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE hh.all_day = true AND hh.deleted_at IS NULL AND v.deleted_at IS NULL
        ${citySlug ? sql`AND c.slug = ${citySlug}` : sql``}
      ORDER BY c.slug, v.name
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    console.log(`Reviewing ${rows.length} all-day window(s)…`);
    const reverifyRows: ReverifyRow[] = [];
    const verdicts: (Verdict | null)[] = [];
    for (const r of rows) {
      console.log(`  · ${r.venue_name} (${r.city})…`);
      // Isolate per-venue failures: one venue's AI/network error must not abort the
      // whole batch. A null verdict becomes an "unconfirmable" entry in the report.
      let verdict: Verdict | null = null;
      try {
        const res = await reverifyAllDay({
          venueName: r.venue_name,
          address: r.address,
          websiteUrl: r.website_url,
          currentDays: r.days_of_week,
          sourceUrl: r.source_url,
        });
        await recordUsage({
          stage: "reverify_cron",
          model: res.model,
          usage: res.usage,
          costCents: res.costCents,
          promptHash: res.promptHash,
        });
        verdict = res.verdict;
        console.log(`      → ${verdict?.kind ?? "no verdict"}`);
      } catch (err) {
        console.error(`      ! failed, leaving unconfirmable: ${(err as Error).message}`);
      }
      reverifyRows.push({
        happyHourId: r.happy_hour_id,
        venueId: r.venue_id,
        venueName: r.venue_name,
        city: r.city,
        currentDays: r.days_of_week,
        sourceUrl: r.source_url,
      });
      verdicts.push(verdict);
    }

    const entries = buildReportEntries(reverifyRows, verdicts);
    const stamp = today();
    writeFileSync(`docs/all-day-review-${stamp}.json`, toJson(entries));
    writeFileSync(`docs/all-day-review-${stamp}.md`, toMarkdown(entries));
    console.log(
      `\nWrote docs/all-day-review-${stamp}.{json,md}. Review, edit \`action\` fields in the .json, then run with --apply.`,
    );
  } finally {
    await sql.end();
  }
}

async function runApply(path: string) {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const entries = parseJson(readFileSync(path, "utf8"));
  const sql = postgres(DATABASE_URL, { max: 1 });
  const counts: Record<string, number> = {};
  const reason = (kind: string) => `all-day reverify: ${kind}`;
  try {
    await sql.begin(async (tx) => {
      for (const e of entries) {
        counts[e.action] = (counts[e.action] ?? 0) + 1;
        if (e.action === "keep") continue;

        if (e.action === "correct") {
          if (e.verdict.kind !== "real_window") {
            console.warn(`  skip correct (not real_window): ${e.venueName}`);
            continue;
          }
          const days =
            e.verdict.daysOfWeek.length > 0
              ? [...new Set(e.verdict.daysOfWeek)].sort((a, b) => a - b)
              : e.currentDays;
          const before = await tx`SELECT * FROM happy_hours WHERE id = ${e.happyHourId}`;
          await tx`
            UPDATE happy_hours
            SET all_day = false,
                start_time = ${e.verdict.startTime},
                end_time = ${e.verdict.endTime},
                days_of_week = ${days},
                source_url = COALESCE(${e.verdict.sourceUrl}, source_url),
                updated_at = now()
            WHERE id = ${e.happyHourId}
          `;
          const after = await tx`SELECT * FROM happy_hours WHERE id = ${e.happyHourId}`;
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('happy_hours', ${e.happyHourId}, ${tx.json(before[0])}, ${tx.json(after[0])}, 'operator', ${reason(e.verdict.kind)})
          `;
          continue;
        }

        if (e.action === "stub") {
          const before = await tx`SELECT * FROM happy_hours WHERE id = ${e.happyHourId}`;
          await tx`UPDATE offerings SET deleted_at = now() WHERE happy_hour_id = ${e.happyHourId} AND deleted_at IS NULL`;
          await tx`UPDATE happy_hours SET deleted_at = now() WHERE id = ${e.happyHourId}`;
          const after = await tx`SELECT * FROM happy_hours WHERE id = ${e.happyHourId}`;
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('happy_hours', ${e.happyHourId}, ${tx.json(before[0])}, ${tx.json(after[0])}, 'operator', ${reason(e.verdict.kind)})
          `;
          const [live] = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM happy_hours WHERE venue_id = ${e.venueId} AND deleted_at IS NULL
          `;
          if (live.n === 0) {
            await tx`UPDATE venues SET data_completeness = 'stub' WHERE id = ${e.venueId}`;
          }
          continue;
        }

        if (e.action === "delete_venue") {
          const before = await tx`SELECT * FROM venues WHERE id = ${e.venueId}`;
          await tx`
            UPDATE offerings o SET deleted_at = now()
            FROM happy_hours hh
            WHERE hh.id = o.happy_hour_id AND hh.venue_id = ${e.venueId} AND o.deleted_at IS NULL
          `;
          await tx`UPDATE happy_hours SET deleted_at = now() WHERE venue_id = ${e.venueId} AND deleted_at IS NULL`;
          await tx`UPDATE venues SET deleted_at = now(), status = 'closed' WHERE id = ${e.venueId}`;
          const after = await tx`SELECT * FROM venues WHERE id = ${e.venueId}`;
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('venues', ${e.venueId}, ${tx.json(before[0])}, ${tx.json(after[0])}, 'operator', ${reason(e.verdict.kind)})
          `;
          continue;
        }
      }
    });
    console.log("Applied:", counts);
  } finally {
    await sql.end();
  }
}

(applyPath ? runApply(applyPath) : runReport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
