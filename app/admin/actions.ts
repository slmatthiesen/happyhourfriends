"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLog, promotionTier, venues } from "@/db/schema";
import { requireAdmin } from "@/lib/admin/auth";
import {
  applySubmission,
  rejectSubmission,
  revertAudit,
  venueIdForRow,
} from "@/lib/apply/engine";
import { publishVenueToProd } from "@/lib/sync/publishVenueToProd";
import { adminActor } from "@/lib/apply/types";

type PromotionTier = (typeof promotionTier.enumValues)[number];

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set when the local apply succeeded but publishing to prod did not. */
  warning?: string;
}

/** Apply a pending submission, optionally with admin-edited values. */
export async function applyAction(
  submissionId: string,
  overrideAfter?: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const res = await applySubmission(
      submissionId,
      { actor: adminActor(admin.email) },
      overrideAfter && Object.keys(overrideAfter).length > 0
        ? overrideAfter
        : undefined,
    );
    revalidatePath("/admin");
    revalidatePath("/admin/audit");

    const venueId = await venueIdForRow(res.tableName, res.rowId);
    let warning: string | undefined;
    if (venueId) {
      const pub = await publishVenueToProd(venueId, submissionId);
      if (!pub.ok) warning = `Applied locally, but publishing to prod failed: ${pub.error}`;
    }
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Apply failed" };
  }
}

export async function rejectAction(
  submissionId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    await rejectSubmission(submissionId, {
      actor: adminActor(admin.email),
      reason,
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reject failed" };
  }
}

/** Manually set a venue's promotion tier + window (PRD §7, Phase 7). Recorded to
 *  audit_log like any other venue write. */
export async function setPromotionAction(
  venueId: string,
  tier: string,
  startsAt: string | null,
  endsAt: string | null,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    if (!(promotionTier.enumValues as readonly string[]).includes(tier)) {
      return { ok: false, error: "Invalid promotion tier" };
    }
    const [before] = await db
      .select({
        promotionTier: venues.promotionTier,
        promotionStartsAt: venues.promotionStartsAt,
        promotionEndsAt: venues.promotionEndsAt,
      })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!before) return { ok: false, error: "Venue not found" };

    const starts = startsAt ? new Date(startsAt) : null;
    const ends = endsAt ? new Date(endsAt) : null;
    await db
      .update(venues)
      .set({
        promotionTier: tier as PromotionTier,
        promotionStartsAt: starts,
        promotionEndsAt: ends,
      })
      .where(eq(venues.id, venueId));

    await db.insert(auditLog).values({
      tableName: "venues",
      rowId: venueId,
      beforeJsonb: before,
      afterJsonb: { promotionTier: tier, promotionStartsAt: starts, promotionEndsAt: ends },
      actor: adminActor(admin.email),
      reason: `Promotion set to ${tier}`,
    });

    revalidatePath("/admin/promotions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

export async function revertAction(auditId: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const res = await revertAudit(auditId, { actor: adminActor(admin.email) });
    revalidatePath("/admin/audit");
    revalidatePath("/admin");

    const venueId = await venueIdForRow(res.tableName, res.rowId);
    let warning: string | undefined;
    if (venueId) {
      const pub = await publishVenueToProd(venueId);
      if (!pub.ok) warning = `Reverted locally, but publishing the revert to prod failed: ${pub.error}`;
    }
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revert failed" };
  }
}

/** Flag review (/admin/flags): the flagged data is correct — stop surfacing this venue. */
export async function keepFlagAction(venueId: string, note?: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { keepFlaggedVenue } = await import("@/lib/audit/flagReview");
    await keepFlaggedVenue(db, { venueId, adminEmail: admin.email, note });
    revalidatePath("/admin/flags");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Keep failed" };
  }
}

/** Flag review (/admin/flags): not sure yet — park the venue in the Further-review lane
 *  with a note. Re-running updates the note. */
export async function furtherReviewAction(venueId: string, note: string): Promise<ActionResult> {
  try {
    if (!note.trim()) return { ok: false, error: "Note is required — what needs digging into?" };
    const admin = await requireAdmin();
    const { markForFurtherReview } = await import("@/lib/audit/flagReview");
    await markForFurtherReview(db, { venueId, adminEmail: admin.email, note: note.trim() });
    revalidatePath("/admin/flags");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Further review failed" };
  }
}

/** Flag review (/admin/flags): hide one wrong window (reversible via /admin/audit). */
export async function hideWindowAction(happyHourId: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { hideWindowForFlag } = await import("@/lib/audit/flagReview");
    const res = await hideWindowForFlag(db, { happyHourId, adminEmail: admin.email });
    revalidatePath("/admin/flags");
    revalidatePath("/");

    let warning: string | undefined;
    const pub = await publishVenueToProd(res.venueId);
    if (!pub.ok) warning = `Hidden locally, but publishing to prod failed: ${pub.error}`;
    if (res.venueDemoted) warning = `${warning ? warning + " · " : ""}Venue had no active windows left — demoted to stub.`;
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Hide failed" };
  }
}

/** Flag review (/admin/flags): the whole venue's HH data is wrong — hide every active
 *  window and demote the venue to a stub (each window reversible via /admin/audit). */
