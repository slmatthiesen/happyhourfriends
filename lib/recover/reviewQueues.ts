/**
 * reviewQueues — live-computed operator review queues behind /admin/reviews.
 *
 * The CSV review scripts (review:hidden, review:meal-specials) freeze a point-in-time
 * report the operator edits and feeds back to --apply. These queues are the same
 * deterministic, $0 logic (deleteEvidence / mealSpecialEvidence over stored rows)
 * computed fresh on every page load, so the web UI never serves a stale report and
 * needs no file round-trip. The scripts remain for batch/offline use.
 *
 * Dismissals persist as audit_log rows (reason = the queue's keep marker) — no new
 * schema. A dismissed window stops resurfacing in its queue; the audit trail records
 * who reviewed it and when.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, happyHours, venues } from "@/db/schema";
import { adminActor } from "@/lib/apply/types";
import { mealSpecialEvidence, MEAL_AVG_PRICE_CENTS } from "@/lib/places/realnessGate";
import { deleteEvidence, suggestAction } from "@/lib/recover/hiddenReview";
import type { OpenPeriod } from "@/lib/geo/timezone";

/** The shared client or a transaction handle (same query-builder surface). */
type Dbx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/** Audit-log reason markers that dismiss a window from its review queue. */
export const REVIEW_KEEP_REASONS = {
  meal: "meal-special review: operator keep",
  hidden: "hidden-window review: operator keep hidden",
} as const;

export type ReviewQueueKind = keyof typeof REVIEW_KEEP_REASONS;

export interface ReviewOffering {
  name: string | null;
  description: string | null;
  priceCents: number | null;
}

/** Another non-deleted window on the same venue — the "what survives if I delete this"
 *  context shown on a review row, so a delete never feels like erasing the venue. */
export interface SiblingWindow {
  happyHourId: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  /** true = live/visible to users, false = hidden. */
  active: boolean;
  offeringCount: number;
  topOfferings: string[];
  sourceUrl: string | null;
  /** Created after the reviewed window — i.e. a likely fresher re-extraction. */
  newer: boolean;
}

export interface ReviewWindowEntry {
  happyHourId: string;
  venueId: string;
  city: string;
  venue: string;
  websiteUrl: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  offerings: ReviewOffering[];
  avgPriceCents: number | null;
  sourceUrl: string | null;
  notes: string | null;
  /** The deterministic rule's stated reasoning (null = listed on price alone). */
  evidence: string | null;
  /** What the rule suggests — the operator can always override. */
  suggested: "keep" | "hide" | "keep_hidden" | "delete";
  /** The venue's OTHER non-deleted windows (live + hidden), for delete-safety context. */
  siblingWindows: SiblingWindow[];
}

/** A venue's window as fetched for sibling context (one row per non-deleted window).
 *  Exported only so the pure helper below can be unit-tested without a DB. */
export interface VenueWindowRow {
  happyHourId: string;
  venueId: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  active: boolean;
  createdAt: string;
  sourceUrl: string | null;
  offeringNames: string[];
}

/**
 * Build the sibling context for one reviewed window: the venue's OTHER non-deleted
 * windows, flagged `newer` when created after the reviewed one, sorted live-first then
 * newest-first then richest-first. Pure — unit-tested without a DB.
 */
export function buildSiblingWindows(
  reviewed: { happyHourId: string; createdAt: string },
  venueWindows: VenueWindowRow[],
): SiblingWindow[] {
  return venueWindows
    .filter((w) => w.happyHourId !== reviewed.happyHourId)
    .map((w) => ({
      happyHourId: w.happyHourId,
      daysOfWeek: w.daysOfWeek,
      startTime: w.startTime,
      endTime: w.endTime,
      allDay: w.allDay,
      active: w.active,
      offeringCount: w.offeringNames.length,
      topOfferings: w.offeringNames.slice(0, 3),
      sourceUrl: w.sourceUrl,
      // Guard a missing reviewed timestamp: never claim "newer" without a basis to compare
      // (an empty string would sort before every ISO date and mark all siblings newer).
      newer: reviewed.createdAt ? w.createdAt > reviewed.createdAt : false,
    }))
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        Number(b.newer) - Number(a.newer) ||
        b.offeringCount - a.offeringCount,
    );
}

const avgCents = (offerings: ReviewOffering[]): number | null => {
  const priced = offerings
    .map((o) => o.priceCents)
    .filter((p): p is number => p != null && p > 0);
  return priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;
};

