/**
 * flagReview — the operator keep/hide actions behind /admin/flags.
 *
 * The audit (audit:data → data_audit.flags) surfaces venues whose stored windows look
 * fishy; this is where the operator adjudicates them. Both verdicts are RECORDED so the
 * rule catalog can learn from them later: resolutions `operator_kept` / `operator_hidden`
 * plus an audit_log row carrying the flag codes. Mining query for future gate rules:
 *   SELECT flags FROM data_audit WHERE resolution = 'operator_hidden'
 * — flag codes that keep predicting "operator hid it" are candidates for auto-hide in
 * the realness/reconcile gates (the "catch them for the future" loop).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { db } from "@/db/client";
import { auditLog, dataAudit, happyHours, venues } from "@/db/schema";
import { adminActor } from "@/lib/apply/types";
import type { AnomalyFlag } from "@/lib/audit/anomalyRules";

/** The shared client or a transaction handle (same query-builder surface). */
type Dbx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export interface HideWindowResult {
  venueId: string;
  /** True when hiding this window left the venue with no active windows → demoted to stub. */
  venueDemoted: boolean;
}

/** Operator verdict: the flagged data is CORRECT. Marks the venue reviewed so it stops
 *  resurfacing, and audit-logs the decision with the flag codes that were overruled. */
export async function keepFlaggedVenue(
  dbx: Dbx,
  { venueId, adminEmail, note }: { venueId: string; adminEmail: string; note?: string },
): Promise<void> {
  const [da] = await dbx.select().from(dataAudit).where(eq(dataAudit.venueId, venueId)).limit(1);
  if (!da) throw new Error("No data_audit row for venue");
  const flags = (da.flags ?? []) as AnomalyFlag[];
  await dbx
    .update(dataAudit)
    .set({ resolution: "operator_kept", agentVerdict: note ?? da.agentVerdict })
    .where(eq(dataAudit.venueId, venueId));
  await dbx.insert(auditLog).values({
    tableName: "data_audit",
    rowId: da.id,
    beforeJsonb: { resolution: da.resolution },
    afterJsonb: { resolution: "operator_kept" },
    actor: adminActor(adminEmail),
    reason: `Flag review: kept (flags overruled: ${flags.map((f) => f.code).join(", ") || "none"})`,
  });
}

/** Operator verdict: NOT SURE YET — park the venue in the "Further review" lane with a
 *  free-text note. Re-running updates the note. The venue leaves the main queue but stays
 *  unresolved (resolution `further_review`); Keep/Hide from the lane settles it. */
export async function markForFurtherReview(
  dbx: Dbx,
  { venueId, adminEmail, note }: { venueId: string; adminEmail: string; note: string },
): Promise<void> {
  const [da] = await dbx.select().from(dataAudit).where(eq(dataAudit.venueId, venueId)).limit(1);
  if (!da) throw new Error("No data_audit row for venue");
  await dbx
    .update(dataAudit)
    .set({ resolution: "further_review", operatorNote: note })
    .where(eq(dataAudit.venueId, venueId));
  await dbx.insert(auditLog).values({
    tableName: "data_audit",
    rowId: da.id,
    beforeJsonb: { resolution: da.resolution, operatorNote: da.operatorNote },
    afterJsonb: { resolution: "further_review", operatorNote: note },
    actor: adminActor(adminEmail),
    reason: "Flag review: parked for further review",
  });
}

/** Operator verdict: the window is WRONG. Reversible hide (active=false, never deletes),
 *  audit-logged; demotes the venue to stub when its last active window goes dark (same
 *  policy as reconcile:windows). */
export async function hideWindowForFlag(
  dbx: Dbx,
  { happyHourId, adminEmail, reason }: { happyHourId: string; adminEmail: string; reason?: string },
): Promise<HideWindowResult> {
  const [win] = await dbx
    .select({ id: happyHours.id, venueId: happyHours.venueId, active: happyHours.active })
    .from(happyHours)
    .where(eq(happyHours.id, happyHourId))
    .limit(1);
  if (!win) throw new Error("Window not found");

  await dbx
    .update(happyHours)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(happyHours.id, happyHourId));
  await dbx.insert(auditLog).values({
    tableName: "happy_hours",
    rowId: happyHourId,
    beforeJsonb: { active: win.active },
    afterJsonb: { active: false },
    actor: adminActor(adminEmail),
    reason: reason ?? "Flag review: window hidden (flagged data judged wrong)",
  });

  const remaining = await dbx
    .select({ id: happyHours.id })
    .from(happyHours)
    .where(and(eq(happyHours.venueId, win.venueId), eq(happyHours.active, true), isNull(happyHours.deletedAt)))
    .limit(1);
  let venueDemoted = false;
  if (remaining.length === 0) {
    // 'verified' demotes too — a venue with zero active windows must not keep rendering
    // as verified (Woven Seafood stayed 'verified' after its last window hid, 2026-06-10).
    const demoted = await dbx
      .update(venues)
      .set({ dataCompleteness: "stub", updatedAt: new Date() })
      .where(and(eq(venues.id, win.venueId), inArray(venues.dataCompleteness, ["complete", "verified"])))
      .returning({ id: venues.id });
    venueDemoted = demoted.length > 0;
    // Only settle the audit row when the venue has nothing active left. Settling on the
    // FIRST hide dropped the venue from the queue with its other flagged windows still
    // live — the operator couldn't hide a second window (Book Society, 2026-06-10). With
    // windows remaining, the venue stays in the queue; Keep settles it once what's left
    // is correct.
    await dbx
      .update(dataAudit)
      .set({ resolution: "operator_hidden" })
      .where(eq(dataAudit.venueId, win.venueId));
  }

  return { venueId: win.venueId, venueDemoted };
}

/** Operator verdict: the whole venue's HH data is WRONG. Hides every active window
 *  (audit-logged per window, so each is individually reversible and the eval-corpus
 *  export still reconstructs them), demotes the venue to stub, settles the audit row. */
export async function stubVenueForFlag(
  dbx: Dbx,
  { venueId, adminEmail, reason }: { venueId: string; adminEmail: string; reason?: string },
): Promise<{ hiddenCount: number; venueDemoted: boolean }> {
  const wins = await dbx
    .select({ id: happyHours.id })
    .from(happyHours)
    .where(and(eq(happyHours.venueId, venueId), eq(happyHours.active, true), isNull(happyHours.deletedAt)));

  let venueDemoted = false;
  for (const [i, w] of wins.entries()) {
    const res = await hideWindowForFlag(dbx, {
      happyHourId: w.id,
      adminEmail,
      reason: reason ?? `Flag review: venue stubbed — all windows hidden (${i + 1}/${wins.length})`,
    });
    venueDemoted = res.venueDemoted;
  }
  // No active windows to begin with: still settle the audit row so the venue stops
  // resurfacing (hideWindowForFlag handles it whenever it hides the last one).
  if (wins.length === 0) {
    await dbx.update(dataAudit).set({ resolution: "operator_hidden" }).where(eq(dataAudit.venueId, venueId));
  }
  return { hiddenCount: wins.length, venueDemoted };
}
