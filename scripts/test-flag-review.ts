/**
 * Integration test for the /admin/flags review actions (lib/audit/flagReview.ts).
 * Builds a flagged venue + windows in a drizzle transaction, exercises keep/hide,
 * asserts end-state + audit_log rows, and ROLLS BACK (DB unchanged). Needs a live
 * Postgres (DATABASE_URL). Run: pnpm tsx scripts/test-flag-review.ts — exits non-zero
 * on any failure. NOT in CI (needs a DB).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, cities, dataAudit, happyHours, venues } from "@/db/schema";
import { hideWindowForFlag, keepFlaggedVenue } from "@/lib/audit/flagReview";

const ROLLBACK = new Error("__rollback__");
let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  await db
    .transaction(async (tx) => {
      const [city] = await tx
        .insert(cities)
        .values({ name: "FlagVille", slug: "flagville-review", state: "CA", country: "US", defaultTimezone: "America/Los_Angeles", currencyCode: "USD" })
        .returning({ id: cities.id });
      const [venue] = await tx
        .insert(venues)
        .values({ cityId: city.id, name: "Flagged Test Venue", slug: "flagged-test-venue", websiteUrl: "https://example.com", dataCompleteness: "complete" })
        .returning({ id: venues.id });
      const [win] = await tx
        .insert(happyHours)
        .values({ venueId: venue.id, daysOfWeek: [1, 2, 3, 4, 5], startTime: "11:00", endTime: "21:00", allDay: false, locationWithinVenue: "all", active: true, sourceUrl: "https://example.com/promo.pdf", timeKnown: true })
        .returning({ id: happyHours.id });
      await tx.insert(dataAudit).values({
        venueId: venue.id,
        flags: [{ code: "implausible_active", severity: "auto_fixable", evidence: "active window 11:00–21:00 is implausible" }],
        resolution: "scanned",
      });

      // --- keep: marks the venue reviewed, records an audit_log row with the flag codes ---
      await keepFlaggedVenue(tx, { venueId: venue.id, adminEmail: "test@example.com" });
      const [daAfterKeep] = await tx.select().from(dataAudit).where(eq(dataAudit.venueId, venue.id));
      assert.equal(daAfterKeep.resolution, "operator_kept");
      check("keepFlaggedVenue sets resolution=operator_kept");
      const keepLogs = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "data_audit"), eq(auditLog.rowId, daAfterKeep.id)));
      assert.equal(keepLogs.length, 1);
      assert.ok(keepLogs[0].reason?.includes("implausible_active"), `reason should carry flag codes: ${keepLogs[0].reason}`);
      check("keep writes an audit_log row carrying the flag codes");

      // Re-arm for the hide path.
      await tx.update(dataAudit).set({ resolution: "scanned" }).where(eq(dataAudit.venueId, venue.id));

      // --- hide: flips active=false, audits it, demotes the venue when its last window hides ---
      const res = await hideWindowForFlag(tx, { happyHourId: win.id, adminEmail: "test@example.com" });
      const [winAfter] = await tx.select({ active: happyHours.active }).from(happyHours).where(eq(happyHours.id, win.id));
      assert.equal(winAfter.active, false);
      check("hideWindowForFlag flips the window inactive");
      const hideLogs = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tableName, "happy_hours"), eq(auditLog.rowId, win.id)));
      assert.equal(hideLogs.length, 1);
      assert.deepEqual(hideLogs[0].beforeJsonb, { active: true });
      assert.deepEqual(hideLogs[0].afterJsonb, { active: false });
      check("hide writes a reversible audit_log row (before/after active)");
      assert.equal(res.venueDemoted, true);
      const [vAfter] = await tx.select({ dc: venues.dataCompleteness }).from(venues).where(eq(venues.id, venue.id));
      assert.equal(vAfter.dc, "stub");
      check("hiding the last active window demotes the venue to stub");
      const [daAfterHide] = await tx.select().from(dataAudit).where(eq(dataAudit.venueId, venue.id));
      assert.equal(daAfterHide.resolution, "operator_hidden");
      check("hide sets resolution=operator_hidden (mineable for future gate rules)");

      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  console.log(`\n✓ ${passed} flag-review integration assertions passed (rolled back).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
