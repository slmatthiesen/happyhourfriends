"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLog, happyHours, offerings, promotionTier, venues } from "@/db/schema";
import { requireAdmin } from "@/lib/admin/auth";
import {
  applySubmission,
  rejectSubmission,
  revertAudit,
  venueIdForRow,
} from "@/lib/apply/engine";
import { publishVenueToProd } from "@/lib/sync/publishVenueToProd";
import { adminActor } from "@/lib/apply/types";
import { classifySiteHealth } from "@/lib/places/siteHealth";
import { probeUrl } from "@/lib/places/probeUrl";
import { resolveWorkingUrl } from "@/lib/places/resolveWebsiteUrl";
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";

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

/** Soft-delete a stub venue from the Stub Resolver (junk / not a real venue). Mirrors
 *  scripts/remove-venues.ts: deactivate any active windows + set deleted_at — NEVER hard
 *  delete (the surviving google_place_id row is the re-discovery guard). Audit-logged so it
 *  is revertable; operator-driven only (this is judgment, not a heuristic delete). */
export async function deleteStubVenueAction(venueId: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const [venue] = await db
      .select({ id: venues.id, deletedAt: venues.deletedAt })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!venue) return { ok: false, error: "Venue not found" };
    if (venue.deletedAt) return { ok: false, error: "Venue already deleted" };

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(happyHours)
        .set({ active: false, updatedAt: now })
        .where(
          and(
            eq(happyHours.venueId, venueId),
            eq(happyHours.active, true),
            isNull(happyHours.deletedAt),
          ),
        );
      await tx
        .update(venues)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(venues.id, venueId));
      await tx.insert(auditLog).values({
        tableName: "venues",
        rowId: venueId,
        beforeJsonb: { deletedAt: null },
        afterJsonb: { deletedAt: now.toISOString() },
        actor: adminActor(admin.email),
        reason: "stub deleted by operator (stub resolver)",
      });
    });

    // Propagate the soft-delete to prod: publishVenue upserts the full row (carrying deleted_at),
    // and prod's public queries already filter deleted_at — so the venue vanishes from the live site.
    let warning: string | undefined;
    const pub = await publishVenueToProd(venueId);
    if (!pub.ok) warning = `Deleted locally, but publishing the removal to prod failed: ${pub.error}`;

    revalidatePath("/admin/stubs");
    revalidatePath("/admin/site-health");
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}

/** Bare-window queue: the operator looked and there's no findable happy-hour entry. Soft-delete
 *  the venue's offering-less ("bare") active windows so the venue drops off /admin/bare-windows
 *  AND stops claiming an unsubstantiated happy hour on the public site (no active window → it
 *  reverts to a plain stub). Soft delete is reversible (audit-logged) and the persist path
 *  respects it — a future re-extraction won't resurrect the exact dismissed window. Windows that
 *  DO carry deals are never touched. Operator-driven judgment, not a heuristic. */
export async function dismissBareWindowAction(venueId: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const now = new Date();
    let dismissed = 0;
    await db.transaction(async (tx) => {
      // The venue's ACTIVE windows that carry NO active offerings — the bare ones.
      const bare = await tx
        .select({ id: happyHours.id })
        .from(happyHours)
        .where(
          and(
            eq(happyHours.venueId, venueId),
            eq(happyHours.active, true),
            isNull(happyHours.deletedAt),
            sql`NOT EXISTS (SELECT 1 FROM ${offerings} o WHERE o.happy_hour_id = ${happyHours.id} AND o.active = true AND o.deleted_at IS NULL)`,
          ),
        );
      const ids = bare.map((w) => w.id);
      dismissed = ids.length;
      if (ids.length === 0) return;
      await tx
        .update(happyHours)
        .set({ active: false, deletedAt: now, updatedAt: now })
        .where(inArray(happyHours.id, ids));
      for (const id of ids) {
        await tx.insert(auditLog).values({
          tableName: "happy_hours",
          rowId: id,
          beforeJsonb: { active: true, deletedAt: null },
          afterJsonb: { active: false, deletedAt: now.toISOString() },
          actor: adminActor(admin.email),
          reason: "operator: cannot find HH entry — bare window dismissed",
        });
      }
    });
    if (dismissed === 0) return { ok: false, error: "No bare window to dismiss (deals may already exist)." };

    // Propagate to prod so the dismissed window vanishes from the live site too.
    let warning: string | undefined;
    const pub = await publishVenueToProd(venueId);
    if (!pub.ok) warning = `Dismissed locally, but publishing to prod failed: ${pub.error}`;

    revalidatePath("/admin/bare-windows");
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Dismiss failed" };
  }
}

/** Edit a venue's stored website_url (or clear it with null), re-probe its link health, and
 *  publish the change to prod. Drives the /admin/site-health queue's Save / Accept actions. */
