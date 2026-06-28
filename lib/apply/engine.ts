import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditLog,
  cities,
  editSubmissions,
  happyHours,
  neighborhoods,
  offerings,
  venues,
} from "@/db/schema";
import {
  requestVenueRevalidation,
  type VenueRevalidationTarget,
} from "@/lib/cache/revalidate";
import {
  planNewHappyHour,
  newOfferingsToInsert,
  type OfferingLike,
} from "./newHappyHour";
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
  // new_happy_hour inserts into happy_hours (and optionally offerings in the same txn).
  new_happy_hour: "happy_hours",
} as const;

// Column allowlists — only these keys are read out of a submission's `after` blob,
// so a malicious or malformed diff can never set columns we didn't intend.
const VENUE_FIELDS = [
  "name", "slug", "address", "lat", "lng", "timezone", "neighborhoodId",
  "type", "chainId", "websiteUrl", "otherUrl", "googlePlaceId", "phone",
  "status", "dataCompleteness", "promotionTier",
] as const;

const HAPPY_HOUR_FIELDS = [
  "venueId", "daysOfWeek", "startTime", "endTime", "allDay", "locationWithinVenue",
  "validFrom", "validUntil", "notes", "active", "sourceUrl",
] as const;

const OFFERING_FIELDS = [
  "happyHourId", "kind", "category", "name", "priceCents", "originalPriceCents",
  "discountCents", "discountPercent", "currencyCode", "description", "conditions",
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
 * happy_hours.days_of_week is part of the natural unique index, which compares arrays
 * element-wise — so [1,2,3] and [2,1,3] would be two different keys. Every write must
 * therefore go in sorted+deduped (matches the seed scripts' convention), or AI-proposed
 * unsorted arrays could silently break seed idempotency and create duplicate windows.
 */
function normaliseDaysOfWeek(after: Record<string, unknown>): Record<string, unknown> {
  const raw = after.daysOfWeek;
  if (!Array.isArray(raw)) return after;
  const days = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))]
    .sort((a, b) => a - b);
  return { ...after, daysOfWeek: days };
}

/**
 * Resolve the owning venue id for an audited row. venues → itself; happy_hours →
 * its venue_id; offerings → its happy hour's venue_id. Returns null for anything else.
 * Used by the admin actions to know which venue to publish to prod after apply/revert.
 */
export async function venueIdForRow(
  tableName: string,
  rowId: string,
): Promise<string | null> {
  if (tableName === "venues") return rowId;
  if (tableName === "happy_hours") {
    const [hh] = await db
      .select({ venueId: happyHours.venueId })
      .from(happyHours)
      .where(eq(happyHours.id, rowId))
      .limit(1);
    return hh?.venueId ?? null;
  }
  if (tableName === "offerings") {
    const [row] = await db
      .select({ venueId: happyHours.venueId })
      .from(offerings)
      .innerJoin(happyHours, eq(offerings.happyHourId, happyHours.id))
      .where(eq(offerings.id, rowId))
      .limit(1);
    return row?.venueId ?? null;
  }
  return null;
}

/**
 * Map a written row (any of the three audited tables) back to the venue whose public
 * pages need their cache refreshed. Runs after the write transaction has committed.
 */
async function resolveVenueRevalidationTarget(
  tableName: string,
  rowId: string,
): Promise<VenueRevalidationTarget | null> {
  const venueId = await venueIdForRow(tableName, rowId);
  if (!venueId) return null;

  // No deletedAt filter: a revert can soft-delete a venue, and we still want to refresh
  // its (now-removed) page and the city listing.
  const [v] = await db
    .select({
      venueSlug: venues.slug,
      citySlug: cities.slug,
      stateSlug: cities.state,
      neighborhoodSlug: neighborhoods.slug,
    })
    .from(venues)
    .innerJoin(cities, eq(venues.cityId, cities.id))
    .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id))
    .where(eq(venues.id, venueId))
    .limit(1);
  if (!v) return null;

  return {
    stateSlug: v.stateSlug,
    citySlug: v.citySlug,
    venueSlug: v.venueSlug,
    neighborhoodSlug: v.neighborhoodSlug,
    // Venue and happy-hour writes can flip a venue between "has hours" and "stub", which
    // moves the landing-page counts; offering-only changes never do.
    countsChanged: tableName === "venues" || tableName === "happy_hours",
  };
}

/** Best-effort cache refresh for the public pages touched by a committed write. Never
 *  throws — a revalidation hiccup must not fail or roll back the write that succeeded. */