/**
 * Populate `siblingWindows` on each entry in ONE batch query over the entries' venues:
 * every non-deleted window (live + hidden), so a row can show what survives a delete.
 * `createdAtById` maps each reviewed window to its created_at for the `newer` flag.
 */
async function attachSiblingWindows(
  entries: ReviewWindowEntry[],
  createdAtById: Map<string, string>,
): Promise<void> {
  if (entries.length === 0) return;
  const venueIds = [...new Set(entries.map((e) => e.venueId))];
  const rows = await db.execute<{
    happy_hour_id: string;
    venue_id: string;
    days_of_week: number[];
    start_time: string | null;
    end_time: string | null;
    all_day: boolean;
    active: boolean;
    created_at: string | Date;
    source_url: string | null;
    offering_names: string[] | null;
  }>(sql`
    SELECT hh.id AS happy_hour_id, hh.venue_id, hh.days_of_week, hh.start_time,
           hh.end_time, hh.all_day, hh.active, hh.created_at, hh.source_url,
           coalesce(
             (SELECT json_agg(o.name ORDER BY o.price_cents DESC NULLS LAST)
              FROM offerings o
              WHERE o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active
                AND o.name IS NOT NULL),
             '[]'
           ) AS offering_names
    FROM happy_hours hh
    -- drizzle interpolates a JS array as a parameterized "($1, $2, …)" tuple — exactly the
    -- IN-list form (each id a bind param, injection-safe). Not ANY(): that needs a real array.
    WHERE hh.venue_id IN ${venueIds} AND hh.deleted_at IS NULL
  `);

  const byVenue = new Map<string, VenueWindowRow[]>();
  for (const r of rows) {
    const list = byVenue.get(r.venue_id) ?? [];
    list.push({
      happyHourId: r.happy_hour_id,
      venueId: r.venue_id,
      daysOfWeek: r.days_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      allDay: r.all_day,
      active: r.active,
      // timestamptz comes back as a Date (or string) at runtime — coerce to ISO so the
      // pure helper's `newer` string-compare is well-defined.
      createdAt: new Date(r.created_at).toISOString(),
      sourceUrl: r.source_url,
      offeringNames: r.offering_names ?? [],
    });
    byVenue.set(r.venue_id, list);
  }

  for (const e of entries) {
    e.siblingWindows = buildSiblingWindows(
      { happyHourId: e.happyHourId, createdAt: createdAtById.get(e.happyHourId) ?? "" },
      byVenue.get(e.venueId) ?? [],
    );
  }
}

/**
 * LIVE windows that look like meal service rather than a happy hour — the gate's
 * evidence plus everything averaging over $12 (price alone defaults to keep: upscale
 * happy hours are real). Mirrors scripts/review-meal-specials.ts report mode.
 */
export async function mealSpecialQueue(): Promise<ReviewWindowEntry[]> {
  const rows = await db.execute<{
    happy_hour_id: string;
    venue_id: string;
    city: string;
    venue: string;
    website_url: string | null;
    days_of_week: number[];
    start_time: string | null;
    end_time: string | null;
    all_day: boolean;
    source_url: string | null;
    notes: string | null;
    created_at: string | Date;
    offerings: ReviewOffering[];
  }>(sql`
    SELECT hh.id AS happy_hour_id, v.id AS venue_id, c.name AS city, v.name AS venue,
           v.website_url, hh.days_of_week, hh.start_time, hh.end_time, hh.all_day,
           hh.source_url, hh.notes, hh.created_at,
           coalesce(
             json_agg(json_build_object(
               'name', o.name, 'description', o.description, 'priceCents', o.price_cents
             ) ORDER BY o.price_cents DESC NULLS LAST)
             FILTER (WHERE o.id IS NOT NULL), '[]'
           ) AS offerings
    FROM happy_hours hh
    JOIN venues v ON v.id = hh.venue_id AND v.deleted_at IS NULL
    JOIN cities c ON c.id = v.city_id
    LEFT JOIN offerings o
      ON o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active
    WHERE hh.deleted_at IS NULL AND hh.active
      AND NOT EXISTS (
        SELECT 1 FROM audit_log al
        WHERE al.table_name = 'happy_hours' AND al.row_id = hh.id
          AND al.reason = ${REVIEW_KEEP_REASONS.meal}
      )
    GROUP BY hh.id, v.id, c.name, v.name, v.website_url
  `);

  const entries: ReviewWindowEntry[] = [];
  const createdAtById = new Map<string, string>();
  for (const r of rows) {
    const evidence = mealSpecialEvidence({
      startTime: r.start_time,
      endTime: r.end_time,
      notes: r.notes,
      sourceUrl: r.source_url,
      offerings: r.offerings,
    });
    const avg = avgCents(r.offerings);
    if (!evidence && (avg == null || avg <= MEAL_AVG_PRICE_CENTS)) continue;
    createdAtById.set(r.happy_hour_id, new Date(r.created_at).toISOString());
    entries.push({
      happyHourId: r.happy_hour_id,
      venueId: r.venue_id,
      city: r.city,
      venue: r.venue,
      websiteUrl: r.website_url,
      daysOfWeek: r.days_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      allDay: r.all_day,
      offerings: r.offerings,
      avgPriceCents: avg,
      sourceUrl: r.source_url,
      notes: r.notes,
      evidence,
      suggested: evidence ? "hide" : "keep",
      siblingWindows: [],
    });
  }
  entries.sort(
    (a, b) =>
      Number(b.evidence != null) - Number(a.evidence != null) ||
      (b.avgPriceCents ?? 0) - (a.avgPriceCents ?? 0),
  );
  await attachSiblingWindows(entries, createdAtById);
  return entries;
}

