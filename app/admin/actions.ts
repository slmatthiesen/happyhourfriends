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
} from "@/lib/apply/engine";
import { adminActor } from "@/lib/apply/types";

type PromotionTier = (typeof promotionTier.enumValues)[number];

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Apply a pending submission, optionally with admin-edited values. */
export async function applyAction(
  submissionId: string,
  overrideAfter?: Record<string, unknown>,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    await applySubmission(
      submissionId,
      { actor: adminActor(admin.email) },
      overrideAfter && Object.keys(overrideAfter).length > 0
        ? overrideAfter
        : undefined,
    );
    revalidatePath("/admin");
    revalidatePath("/admin/audit");
    return { ok: true };
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
    await revertAudit(auditId, { actor: adminActor(admin.email) });
    revalidatePath("/admin/audit");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revert failed" };
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
