import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLog,
  cities,
  editSubmissions,
  happyHours,
  offerings,
  venues,
} from "@/db/schema";
import type { Actor, SubmissionDiff } from "./types";

/**
 * Apply / revert engine (PRD §3.8, §3.13, §13).
 *
 * Every applied change is written to the target row inside a transaction that also
 * appends an `audit_log` row holding the before/after JSON — this is what makes the
 * 30-day revert window (PRD §5.1.7) possible. Phases 3–5 (AI auto-apply, verifier
 * routing, flag resolution) all funnel writes through `applySubmission`, so the
 * audit trail is uniform regardless of actor.
 *
 * Source provenance (PRD §13, refined 2026-05): every applied happy-hour / offering
 * change must carry a `source_url` — but a submitter may satisfy it with EITHER a link
 * OR a photo of the menu (the upload's stored URL becomes the source_url; see
 * /api/submissions). We enforce the presence of a source here as a safety net and
 * refuse an HH/offering apply that somehow reached us without one.
 */

const TABLE_BY_TARGET = {
  venue: "venues",
  happy_hour: "happy_hours",
  offering: "offerings",
  new_venue: "venues",
  // intent is a free-text parent; it is never applied (it fans out into children),
  // but the map must be total over the enum. happy_hours is a harmless placeholder.
  intent: "happy_hours",
  new_offering: "offerings",
} as const;

// Column allowlists — only these keys are read out of a submission's `after` blob,
// so a malicious or malformed diff can never set columns we didn't intend.
const VENUE_FIELDS = [
  "name", "slug", "address", "lat", "lng", "timezone", "neighborhoodId",
  "type", "chainId", "websiteUrl", "otherUrl", "googlePlaceId", "phone",
  "status", "dataCompleteness", "promotionTier",
] as const;

const HAPPY_HOUR_FIELDS = [
  "venueId", "daysOfWeek", "startTime", "endTime", "locationWithinVenue",
  "validFrom", "validUntil", "notes", "active", "sourceUrl",
] as const;

const OFFERING_FIELDS = [
  "happyHourId", "kind", "category", "name", "priceCents", "originalPriceCents",
  "discountCents", "currencyCode", "description", "conditions",
  "locationRestriction", "sourceUrl", "active",
] as const;

const ALLOWED: Record<string, readonly string[]> = {
  venues: VENUE_FIELDS,
  happy_hours: HAPPY_HOUR_FIELDS,
  offerings: OFFERING_FIELDS,
};