export async function stubVenueAction(venueId: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { stubVenueForFlag } = await import("@/lib/audit/flagReview");
    const res = await stubVenueForFlag(db, { venueId, adminEmail: admin.email });
    revalidatePath("/admin/flags");
    revalidatePath("/");

    let warning: string | undefined;
    const pub = await publishVenueToProd(venueId);
    if (!pub.ok) warning = `Stubbed locally, but publishing to prod failed: ${pub.error}`;
    return { ok: true, warning: warning ?? `${res.hiddenCount} window(s) hidden — venue is now a stub.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stub failed" };
  }
}

export interface ResolveStubResult extends ActionResult {
  recovered?: boolean;
  windowsLive?: number;
  windowsHidden?: number;
  costCents?: number;
  summary?: string;
}

/**
 * Stub Resolver action: extract happy hours for one stub venue, inline. With a url it
 * extracts from that exact menu/PDF/image; without one it auto-discovers via triage.
 * Runs the model synchronously (one deliberate operator click = one paid call).
 */
export async function resolveStubAction(
  venueId: string,
  url?: string,
): Promise<ResolveStubResult> {
  try {
    const admin = await requireAdmin();
    const { resolveVenue } = await import("@/lib/recover/resolveVenue");
    const r = await resolveVenue({
      venueId,
      urls: url && url.trim() ? [url.trim()] : [],
      actor: admin.email,
    });
    if (r.recovered) {
      revalidatePath("/admin/stubs");
      revalidatePath("/");
    }
    return {
      ok: r.ok,
      error: r.error,
      recovered: r.recovered,
      windowsLive: r.windowsLive,
      windowsHidden: r.windowsHidden,
      costCents: r.costCents,
      summary: r.summary,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resolve failed" };
  }
}

// ── /admin/reviews — live review queues (meal specials, hidden windows) ──────────

export type ReviewDecision = "keep" | "hide" | "delete" | "promote";

const REVIEW_REASONS: Record<"meal" | "hidden", string> = {
  meal: "meal-special review",
  hidden: "hidden-window review",
};

async function applyReviewDecision(
  happyHourId: string,
  decision: ReviewDecision,
  queue: "meal" | "hidden",
  adminEmail: string,
): Promise<{ venueId: string | null; venueDemoted: boolean }> {
  const { keepReviewWindow, deleteWindowForReview, promoteHiddenWindow } = await import(
    "@/lib/recover/reviewQueues"
  );
  switch (decision) {
    case "keep":
      await keepReviewWindow(db, { happyHourId, queue, adminEmail });
      return { venueId: null, venueDemoted: false };
    case "hide": {
      const { hideWindowForFlag } = await import("@/lib/audit/flagReview");
      const r = await hideWindowForFlag(db, {
        happyHourId,
        adminEmail,
        reason: `${REVIEW_REASONS[queue]}: operator hide`,
      });
      return r;
    }
    case "delete": {
      const r = await deleteWindowForReview(db, {
        happyHourId,
        adminEmail,
        reason: `${REVIEW_REASONS[queue]}: operator delete`,
      });
      return r;
    }
    case "promote": {
      const r = await promoteHiddenWindow(db, { happyHourId, adminEmail });
      return r;
    }
  }
}

export interface ReviewActionResult extends ActionResult {
  /** Per-decision tally for bulk calls, e.g. "3 hidden, 1 venue demoted to stub". */
  summary?: string;
}

/**
 * Apply one operator decision to one review-queue window. keep = dismiss from the
 * queue (audit marker only); hide = reversible active=false; delete = permanent
 * soft-delete (never re-inserted by re-extraction); promote = hidden window goes
 * LIVE (hidden queue only — set it only after verifying the happy hour yourself).
 */
export async function reviewWindowAction(
  happyHourId: string,
  decision: ReviewDecision,
  queue: "meal" | "hidden",
): Promise<ReviewActionResult> {
  return reviewWindowBulkAction([happyHourId], decision, queue);
}

/** Apply one decision to many windows (the queue UI's bulk bar). */
export async function reviewWindowBulkAction(
  happyHourIds: string[],
  decision: ReviewDecision,
  queue: "meal" | "hidden",
): Promise<ReviewActionResult> {
  try {
    const admin = await requireAdmin();
    if (happyHourIds.length === 0) return { ok: false, error: "No windows selected" };
    if (happyHourIds.length > 1000) return { ok: false, error: "Too many windows in one call (max 1000)" };
    if (decision === "promote" && queue !== "hidden") {
      return { ok: false, error: "Promote only applies to the hidden-window queue" };
    }

    let applied = 0;
    let demotedCount = 0;
    const failures: string[] = [];
    const touchedVenues = new Set<string>();
    for (const id of happyHourIds) {
      try {
        const r = await applyReviewDecision(id, decision, queue, admin.email);
        applied++;
        if (r.venueId) touchedVenues.add(r.venueId);
        if (r.venueDemoted) demotedCount++;
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }

    revalidatePath("/admin/reviews");
    if (decision !== "keep") revalidatePath("/");

    // Visibility changed locally → push each touched venue to prod (same per-venue
    // bridge every admin edit uses). Collect failures into one warning.
    let pubFailures = 0;
    for (const venueId of touchedVenues) {
      const pub = await publishVenueToProd(venueId);
      if (!pub.ok) pubFailures++;
    }

    const pastTense: Record<ReviewDecision, string> = {
      keep: "dismissed",
      hide: "hidden",
      delete: "deleted",
      promote: "promoted",
    };
    const parts: string[] = [`${applied} ${pastTense[decision]}`];
    if (demotedCount) parts.push(`${demotedCount} venue(s) demoted to stub`);
    const warnings: string[] = [];
    if (failures.length) warnings.push(`${failures.length} failed (${failures[0]})`);
    if (pubFailures) warnings.push(`${pubFailures} venue(s) failed to publish to prod`);
    return {
      ok: failures.length < happyHourIds.length,
      summary: parts.join(", "),
      warning: warnings.length ? warnings.join(" · ") : undefined,
      error: failures.length === happyHourIds.length ? failures[0] : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Review action failed" };
  }
}