/**
 * HIDDEN windows on stub venues — the venue's only extracted data, invisible to users.
 * Suggestion policy is hiddenReview's (never promote; delete only on hard evidence).
 * Mirrors scripts/review-hidden-hh.ts report mode.
 */
export async function hiddenWindowQueue(): Promise<ReviewWindowEntry[]> {
  const rows = await db.execute<{
    happy_hour_id: string;
    venue_id: string;
    city: string;
    venue: string;
    website_url: string | null;
    days_of_week: number[];
    start_time: string | null;
    end_time: string | null;
    all_day: boolean;
    time_known: boolean;
    source_url: string | null;
    notes: string | null;
    created_at: string | Date;
    hours_json: OpenPeriod[] | null;
    offerings: ReviewOffering[];
  }>(sql`
    SELECT hh.id AS happy_hour_id, v.id AS venue_id, c.name AS city, v.name AS venue,
           v.website_url, v.hours_json, hh.days_of_week, hh.start_time, hh.end_time,
           hh.all_day, hh.time_known, hh.source_url, hh.notes, hh.created_at,
           coalesce(
             json_agg(json_build_object(
               'name', o.name, 'description', o.description, 'priceCents', o.price_cents
             ) ORDER BY o.price_cents DESC NULLS LAST)
             FILTER (WHERE o.id IS NOT NULL), '[]'
           ) AS offerings
    FROM happy_hours hh
    JOIN venues v ON v.id = hh.venue_id
    JOIN cities c ON c.id = v.city_id
    LEFT JOIN offerings o
      ON o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active
    WHERE NOT hh.active AND hh.deleted_at IS NULL
      AND v.deleted_at IS NULL AND v.status = 'active' AND v.data_completeness = 'stub'
      AND NOT EXISTS (
        SELECT 1 FROM happy_hours a
        WHERE a.venue_id = v.id AND a.active AND a.deleted_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM audit_log al
        WHERE al.table_name = 'happy_hours' AND al.row_id = hh.id
          AND al.reason = ${REVIEW_KEEP_REASONS.hidden}
      )
    GROUP BY hh.id, v.id, c.name, v.name, v.website_url, v.hours_json
    ORDER BY c.name, v.name, hh.start_time NULLS LAST
  `);

  const createdAtById = new Map<string, string>();
  const entries: ReviewWindowEntry[] = rows.map((r) => {
    const shape = {
      daysOfWeek: r.days_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      allDay: r.all_day,
      timeKnown: r.time_known,
      sourceUrl: r.source_url,
      offerings: r.offerings.length,
      notes: r.notes,
    };
    createdAtById.set(r.happy_hour_id, new Date(r.created_at).toISOString());
    return {
      happyHourId: r.happy_hour_id,
      venueId: r.venue_id,
      city: r.city,
      venue: r.venue,
      websiteUrl: r.website_url,
      daysOfWeek: r.days_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      allDay: r.all_day,
      offerings: r.offerings,
      avgPriceCents: avgCents(r.offerings),
      sourceUrl: r.source_url,
      notes: r.notes,
      evidence: deleteEvidence(shape, r.hours_json),
      suggested: suggestAction(shape, r.hours_json) === "delete" ? "delete" : "keep_hidden",
      siblingWindows: [],
    };
  });
  await attachSiblingWindows(entries, createdAtById);
  return entries;
}