function pick(
  obj: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "venue";
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ApplyContext {
  actor: Actor;
  reason?: string;
}

export interface ApplyResult {
  submissionId: string;
  status: "applied" | "auto_applied";
  tableName: string;
  rowId: string;
  auditId: string;
}

/** Read a single row by id from one of the three audited tables. */
async function readRow(
  tx: Tx,
  tableName: string,
  rowId: string,
): Promise<Record<string, unknown> | null> {
  if (tableName === "venues") {
    const [r] = await tx.select().from(venues).where(eq(venues.id, rowId)).limit(1);
    return r ?? null;
  }
  if (tableName === "happy_hours") {
    const [r] = await tx
      .select()
      .from(happyHours)
      .where(eq(happyHours.id, rowId))
      .limit(1);
    return r ?? null;
  }
  const [r] = await tx
    .select()
    .from(offerings)
    .where(eq(offerings.id, rowId))
    .limit(1);
  return r ?? null;
}

async function updateRow(
  tx: Tx,
  tableName: string,
  rowId: string,
  values: Record<string, unknown>,
): Promise<void> {
  if (tableName === "venues") {
    await tx.update(venues).set(values).where(eq(venues.id, rowId));
  } else if (tableName === "happy_hours") {
    await tx.update(happyHours).set(values).where(eq(happyHours.id, rowId));
  } else {
    await tx.update(offerings).set(values).where(eq(offerings.id, rowId));
  }
}

/**
 * Inject the diff-level source_url onto an HH/offering `after` blob and require that
 * a source exists (a link or an uploaded photo's URL — see header). The column is
 * nullable in the DB, so this code path is the enforcement point.
 */
function withSourceUrl(
  tableName: string,
  after: Record<string, unknown>,
  diffSourceUrl: string | null | undefined,
): Record<string, unknown> {
  if (tableName !== "happy_hours" && tableName !== "offerings") return after;
  const sourceUrl = (after.sourceUrl as string | undefined) ?? diffSourceUrl ?? null;
  if (!sourceUrl) {
    throw new Error(
      `Cannot apply a ${tableName} change without a source (a link or a menu photo).`,
    );
  }
  return { ...after, sourceUrl };
}

/**
 * Apply a pending submission. `overrideAfter` lets an admin edit-then-apply: the
 * supplied object replaces the submission's `after` (a record of the override is
 * kept in the audit reason).
 */
export async function applySubmission(
  submissionId: string,
  ctx: ApplyContext,
  overrideAfter?: Record<string, unknown>,
): Promise<ApplyResult> {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(editSubmissions)
      .where(eq(editSubmissions.id, submissionId))
      .limit(1);
    if (!sub) throw new Error(`Submission ${submissionId} not found`);

    const TERMINAL = ["applied", "auto_applied", "rejected", "reverted"];
    if (TERMINAL.includes(sub.status)) {
      throw new Error(`Submission ${submissionId} is already ${sub.status}`);
    }

    const diff = sub.diffJsonb as SubmissionDiff;
    const after = overrideAfter ?? diff.after ?? {};
    const tableName = TABLE_BY_TARGET[sub.targetType];
    const status: ApplyResult["status"] =
      ctx.actor === "ai" ? "auto_applied" : "applied";

    let rowId: string;
    let beforeJsonb: Record<string, unknown> | null;
    let afterJsonb: Record<string, unknown> | null;

    if (sub.targetType === "new_venue") {
      const values = pick(after, VENUE_FIELDS);
      const cityId = (values.cityId as string) ?? (after.cityId as string);
      if (!values.name || !cityId) {
        throw new Error("new_venue requires at least name and cityId");
      }
      // Derive a URL slug from the name when not supplied (unique per city — a
      // collision surfaces as a DB error for the admin to resolve).
      if (!values.slug) values.slug = slugify(String(values.name));
      // New venues default to a stub until happy hours are confirmed.
      if (!values.dataCompleteness) values.dataCompleteness = "stub";
      const [inserted] = await tx
        .insert(venues)
        .values({ ...values, cityId } as typeof venues.$inferInsert)
        .returning();
      rowId = inserted.id;
      beforeJsonb = null;
      afterJsonb = inserted as Record<string, unknown>;
    } else if (sub.targetType === "new_offering") {
      // Insert a brand-new offering onto an EXISTING happy hour (e.g. an interpreted
      // "they added $5 wings"). Source is required just like an offering update.
      const values = pick(
        withSourceUrl("offerings", after, diff.sourceUrl),
        OFFERING_FIELDS,
      );
      const happyHourId = values.happyHourId as string | undefined;
      if (!happyHourId || !values.kind || !values.category) {
        throw new Error(
          "new_offering requires happyHourId, kind, and category.",
        );
      }
      // The happy hour must exist and be live (FK + defence in depth).
      const [hh] = await tx
        .select({ venueId: happyHours.venueId })
        .from(happyHours)
        .where(and(eq(happyHours.id, happyHourId), isNull(happyHours.deletedAt)))
        .limit(1);
      if (!hh) {
        throw new Error("new_offering references a missing or deleted happy hour.");
      }
      // Default the currency from the venue's city when the diff didn't carry one
      // (mirrors the seed pipeline, which always sets it).
      if (!values.currencyCode) {
        const [v] = await tx
          .select({ cityId: venues.cityId })
          .from(venues)
          .where(eq(venues.id, hh.venueId))
          .limit(1);
        const [c] = v
          ? await tx
              .select({ cc: cities.currencyCode })
              .from(cities)
              .where(eq(cities.id, v.cityId))
              .limit(1)
          : [];
        if (c?.cc) values.currencyCode = c.cc;
      }
      const [inserted] = await tx
        .insert(offerings)
        .values(values as typeof offerings.$inferInsert)
        .returning();
      rowId = inserted.id;
      beforeJsonb = null;
      afterJsonb = inserted as Record<string, unknown>;
    } else {
      if (!sub.targetId) {
        throw new Error(`${sub.targetType} submission is missing target_id`);
      }
      rowId = sub.targetId;
      const before = await readRow(tx, tableName, rowId);
      if (!before) throw new Error(`Target ${tableName}:${rowId} not found`);
      const values = pick(
        withSourceUrl(tableName, after, diff.sourceUrl),
        ALLOWED[tableName],
      );
      await updateRow(tx, tableName, rowId, values);
      beforeJsonb = before;
      afterJsonb = await readRow(tx, tableName, rowId);
    }

    const reason =
      ctx.reason ??
      (overrideAfter
        ? `Applied with admin edits${diff.summary ? `: ${diff.summary}` : ""}`
        : diff.summary ?? "Applied submission");

    const [audit] = await tx
      .insert(auditLog)
      .values({
        tableName,
        rowId,
        beforeJsonb,
        afterJsonb,
        actor: ctx.actor,
        reason,
      })
      .returning({ id: auditLog.id });

    await tx
      .update(editSubmissions)
      .set({ status, appliedBy: ctx.actor, decidedAt: new Date() })
      .where(eq(editSubmissions.id, submissionId));

    return { submissionId, status, tableName, rowId, auditId: audit.id };
  });
}