export async function updateVenueWebsiteAction(
  venueId: string,
  url: string | null,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const trimmed = url?.trim() || null;
    if (trimmed) {
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        return { ok: false, error: "Enter a valid http(s) URL" };
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return { ok: false, error: "URL must start with http:// or https://" };
      if (isDenylistedSource(trimmed))
        return { ok: false, error: "That domain is a competitor/aggregator and can't be used" };
    }

    const [venue] = await db
      .select({ id: venues.id, websiteUrl: venues.websiteUrl })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!venue) return { ok: false, error: "Venue not found" };

    // Re-probe the new URL so the row's health reflects the edit immediately (null = cleared).
    let health: string | null = null;
    let detail: string | null = null;
    let suggested: string | null = null;
    if (trimmed) {
      const verdict = classifySiteHealth(await probeUrl(trimmed), trimmed);
      health = verdict.health;
      detail = verdict.detail;
      if (verdict.broken) suggested = (await resolveWorkingUrl(trimmed)).suggestedUrl;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(venues)
        .set({
          websiteUrl: trimmed,
          siteHealth: health,
          siteHealthDetail: detail,
          siteHealthSuggestedUrl: suggested,
          siteHealthCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(venues.id, venueId));
      await tx.insert(auditLog).values({
        tableName: "venues",
        rowId: venueId,
        beforeJsonb: { websiteUrl: venue.websiteUrl },
        afterJsonb: { websiteUrl: trimmed },
        actor: adminActor(admin.email),
        reason: "website_url edited (site-health queue)",
      });
    });

    let warning: string | undefined;
    const pub = await publishVenueToProd(venueId);
    if (!pub.ok) warning = `Saved locally, but publishing to prod failed: ${pub.error}`;

    revalidatePath("/admin/site-health");
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed" };
  }
}

/** One-click accept of the audit's deterministic working-URL suggestion for a venue. */
export async function acceptSuggestedUrlAction(venueId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    const [v] = await db
      .select({ suggested: venues.siteHealthSuggestedUrl })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!v?.suggested) return { ok: false, error: "No suggested URL to accept" };
    return await updateVenueWebsiteAction(venueId, v.suggested);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Accept failed" };
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
  offeringsAdded?: number;
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
      revalidatePath("/admin/bare-windows"); // re-extract from the bare-windows bucket too
      revalidatePath("/");
    }
    return {
      ok: r.ok,
      error: r.error,
      recovered: r.recovered,
      windowsLive: r.windowsLive,
      windowsHidden: r.windowsHidden,
      offeringsAdded: r.offeringsAdded,
      costCents: r.costCents,
      summary: r.summary,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Resolve failed" };
  }
}

// ── /admin/stubs — manual window entry for bot-walled venues ─────────────────────

export interface ManualWindowActionResult extends ActionResult {
  summary?: string;
}

/**
 * Admin Stub Resolver: create a live happy-hour window by hand for a venue whose site
 * is confirmed unreadable (hh_probe_status='blocked'). Operator trust → bypasses the
 * realness gate and lands active=true.
 */
export async function createManualWindowAction(input: {
  venueId: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  sourceUrl: string;
  offerings: {
    kind: "food" | "drink" | "other";
    category: "beer" | "wine" | "cocktail" | "spirit" | "appetizer" | "entree" | "dessert" | "other";
    name: string;
    priceCents?: number | null;
  }[];
}): Promise<ManualWindowActionResult> {
  try {
    const admin = await requireAdmin();
    const { createManualWindow } = await import("@/lib/recover/manualWindow");
    const r = await createManualWindow(db, input, admin.email);
    revalidatePath("/admin/stubs");
    revalidatePath("/");

    // Bridge the new live window to prod so it shows on the actual site (local is the curation
    // source of truth; this additive bridge is how the operator's manual entry goes live for
    // users). Mirrors hideWindowAction et al. Skip on a pure duplicate (nothing new written).
    let warning: string | undefined;
    if (r.happyHourId) {
      const pub = await publishVenueToProd(input.venueId);
      if (!pub.ok) warning = `Window created locally, but publishing to prod failed: ${pub.error}`;
    }
    return {
      ok: true,
      summary: r.happyHourId ? "window created (live)" : "duplicate — no change",
      warning,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Manual entry failed" };
  }
}

// ── /admin/bare-windows — add deals to a live-but-bare window ────────────────────

export interface AddOfferingsActionResult extends ActionResult {
  added?: number;
}

/**
 * Bare-window bucket: attach operator-entered offerings to an existing LIVE window that
 * extracted bare (deals were in a menu image/PDF the extractor couldn't fully read). The
 * operator entering the deals is the verification. Audit-logged + bridged to prod.
 */
export async function addOfferingsToWindowAction(input: {
  happyHourId: string;
  sourceUrl: string;
  offerings: {
    kind: "food" | "drink" | "other";
    category: "beer" | "wine" | "cocktail" | "spirit" | "appetizer" | "entree" | "dessert" | "other";
    name: string;
    priceCents?: number | null;
  }[];
}): Promise<AddOfferingsActionResult> {
  try {
    const admin = await requireAdmin();
    const { addOfferingsToWindow } = await import("@/lib/recover/addOfferings");
    const r = await addOfferingsToWindow(db, input, adminActor(admin.email));
    revalidatePath("/admin/bare-windows");
    revalidatePath("/");

    let warning: string | undefined;
    const pub = await publishVenueToProd(r.venueId);
    if (!pub.ok) warning = `Saved locally, but publishing to prod failed: ${pub.error}`;
    return { ok: true, added: r.added, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Add offerings failed" };
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