// ── operator decisions ───────────────────────────────────────────────────────────
// Hide reuses hideWindowForFlag (lib/audit/flagReview) — same reversible hide +
// stub-demotion the flag queue uses. The three below are the queue-specific writes.

/** Dismiss a window from its queue: audit-row marker only, no data change. */
export async function keepReviewWindow(
  dbx: Dbx,
  { happyHourId, queue, adminEmail }: { happyHourId: string; queue: ReviewQueueKind; adminEmail: string },
): Promise<void> {
  await dbx.insert(auditLog).values({
    tableName: "happy_hours",
    rowId: happyHourId,
    beforeJsonb: {},
    afterJsonb: {},
    actor: adminActor(adminEmail),
    reason: REVIEW_KEEP_REASONS[queue],
  });
}

export interface ReviewWriteResult {
  venueId: string;
  /** True when the action left the venue with no active windows → demoted to stub. */
  venueDemoted: boolean;
}

/** Operator delete: PERMANENT soft-delete — the persist path refuses to ever re-insert
 *  an operator-deleted window (no resurrection on re-extract). Demotes the venue to
 *  stub when its last active window goes. */
export async function deleteWindowForReview(
  dbx: Dbx,
  { happyHourId, adminEmail, reason }: { happyHourId: string; adminEmail: string; reason: string },
): Promise<ReviewWriteResult> {
  const [win] = await dbx
    .select({ id: happyHours.id, venueId: happyHours.venueId, active: happyHours.active })
    .from(happyHours)
    .where(and(eq(happyHours.id, happyHourId), isNull(happyHours.deletedAt)))
    .limit(1);
  if (!win) throw new Error("Window not found (already deleted?)");

  await dbx
    .update(happyHours)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(happyHours.id, happyHourId));
  await dbx.insert(auditLog).values({
    tableName: "happy_hours",
    rowId: happyHourId,
    beforeJsonb: { deletedAt: null, active: win.active },
    afterJsonb: { deletedAt: "now" },
    actor: adminActor(adminEmail),
    reason,
  });

  const remaining = await dbx
    .select({ id: happyHours.id })
    .from(happyHours)
    .where(and(eq(happyHours.venueId, win.venueId), eq(happyHours.active, true), isNull(happyHours.deletedAt)))
    .limit(1);
  let venueDemoted = false;
  if (remaining.length === 0) {
    const demoted = await dbx
      .update(venues)
      .set({ dataCompleteness: "stub", updatedAt: new Date() })
      .where(and(eq(venues.id, win.venueId), inArray(venues.dataCompleteness, ["complete", "verified"])))
      .returning({ id: venues.id });
    venueDemoted = demoted.length > 0;
  }
  return { venueId: win.venueId, venueDemoted };
}

/** Operator promote: hidden window goes LIVE. Only valid after the operator has
 *  verified the happy hour themselves — the queues never suggest it. Mirrors
 *  review:hidden --apply promote (window active + stub venue → complete). */
export async function promoteHiddenWindow(
  dbx: Dbx,
  { happyHourId, adminEmail }: { happyHourId: string; adminEmail: string },
): Promise<ReviewWriteResult> {
  const [win] = await dbx
    .select({ id: happyHours.id, venueId: happyHours.venueId })
    .from(happyHours)
    .where(and(eq(happyHours.id, happyHourId), isNull(happyHours.deletedAt), eq(happyHours.active, false)))
    .limit(1);
  if (!win) throw new Error("Window not found (already live or deleted?)");

  await dbx
    .update(happyHours)
    .set({ active: true, updatedAt: new Date() })
    .where(eq(happyHours.id, happyHourId));
  await dbx
    .update(venues)
    .set({ dataCompleteness: "complete", lastVerifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(venues.id, win.venueId), eq(venues.dataCompleteness, "stub")));
  await dbx.insert(auditLog).values({
    tableName: "happy_hours",
    rowId: happyHourId,
    beforeJsonb: { active: false },
    afterJsonb: { active: true },
    actor: adminActor(adminEmail),
    reason: "hidden-window review: operator promote",
  });
  return { venueId: win.venueId, venueDemoted: false };
}