/** Reject a pending submission without touching live data. */
export async function rejectSubmission(
  submissionId: string,
  ctx: ApplyContext,
): Promise<void> {
  await db
    .update(editSubmissions)
    .set({
      status: "rejected",
      appliedBy: ctx.actor,
      decidedAt: new Date(),
      aiClassifierReasoning: ctx.reason ?? undefined,
    })
    .where(
      and(
        eq(editSubmissions.id, submissionId),
        // Don't clobber an already-applied row.
        isNull(editSubmissions.decidedAt),
      ),
    );
}

export interface RevertResult {
  auditId: string;
  revertAuditId: string;
  action: "restored" | "soft_deleted";
}

/**
 * Revert a previously-applied change using its audit_log entry. Restores the
 * `before` snapshot (or soft-deletes the row if the change was an insert), and
 * records the revert itself as a new audit_log row (PRD §5.1.7).
 */
export async function revertAudit(
  auditId: string,
  ctx: ApplyContext,
): Promise<RevertResult> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, auditId))
      .limit(1);
    if (!entry) throw new Error(`Audit entry ${auditId} not found`);

    const tableName = entry.tableName;
    const allowed = ALLOWED[tableName];
    if (!allowed) throw new Error(`Cannot revert table ${tableName}`);
    const rowId = entry.rowId;
    const current = await readRow(tx, tableName, rowId);
    const before = entry.beforeJsonb as Record<string, unknown> | null;

    let action: RevertResult["action"];
    if (!before) {
      // The original change was an insert → undo by soft-deleting.
      await updateRow(tx, tableName, rowId, { deletedAt: new Date() });
      action = "soft_deleted";
    } else {
      await updateRow(tx, tableName, rowId, {
        ...pick(before, allowed),
        deletedAt: null,
      });
      action = "restored";
    }

    const restored = await readRow(tx, tableName, rowId);
    const [revertAudit] = await tx
      .insert(auditLog)
      .values({
        tableName,
        rowId,
        beforeJsonb: current,
        afterJsonb: restored,
        actor: ctx.actor,
        reason: ctx.reason ?? `Revert of audit ${auditId}`,
      })
      .returning({ id: auditLog.id });

    // If the reverted row traces to a submission, mark it reverted.
    await tx
      .update(editSubmissions)
      .set({ status: "reverted" })
      .where(
        and(
          eq(editSubmissions.targetId, rowId),
          sql`${editSubmissions.status} in ('applied', 'auto_applied')`,
        ),
      );

    return { auditId, revertAuditId: revertAudit.id, action };
  });
}