async function revalidateAfterWrite(tableName: string, rowId: string): Promise<void> {
  try {
    const target = await resolveVenueRevalidationTarget(tableName, rowId);
    if (target) await requestVenueRevalidation(target);
  } catch (err) {
    console.warn("[engine] revalidate-after-write failed", err);
  }
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
  const result = await db.transaction(async (tx) => {
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
    } else if (sub.targetType === "new_happy_hour") {
      // The "add a happy hour" path for stub venues: visitor submitted days/times
      // (and optionally a list of offerings) directly, source already enforced. We
      // write the HH row and any offerings in a single txn; only the HH gets an
      // audit_log entry — reverting it soft-deletes the HH, and the venue queries
      // join offerings via happy_hour_id, so the offerings become invisible too.
      const hhValues = pick(
        withSourceUrl("happy_hours", normaliseDaysOfWeek(after), diff.sourceUrl),
        HAPPY_HOUR_FIELDS,
      );
      const venueId = hhValues.venueId as string | undefined;
      const days = hhValues.daysOfWeek as number[] | undefined;
      if (!venueId || !days?.length || !hhValues.startTime) {
        throw new Error(
          "new_happy_hour requires venueId, daysOfWeek, startTime, and a source.",
        );
      }

      // Dedup against the venue's existing windows (live AND soft-deleted — the natural
      // unique key spans both) so a re-submission of an already-present window attaches
      // or resurrects instead of crashing a blind INSERT on happy_hours_natural_uq.
      const existingWindows = await tx
        .select({
          id: happyHours.id,
          daysOfWeek: happyHours.daysOfWeek,
          startTime: happyHours.startTime,
          endTime: happyHours.endTime,
          locationWithinVenue: happyHours.locationWithinVenue,
          deletedAt: happyHours.deletedAt,
        })
        .from(happyHours)
        .where(eq(happyHours.venueId, venueId));
      const plan = planNewHappyHour(
        {
          daysOfWeek: days,
          startTime: hhValues.startTime as string,
          endTime: (hhValues.endTime as string | null | undefined) ?? null,
          locationWithinVenue:
            (hhValues.locationWithinVenue as string | null | undefined) ?? null,
        },
        existingWindows,
      );

      let hhRow: Record<string, unknown>;
      if (plan.mode === "insert") {
        const [insertedHh] = await tx
          .insert(happyHours)
          .values(hhValues as typeof happyHours.$inferInsert)
          .returning();
        rowId = insertedHh.id;
        beforeJsonb = null;
        hhRow = insertedHh as Record<string, unknown>;
      } else {
        rowId = plan.happyHourId;
        const before = await readRow(tx, "happy_hours", rowId);
        beforeJsonb = before;
        if (plan.resurrect) {
          // Un-delete and re-activate the previously-removed window, refreshing its source.
          await updateRow(tx, "happy_hours", rowId, {
            deletedAt: null,
            active: true,
            sourceUrl: hhValues.sourceUrl,
            ...(hhValues.notes !== undefined ? { notes: hhValues.notes } : {}),
          });
        } else if (before && !before.sourceUrl && hhValues.sourceUrl) {
          // Live duplicate that lacked a source — backfill provenance from the submission.
          await updateRow(tx, "happy_hours", rowId, {
            sourceUrl: hhValues.sourceUrl,
          });
        }
        hhRow = (await readRow(tx, "happy_hours", rowId)) as Record<string, unknown>;
      }

      // Offerings ride along in the same txn, deduped against the target window's existing
      // offerings (none for a brand-new window). They default currency from the venue's
      // city (mirrors the seed pipeline + new_offering path).
      const rawOfferings = Array.isArray(
        (after as { offerings?: unknown }).offerings,
      )
        ? ((after as { offerings: Record<string, unknown>[] }).offerings)
        : [];
      const existingOfferings =
        plan.mode === "insert"
          ? []
          : await tx
              .select()
              .from(offerings)
              .where(
                and(eq(offerings.happyHourId, rowId), isNull(offerings.deletedAt)),
              );
      const offeringsToInsert = newOfferingsToInsert(
        rawOfferings,
        existingOfferings as OfferingLike[],
      );
      let defaultCurrency: string | null = null;
      if (offeringsToInsert.length) {
        const [v] = await tx
          .select({ cityId: venues.cityId })
          .from(venues)
          .where(eq(venues.id, venueId))
          .limit(1);
        const [c] = v
          ? await tx
              .select({ cc: cities.currencyCode })
              .from(cities)
              .where(eq(cities.id, v.cityId))
              .limit(1)
          : [];
        defaultCurrency = c?.cc ?? null;
      }
      const insertedOfferings: Record<string, unknown>[] = [];
      for (const raw of offeringsToInsert) {
        const o = pick(
          { ...raw, happyHourId: rowId, sourceUrl: hhValues.sourceUrl },
          OFFERING_FIELDS,
        );
        if (!o.kind || !o.category) continue;
        if (!o.currencyCode && defaultCurrency) o.currencyCode = defaultCurrency;
        const [insertedOff] = await tx
          .insert(offerings)
          .values(o as typeof offerings.$inferInsert)
          .returning();
        insertedOfferings.push(insertedOff as Record<string, unknown>);
      }
      afterJsonb = { ...hhRow, offerings: insertedOfferings };
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
      const normalised =
        tableName === "happy_hours" ? normaliseDaysOfWeek(after) : after;
      const values = pick(
        withSourceUrl(tableName, normalised, diff.sourceUrl),
        ALLOWED[tableName],
      );
      await updateRow(tx, tableName, rowId, values);
      beforeJsonb = before;
      afterJsonb = await readRow(tx, tableName, rowId);
    }

    // Release a venue Build A had hidden as a dead-end stub (status='no_happy_hour') the instant
    // a crowdsourced active happy hour lands on it. SCOPED to no_happy_hour — never overrides an
    // operator's closed/paused. Mirrors the persist path's re-activation (lib/recover/resolveVenue).
    if (
      tableName === "happy_hours" &&
      afterJsonb &&
      (afterJsonb as { active?: boolean }).active === true &&
      !(afterJsonb as { deletedAt?: unknown }).deletedAt
    ) {
      const ownerVenueId = (afterJsonb as { venueId?: string }).venueId;
      if (ownerVenueId) {
        await tx
          .update(venues)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(eq(venues.id, ownerVenueId), eq(venues.status, "no_happy_hour")));
      }
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

  await revalidateAfterWrite(result.tableName, result.rowId);
  return result;
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
  tableName: string;
  rowId: string;
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
  const { result, tableName, rowId } = await db.transaction(async (tx) => {
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

    return {
      result: { auditId, revertAuditId: revertAudit.id, action, tableName, rowId },
      tableName,
      rowId,
    };
  });

  await revalidateAfterWrite(tableName, rowId);
  return result;
}
