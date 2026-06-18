/**
 * resolveVenue — turn ONE stub venue into a live listing, on demand. The shared core
 * behind the admin "Stub Resolver" page (and reusable by scripts). Two modes:
 *
 *   - auto (no urls): run the full discovery+extract pipeline (triageSite →
 *     extractHappyHours) on the venue, exactly like seed:enrich/reextract.
 *   - targeted (urls): the operator pasted a menu/PDF/image URL they found — extract
 *     straight from it (Tier-3 PDF/image + follow-one-hop apply here too).
 *
 * Found windows run through the same realness gate as enrich, are inserted as
 * happy_hours (+ offerings) with an audit_log row, and the venue is promoted to
 * 'complete' when at least one ACTIVE window lands. Every model call is ledgered.
 * Uses the drizzle client so it runs in the Next.js admin action and in tsx scripts.
 */
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { venues, cities, happyHours, offerings, auditLog } from "@/db/schema";
import { aiUsageLedger } from "@/db/schema/ops";
import { extractHappyHours, type ExtractResult } from "@/lib/ai/extractHappyHours";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { assessRealness } from "@/lib/places/realnessGate";
import { reconcileWindows, offeringsFingerprint, type ReconcileWindow } from "@/lib/places/windowReconcile";
import { sanitizeOfferings, offeringNameKey } from "@/lib/recover/offeringSanity";
import { isSourceProvenanceSuspect } from "@/lib/recover/sourceProvenance";
import { firstOfCurrentMonth } from "@/lib/ai/budget";

export interface ResolveResult {
  ok: boolean;
  recovered: boolean; // a venue went live (>=1 active window)
  windowsLive: number;
  windowsHidden: number;
  costCents: number;
  summary: string;
  fetchedUrls: string[]; // the priority URLs we tried
  error?: string;
}

export interface ResolveOptions {
  venueId: string;
  /** Operator-supplied menu/PDF/image URL(s). Empty → auto-discover via triage. */
  urls?: string[];
  /** Who triggered it (admin email or 'script'), for the audit log. */
  actor?: string;
}

export interface PersistOptions {
  venueId: string;
  cityId: string;
  extracted: ExtractResult;
  actor: string;
}

/** Minimal surface we need from the drizzle client OR a transaction handle. */
type Executor = Pick<typeof db, "execute">;

/**
 * Supersede stale bare duplicates for one venue. A re-extraction that pins a window to a
 * specific area (location 'bar'/'patio') doesn't match the older location-agnostic ('all')
 * row on the natural key, so the upsert INSERTs a second row instead of replacing it —
 * leaving two same-time windows (one bare 'all', one with the deals). Soft-delete the
 * redundant bare 'all' window whenever a same-time sibling in a specific area now carries
 * offerings. Scoped to the 'all' catch-all only: two distinct specific areas (bar vs patio)
 * still coexist, and a bare window with no priced sibling is left for review. Soft-delete
 * (active=false + deleted_at) so the natural-key index frees up and it never resurrects.
 */
export async function supersedeBareLocationDuplicates(
  executor: Executor,
  venueId: string,
): Promise<void> {
  await executor.execute(sql`
    UPDATE happy_hours h
       SET active = false, deleted_at = now(), updated_at = now()
     WHERE h.venue_id = ${venueId}
       AND h.active = true AND h.deleted_at IS NULL
       AND h.location_within_venue = 'all'
       AND NOT EXISTS (
         SELECT 1 FROM offerings o WHERE o.happy_hour_id = h.id AND o.deleted_at IS NULL)
       AND EXISTS (
         SELECT 1 FROM happy_hours s
           JOIN offerings o2 ON o2.happy_hour_id = s.id AND o2.deleted_at IS NULL
          WHERE s.venue_id = h.venue_id AND s.id <> h.id
            AND s.active = true AND s.deleted_at IS NULL
            AND s.location_within_venue <> 'all'
            AND s.days_of_week = h.days_of_week
            AND s.start_time IS NOT DISTINCT FROM h.start_time
            AND s.end_time   IS NOT DISTINCT FROM h.end_time
            AND s.all_day = h.all_day)
  `);
}

