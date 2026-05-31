/**
 * Adversarially re-verify every "all-day" happy hour and either report or apply.
 *
 * Phase A one-time cleanup. TWO modes:
 *
 * REPORT (default): re-check every all-day window with the adversarial AI
 * verifier and write a reviewable report to docs/. NO DB writes.
 *   npx tsx scripts/reverify-all-day.ts [--city <slug>] [--limit N]
 *
 * APPLY: execute the operator-reviewed report in ONE audited transaction.
 *   npx tsx scripts/reverify-all-day.ts --apply docs/all-day-review-<date>.json
 *
 * The script never decides to delete on its own — apply only does what the
 * reviewed JSON says. Every mutation writes an audit_log row (revertible).
 *
 * Required env: DATABASE_URL (both modes); ANTHROPIC_API_KEY (report mode only).
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

import postgres from "postgres";

import { reverifyAllDay } from "@/lib/reverify/adversarial";
import {
  buildReportEntries,
  parseJson,
  toJson,
  toMarkdown,
  type ReverifyRow,
} from "@/lib/reverify/report";
import type { Verdict } from "@/lib/reverify/policy";
import { recordUsage } from "@/lib/ai/ledger";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface DbRow {
  happyHourId: string;
  venueId: string;
  venueName: string;
  citySlug: string;
  daysOfWeek: number[] | null;
  websiteUrl: string | null;
  sourceUrl: string | null;
  address: string | null;
}

async function runReport() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY is required for report mode.");
    process.exit(1);
  }

  const citySlug = arg("--city");
  const limitRaw = arg("--limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    console.error("ERROR: --limit must be a positive number.");
    process.exit(1);
  }

  const sql = postgres(dbUrl, { max: 4 });

  try {
    const rows = await sql<DbRow[]>`
      SELECT
        hh.id            AS "happyHourId",
        v.id             AS "venueId",
        v.name           AS "venueName",
        c.slug           AS "citySlug",
        hh.days_of_week  AS "daysOfWeek",
        v.website_url    AS "websiteUrl",
        hh.source_url    AS "sourceUrl",
        v.address        AS "address"
      FROM happy_hours hh
      JOIN venues v ON v.id = hh.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE hh.all_day = true
        AND hh.deleted_at IS NULL
        AND v.deleted_at IS NULL
        ${citySlug ? sql`AND c.slug = ${citySlug}` : sql``}
      ORDER BY c.slug, v.name
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    console.log(`Found ${rows.length} all-day window(s) to re-verify.`);
    if (rows.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    const verdicts: (Verdict | null)[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const days = row.daysOfWeek ?? [];
      process.stdout.write(`  [${i + 1}/${rows.length}] ${row.venueName} … `);
      const res = await reverifyAllDay({
        venueName: row.venueName,
        address: row.address,
        websiteUrl: row.websiteUrl,
        currentDays: days,
        sourceUrl: row.sourceUrl,
      });
      await recordUsage({
        stage: "seed",
        model: res.model,
        usage: res.usage,
        costCents: res.costCents,
        promptHash: res.promptHash,
      });
      verdicts.push(res.verdict);
      console.log(res.verdict ? res.verdict.kind : "no-verdict");
    }

    const reverifyRows: ReverifyRow[] = rows.map((r) => ({
      happyHourId: r.happyHourId,
      venueId: r.venueId,
      venueName: r.venueName,
      city: r.citySlug,
      currentDays: r.daysOfWeek ?? [],
      sourceUrl: r.sourceUrl,
    }));

    const entries = buildReportEntries(reverifyRows, verdicts);
    const stamp = new Date().toISOString().slice(0, 10);
    const jsonPath = `docs/all-day-review-${stamp}.json`;
    const mdPath = `docs/all-day-review-${stamp}.md`;
    writeFileSync(jsonPath, toJson(entries));
    writeFileSync(mdPath, toMarkdown(entries));

    console.log("");
    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);
    console.log("");
    console.log(
      "Review/edit the .json's `action` fields (keep | correct | stub | delete_venue),",
    );
    console.log(
      `then apply with:  npx tsx scripts/reverify-all-day.ts --apply ${jsonPath}`,
    );
  } finally {
    await sql.end();
  }
}

async function runApply(path: string) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }

  // parseJson validates every entry's `action` and throws on a typo — let it throw.
  const entries = parseJson(readFileSync(path, "utf8"));
  console.log(`Loaded ${entries.length} reviewed entries from ${path}`);

  const counts: Record<string, number> = {
    keep: 0,
    correct: 0,
    stub: 0,
    delete_venue: 0,
    skipped: 0,
  };

  const sql = postgres(dbUrl, { max: 1 });

  try {
    await sql.begin(async (tx) => {
      for (const e of entries) {
        const reason = `all-day reverify: ${e.verdict.kind}`;

        if (e.action === "keep") {
          counts.keep++;
          continue;
        }

        if (e.action === "correct") {
          if (e.verdict.kind !== "real_window") {
            console.warn(
              `  SKIP correct for ${e.venueName}: verdict is "${e.verdict.kind}", not real_window`,
            );
            counts.skipped++;
            continue;
          }
          const verdictDays = [...new Set(e.verdict.daysOfWeek)].sort(
            (a, b) => a - b,
          );
          const days = verdictDays.length > 0 ? verdictDays : e.currentDays;
          const before = await tx`
            SELECT * FROM happy_hours WHERE id = ${e.happyHourId}
          `;
          await tx`
            UPDATE happy_hours SET
              all_day = false,
              start_time = ${e.verdict.startTime},
              end_time = ${e.verdict.endTime},
              days_of_week = ${days},
              source_url = COALESCE(${e.verdict.sourceUrl}, source_url),
              updated_at = now()
            WHERE id = ${e.happyHourId}
          `;
          const after = await tx`
            SELECT * FROM happy_hours WHERE id = ${e.happyHourId}
          `;
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('happy_hours', ${e.happyHourId}, ${tx.json(before[0])}, ${tx.json(after[0])}, 'operator', ${reason})
          `;
          counts.correct++;
          continue;
        }

        if (e.action === "stub") {
          const before = await tx`
            SELECT * FROM happy_hours WHERE id = ${e.happyHourId}
          `;
          await tx`
            UPDATE offerings SET deleted_at = now()
            WHERE happy_hour_id = ${e.happyHourId} AND deleted_at IS NULL
          `;
          await tx`
            UPDATE happy_hours SET deleted_at = now() WHERE id = ${e.happyHourId}
          `;
          const after = { ...before[0], deleted_at: "now" };
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('happy_hours', ${e.happyHourId}, ${tx.json(before[0])}, ${tx.json(after)}, 'operator', ${reason})
          `;
          // If the venue has no live windows left, mark it a help-wanted stub.
          const remaining = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM happy_hours
            WHERE venue_id = ${e.venueId} AND deleted_at IS NULL
          `;
          if (remaining[0].n === 0) {
            await tx`
              UPDATE venues SET data_completeness = 'stub' WHERE id = ${e.venueId}
            `;
          }
          counts.stub++;
          continue;
        }

        if (e.action === "delete_venue") {
          const before = await tx`
            SELECT * FROM venues WHERE id = ${e.venueId}
          `;
          await tx`
            UPDATE offerings o SET deleted_at = now()
            FROM happy_hours hh
            WHERE hh.id = o.happy_hour_id
              AND hh.venue_id = ${e.venueId}
              AND o.deleted_at IS NULL
          `;
          await tx`
            UPDATE happy_hours SET deleted_at = now()
            WHERE venue_id = ${e.venueId} AND deleted_at IS NULL
          `;
          await tx`
            UPDATE venues SET deleted_at = now(), status = 'closed'
            WHERE id = ${e.venueId}
          `;
          const after = { ...before[0], deleted_at: "now", status: "closed" };
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('venues', ${e.venueId}, ${tx.json(before[0])}, ${tx.json(after)}, 'operator', ${reason})
          `;
          counts.delete_venue++;
          continue;
        }
      }
    });

    console.log("Applied (transaction committed):");
    console.log(`  keep:         ${counts.keep}`);
    console.log(`  correct:      ${counts.correct}`);
    console.log(`  stub:         ${counts.stub}`);
    console.log(`  delete_venue: ${counts.delete_venue}`);
    if (counts.skipped > 0) console.log(`  skipped:      ${counts.skipped}`);
  } finally {
    await sql.end();
  }
}

const applyPath = arg("--apply");
(applyPath ? runApply(applyPath) : runReport()).catch((e) => {
  console.error(e);
  process.exit(1);
});
