/**
 * Integration test for the audit:fix apply step. Builds a london-shaped venue + 2 stored
 * windows in a transaction, applies computeCorrection's plan with the SAME SQL audit-fix.ts
 * uses, asserts the end-state, and ROLLS BACK (DB unchanged). Needs a live Postgres
 * (DATABASE_URL). Run: pnpm tsx scripts/test-audit-fix.ts — exits non-zero on any failure.
 * NOT in CI (needs a DB).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { computeCorrection, type StoredRow, type CorrectedWindow } from "@/lib/audit/computeCorrection";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  let passed = 0;
  try {
    await sql
      .begin(async (tx) => {
        // Throwaway city — required NOT-NULL cols verified against db/schema/core.ts.
        const [city] = await tx<{ id: string }[]>`
          INSERT INTO cities (name, slug, state, country, default_timezone, currency_code)
          VALUES ('AuditVille', 'auditville-fix', 'CA', 'US', 'America/Los_Angeles', 'USD')
          RETURNING id`;

        // Throwaway venue — status + data_completeness have DB defaults ('active', 'stub').
        const [venue] = await tx<{ id: string }[]>`
          INSERT INTO venues (city_id, name, slug, website_url)
          VALUES (${city.id}, 'London Test', 'london-test', 'https://example.com')
          RETURNING id`;

        // home window: Mon–Fri 16:00–19:00, source https://example.com/, has "days assumed" note.
        const [home] = await tx<{ id: string }[]>`
          INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time, all_day, location_within_venue, notes, active, source_url, time_known)
          VALUES (${venue.id}, '{1,2,3,4,5}', '16:00', '19:00', false, 'all', 'days assumed Mon–Fri (none stated)', true, 'https://example.com/', true)
          RETURNING id`;

        // menu window: Mon–Fri 18:00–21:00, source https://example.com/menu/, also active.
        const [menu] = await tx<{ id: string }[]>`
          INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time, all_day, location_within_venue, notes, active, source_url, time_known)
          VALUES (${venue.id}, '{1,2,3,4,5}', '18:00', '21:00', false, 'all', 'days assumed Mon–Fri (none stated)', true, 'https://example.com/menu/', true)
          RETURNING id`;

        // Read stored rows as computeCorrection expects (camelCase aliases, matches audit-fix.ts query).
        const stored = await tx<StoredRow[]>`
          SELECT id, days_of_week AS "daysOfWeek", start_time AS "startTime", end_time AS "endTime",
                 all_day AS "allDay", active, source_url AS "sourceUrl", notes
          FROM happy_hours WHERE venue_id = ${venue.id} AND deleted_at IS NULL`;

        // Simulate the re-parse result with NO network — one hand-built window using parser-style
        // "HH:MM" times. computeCorrection normalises "16:00:00" (DB) vs "16:00" (parser) so they
        // match on the natural key.
        const corrected: CorrectedWindow[] = [
          {
            daysOfWeek: [1, 2, 3, 4, 5],
            startTime: "16:00",
            endTime: "19:00",
            allDay: false,
            sourceUrl: "https://example.com/happy-hour/",
            notes: null,
          },
        ];

        const plan = computeCorrection(stored, corrected);

        // Plan shape assertions.
        assert.equal(plan.updates.length, 1, "exactly one update in plan");
        assert.equal(plan.updates[0].id, home.id, "the update targets the home (16–19) row");
        assert.deepEqual(plan.deactivations, [menu.id], "the menu (18–21) row is scheduled for deactivation");
        assert.equal(plan.inserts.length, 0, "no inserts (window already stored)");
        passed += 4;
        console.log("  ✓ computeCorrection plan: 1 update (home), 1 deactivation (menu), 0 inserts");

        // APPLY — byte-for-byte the same SQL as scripts/audit-fix.ts (read 2026-06-08).
        // Update loop: re-read before-snapshot, apply SET, write audit_log.
        for (const u of plan.updates) {
          const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${u.id}`;
          await tx`UPDATE happy_hours SET source_url=${u.sourceUrl}, notes=${u.notes}, active=true, updated_at=now() WHERE id=${u.id}`;
          await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                   VALUES ('happy_hours', ${u.id}, ${tx.json(before as never)}, ${tx.json({ source_url: u.sourceUrl, notes: u.notes, active: true } as never)}, 'audit-fix', 'data audit: provenance correction')`;
        }

        // Deactivation loop: re-read before-snapshot, apply SET active=false, write audit_log.
        for (const id of plan.deactivations) {
          const [before] = await tx`SELECT source_url, notes, active FROM happy_hours WHERE id=${id}`;
          await tx`UPDATE happy_hours SET active=false, updated_at=now() WHERE id=${id}`;
          await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
                   VALUES ('happy_hours', ${id}, ${tx.json(before as never)}, ${tx.json({ source_url: before.source_url, notes: before.notes, active: false } as never)}, 'audit-fix', 'data audit: deactivate spurious window')`;
        }

        // No insert loop — plan.inserts is empty for this london-shaped fixture.

        // Assert DB end-state.
        const active = await tx<{ id: string; source_url: string; notes: string | null }[]>`
          SELECT id, source_url, notes FROM happy_hours WHERE venue_id=${venue.id} AND active=true`;
        assert.equal(active.length, 1, "exactly one active window remains");
        assert.equal(active[0].id, home.id, "the 16–19 window survives as the only active row");
        assert.equal(active[0].source_url, "https://example.com/happy-hour/", "source_url corrected to /happy-hour/");
        assert.equal(active[0].notes, null, "assumed-days note cleared to null");
        passed += 4;
        console.log("  ✓ home row: active, source /happy-hour/, notes=null");

        const [menuRow] = await tx<{ active: boolean }[]>`SELECT active FROM happy_hours WHERE id=${menu.id}`;
        assert.equal(menuRow.active, false, "menu (18–21) row is now active=false");
        passed += 1;
        console.log("  ✓ menu row deactivated (active=false)");

        const audits = await tx<{ c: string }[]>`
          SELECT count(*)::text AS c FROM audit_log
          WHERE actor='audit-fix' AND row_id IN (${home.id}, ${menu.id})`;
        assert.equal(audits[0].c, "2", "exactly two audit_log rows written by actor=audit-fix");
        passed += 1;
        console.log("  ✓ audit_log: 2 rows (1 provenance correction + 1 deactivation)");

        // Roll back: throw a sentinel so sql.begin aborts the transaction and the DB is unchanged.
        throw new Error("ROLLBACK");
      })
      .catch((e) => {
        if ((e as Error).message !== "ROLLBACK") throw e;
      });

    console.log(`\n✓ ${passed} audit-fix integration assertions passed (rolled back).`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