/**
 * The ONE persist path — shared by resolveVenue (admin) and scripts/reextract-stubs.ts.
 * Ledger the model call, insert realness-gated windows + offerings + audit, and promote
 * the venue to 'complete' when at least one ACTIVE window lands. Idempotent
 * (ON CONFLICT DO NOTHING). Call once per extracted result, even when it has 0 windows
 * (the ledger still records the call).
 */
export async function persistExtractedWindows(
  opts: PersistOptions,
): Promise<{ windowsLive: number; windowsHidden: number; recovered: boolean; hiddenReasons: string[] }> {
  const { venueId, cityId, extracted, actor } = opts;

  await db.insert(aiUsageLedger).values({
    month: firstOfCurrentMonth(),
    model: extracted.model,
    inputTokens: extracted.usage.inputTokens,
    outputTokens: extracted.usage.outputTokens,
    costCents: extracted.costCents,
    stage: "seed",
    cityId,
    promptHash: extracted.promptHash,
  });

  const [venueRow] = await db
    .select({ hoursJson: venues.hoursJson, websiteUrl: venues.websiteUrl, priceLevel: venues.priceLevel })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);

  // offeringsKey keeps same-time windows with DIFFERENT offerings (per-day specials)
  // from merging — only true duplicates (same times AND same deals) union their days.
  const hhOfferingsKey = (hh: (typeof extracted.happyHours)[number]) =>
    offeringsFingerprint(hh.offerings.map((o) => ({ name: o.name, priceCents: o.priceCents })));
  const reconWindows: ReconcileWindow[] = extracted.happyHours.map((hh) => ({
    daysOfWeek: hh.daysOfWeek,
    startTime: hh.startTime,
    endTime: hh.endTime,
    allDay: hh.allDay,
    offeringsKey: hhOfferingsKey(hh),
    location: hh.locationWithinVenue,
  }));
  const reconResults = reconcileWindows(reconWindows, venueRow?.hoursJson ?? null);
  // Align reconcile verdicts back to source rows by identity index. reconcileWindows
  // may MERGE rows, so map each original hh to the reconciled result whose merged day-set
  // covers it and whose (start,end,allDay,offeringsKey) match.
  function reconFor(hh: (typeof extracted.happyHours)[number]) {
    const key = hhOfferingsKey(hh);
    return reconResults.find(
      (r) =>
        r.window.startTime === hh.startTime &&
        r.window.endTime === hh.endTime &&
        r.window.allDay === hh.allDay &&
        (r.window.offeringsKey ?? "") === key,
    );
  }

  let live = 0;
  let hidden = 0;
  // Why each hidden window was hidden — surfaced in the return so callers (seed:enrich
  // report, admin) can tell the operator what to review without re-deriving the gates.
  const hiddenReasons = new Set<string>();
  for (const hh of extracted.happyHours) {
    const recon = reconFor(hh);
    const reconActive = recon ? recon.active : true;
    const days = recon ? recon.window.daysOfWeek : [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
    const verdict = assessRealness({
      allDay: hh.allDay,
      dayCount: days.length,
      timeKnown: hh.timeKnown,
      confidence: extracted.confidence,
      mealSpecial: {
        startTime: hh.startTime,
        endTime: hh.endTime,
        notes: hh.notes,
        sourceUrl: hh.sourceUrl,
        offerings: hh.offerings.map((o) => ({
          name: o.name,
          description: o.description,
          priceCents: o.priceCents,
        })),
      },
    });
    // An operator-deleted window must NEVER come back: the natural-key unique index is
    // partial (deleted_at IS NULL), so a re-extraction of the same page would re-insert
    // the same service-hours window as a fresh row and it would reappear in every
    // hidden-window review. Soft-deleted = the operator ruled "not a happy hour" — final.
    const loc = (hh.locationWithinVenue ?? "all") as string;
    const [nuked] = await db
      .select({ id: happyHours.id })
      .from(happyHours)
      .where(
        and(
          eq(happyHours.venueId, venueId),
          sql`${happyHours.deletedAt} IS NOT NULL`,
          eq(happyHours.daysOfWeek, days),
          sql`${happyHours.startTime} IS NOT DISTINCT FROM ${hh.startTime}::time`,
          sql`${happyHours.endTime} IS NOT DISTINCT FROM ${hh.endTime}::time`,
          sql`${happyHours.locationWithinVenue}::text = ${loc}`,
        ),
      )
      .limit(1);
    if (nuked) continue;
    // Source/provenance integrity (diagnosis 2026-06-13, bucket #1): hide a window whose
    // source_url is not the venue's own site (e.g. Depot Bar sourced thedepotbar.com for a
    // .shop venue; Blanco sourced a sibling-brand domain). Non-destructive — the operator
    // reviews hidden windows. No opinion when we can't compare (no website / menu host).
    const provenanceSuspect = isSourceProvenanceSuspect(hh.sourceUrl, venueRow?.websiteUrl ?? null);
    // Hidden if the realness gate is suspicious OR the free parser flagged the window
    // implausible OR the reconcile gate marked it inactive (operating-hours / overlap)
    // OR the source doesn't trace to the venue's own site.
    // Used for the insert, the live/hidden tally, AND the audit row so all three agree.
    const isActive = !verdict.suspect && !hh.suspect && reconActive && !provenanceSuspect;
    const [row] = await db
      .insert(happyHours)
      .values({
        venueId,
        daysOfWeek: days,
        allDay: hh.allDay,
        startTime: hh.startTime,
        endTime: hh.endTime,
        locationWithinVenue: hh.locationWithinVenue as typeof happyHours.$inferInsert["locationWithinVenue"],
        notes: hh.notes,
        active: isActive,
        extractConfidence: String(extracted.confidence),
        timeKnown: hh.timeKnown,
        sourceUrl: hh.sourceUrl,
      })
      .onConflictDoUpdate({
        // A re-extraction with the SAME natural key ENRICHES the existing window instead of being
        // dropped. The old onConflictDoNothing + `if (!row) continue` silently lost a better
        // re-extraction's offerings onto a stale empty window (alaMar: 12 offerings → 0). Here we
        // reactivate a hidden window when the new data is plausible, never downgrade a live one,
        // and refresh provenance. Offerings are deduped below so re-applying never multiplies them.
        target: [happyHours.venueId, happyHours.daysOfWeek, happyHours.startTime, happyHours.endTime, happyHours.locationWithinVenue],
        targetWhere: sql`${happyHours.deletedAt} IS NULL`,
        set: {
          active: sql`${happyHours.active} OR ${isActive}`,
          sourceUrl: hh.sourceUrl,
          notes: hh.notes,
          updatedAt: new Date(),
        },
      })
      .returning({ id: happyHours.id, active: happyHours.active });
    if (!row) continue; // upsert always returns a row; guard satisfies the type
    if (row.active) {
      live++;
    } else {
      hidden++;
      // Aggregate every gate that voted this window down, for the caller's report.
      if (verdict.suspect) for (const r of verdict.reasons) hiddenReasons.add(r);
      if (!reconActive && recon) for (const r of recon.reasons) hiddenReasons.add(r);
      if (provenanceSuspect) hiddenReasons.add("source_provenance");
      if (hh.suspect) hiddenReasons.add("free_parse_implausible");
    }
    // Insert only offerings not already on this window (key by name+price) — re-extraction must
    // not duplicate the existing set, but must add any the prior pass missed.
    const existingOff = await db
      .select({ name: offerings.name, priceCents: offerings.priceCents })
      .from(offerings)
      .where(and(eq(offerings.happyHourId, row.id), eq(offerings.active, true)));
    // Key matches sanitizeOfferings' dedupe identity (case/price-prefix-insensitive) so a
    // re-extraction's "All shareables" doesn't duplicate a stored "All Shareables".
    const seenOff = new Set(existingOff.map((o) => `${offeringNameKey(o.name)}|${o.priceCents ?? ""}`));
    // $0 deterministic cleanup: dedupe exact repeats, re-kind food mislabeled as drink,
    // and flag day-specific items that don't match this window's days (warn-only).
    const sanitized = sanitizeOfferings(hh.offerings, days, { priceLevel: venueRow?.priceLevel ?? null });
    for (const off of sanitized.offerings) {
      const offKey = `${offeringNameKey(off.name)}|${off.priceCents ?? ""}`;
      if (seenOff.has(offKey)) continue;
      seenOff.add(offKey);
      await db.insert(offerings).values({
        happyHourId: row.id,
        kind: off.kind as typeof offerings.$inferInsert["kind"],
        category: off.category as typeof offerings.$inferInsert["category"],
        name: off.name,
        priceCents: off.priceCents,
        originalPriceCents: off.originalPriceCents,
        discountCents: off.discountCents,
        description: off.description,
        conditions: off.conditions,
        sourceUrl: off.sourceUrl,
        active: true,
      });
    }
    const reasonNotes: string[] = [];
    if (sanitized.warnings.length > 0) reasonNotes.push(`offering sanity: ${sanitized.warnings.join("; ")}`);
    if (provenanceSuspect) reasonNotes.push(`source provenance: hidden, ${hh.sourceUrl} is not the venue's own site`);
    await db.insert(auditLog).values({
      tableName: "happy_hours",
      rowId: row.id,
      beforeJsonb: null,
      afterJsonb: { venueId, daysOfWeek: days, startTime: hh.startTime, endTime: hh.endTime, active: isActive },
      actor,
      reason: reasonNotes.length > 0 ? `stub resolve (${reasonNotes.join("; ")})` : "stub resolve",
    });
  }

  await supersedeBareLocationDuplicates(db, venueId);

  const recovered = live > 0;
  if (recovered) {
    await db
      .update(venues)
      .set({ dataCompleteness: "complete", lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(venues.id, venueId));
  }
  return { windowsLive: live, windowsHidden: hidden, recovered, hiddenReasons: [...hiddenReasons] };
}

export async function resolveVenue(opts: ResolveOptions): Promise<ResolveResult> {
  const actor = opts.actor ?? "admin";
  const empty: ResolveResult = {
    ok: false, recovered: false, windowsLive: 0, windowsHidden: 0, costCents: 0, summary: "", fetchedUrls: [],
  };

  const [venue] = await db
    .select({ id: venues.id, name: venues.name, websiteUrl: venues.websiteUrl, cityId: venues.cityId })
    .from(venues)
    .where(eq(venues.id, opts.venueId))
    .limit(1);
  if (!venue) return { ...empty, error: "venue not found" };

  const [city] = await db.select({ name: cities.name }).from(cities).where(eq(cities.id, venue.cityId)).limit(1);
  const cityName = city?.name ?? null;

  // Discover priority URLs: operator-supplied, else auto via triage.
  let priorityUrls = (opts.urls ?? []).filter((u) => u.trim().length > 0);
  if (priorityUrls.length === 0) {
    if (!venue.websiteUrl) return { ...empty, error: "no website on file and no URL supplied" };
    const verdict = await triageSite({ websiteUri: venue.websiteUrl, name: venue.name, cityName });
    const decided = resolveEnrichAction(
      verdict,
      hhLikelihood({ primaryType: null, types: null, name: venue.name }),
    );
    priorityUrls = decided.priorityUrls;
  }

  const extracted = await extractHappyHours({
    venueName: venue.name,
    websiteUrl: venue.websiteUrl,
    otherUrl: null,
    cityName,
    priorityUrls,
  });

  const { windowsLive, windowsHidden, recovered } = await persistExtractedWindows({
    venueId: venue.id,
    cityId: venue.cityId,
    extracted,
    actor,
  });
  return {
    ok: true,
    recovered,
    windowsLive,
    windowsHidden,
    costCents: extracted.costCents,
    summary: extracted.summary,
    fetchedUrls: priorityUrls,
  };
}
