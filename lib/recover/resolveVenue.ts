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
import { planBareSupersedes, type SupersedeWindow } from "@/lib/recover/supersedeBareWindows";
import { isSourceProvenanceSuspect } from "@/lib/recover/sourceProvenance";
import { firstOfCurrentMonth } from "@/lib/ai/budget";

export interface ResolveResult {
  ok: boolean;
  recovered: boolean; // a venue went live (>=1 active window)
  windowsLive: number;
  windowsHidden: number;
  offeringsAdded: number; // deals INSERTED this run (0 on a no-op re-find of an existing window)
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
  /** Force headless-render on every fetched URL regardless of the normal escalation heuristics —
   *  see ExtractInput.forceRender. For a known case of a client-side-only price/detail on an
   *  otherwise content-rich page, where the automatic gate correctly (for the general case)
   *  judges no render is needed. */
  forceRender?: boolean;
}

export interface PersistOptions {
  venueId: string;
  cityId: string;
  extracted: ExtractResult;
  actor: string;
  /**
   * Operator URL-resolve: treat the fresh extraction as authoritative, so a stale bare window
   * the new deal window time-covers (same slot, overlapping days) is retired rather than left
   * as a duplicate. Off for background enrich/reextract (conservative full-coverage supersede).
   */
  authoritative?: boolean;
  /**
   * Drop any extracted window that carries NO offerings before it is inserted. Used by the
   * bare-window heal (reextract --bare), whose ONLY job is to attach the missing deals to a
   * venue that already has a window — a re-extraction that re-derives a schedule but no deals
   * would otherwise add MORE empty windows (pure noise, the "+windows ≠ offerings" problem).
   * Existing windows are still enriched (the natural-key upsert), since a matching window with
   * offerings isn't dropped; only offering-less windows are skipped. Off for fresh stubs, where
   * a schedule-only window is the legitimate "help wanted" state.
   */
  requireOfferings?: boolean;
}

/** Minimal surface we need from the drizzle client OR a transaction handle. */
type Executor = Pick<typeof db, "execute">;

/**
 * Retire a venue's BARE happy-hour windows that its richer windows have made redundant, so a
 * re-extraction ADDS deals without leaving stale duplicates behind. Loads the venue's full
 * active window set (existing + just-inserted) and applies planBareSupersedes — the pure,
 * unit-tested decision (lib/recover/supersedeBareWindows). Only ever soft-deletes BARE windows
 * (0 offerings) and only when their every day+time is preserved by a deal-carrying window
 * (full coverage) or they duplicate a same-time bare 'all' window. Soft-delete (active=false +
 * deleted_at) frees the natural-key index so the row never resurrects. Returns retired ids.
 */
export async function supersedeBareWindowsForVenue(
  executor: Executor,
  venueId: string,
  opts: { authoritative?: boolean } = {},
): Promise<string[]> {
  const rows = await executor.execute<{
    id: string;
    days: number[];
    start: string | null;
    end: string | null;
    all_day: boolean;
    loc: string | null;
    offs: number;
  }>(sql`
    SELECT h.id, h.days_of_week AS days, h.start_time::text AS start, h.end_time::text AS "end",
           h.all_day, h.location_within_venue::text AS loc,
           (SELECT COUNT(*) FROM offerings o
              WHERE o.happy_hour_id = h.id AND o.active = true AND o.deleted_at IS NULL)::int AS offs
      FROM happy_hours h
     WHERE h.venue_id = ${venueId} AND h.active = true AND h.deleted_at IS NULL
  `);
  const windows: SupersedeWindow[] = [...rows].map((r) => ({
    id: r.id,
    daysOfWeek: r.days,
    startTime: r.start,
    endTime: r.end,
    allDay: r.all_day,
    location: r.loc,
    offeringCount: r.offs,
  }));
  const retire = planBareSupersedes(windows, { authoritative: opts.authoritative });
  for (const id of retire) {
    await executor.execute(sql`
      UPDATE happy_hours SET active = false, deleted_at = now(), updated_at = now() WHERE id = ${id}`);
  }
  return [...retire];
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
): Promise<{ windowsLive: number; windowsHidden: number; offeringsAdded: number; recovered: boolean; hiddenReasons: string[] }> {
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
  // Offerings (deals) actually INSERTED this run — distinct from `live` (windows that exist). A
  // re-find of a pre-existing bare window has live>0 but offeringsAdded=0; the admin UI keys its
  // success message off this so a $0 no-op never claims "deals found — refresh to see them".
  let offeringsAdded = 0;
  // Why each hidden window was hidden — surfaced in the return so callers (seed:enrich
  // report, admin) can tell the operator what to review without re-deriving the gates.
  const hiddenReasons = new Set<string>();
  for (const hh of extracted.happyHours) {
    // Bare-window heal: never add an offering-less window. The venue already has a bare window;
    // re-deriving a schedule with no deals adds noise, not the deals we came for.
    if (opts.requireOfferings && (hh.offerings?.length ?? 0) === 0) continue;
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
        daysOfWeek: days,
        hoursJson: venueRow?.hoursJson ?? null,
        offerings: hh.offerings.map((o) => ({
          name: o.name,
          description: o.description,
          priceCents: o.priceCents,
          kind: o.kind,
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
      .select({ id: offerings.id, name: offerings.name, priceCents: offerings.priceCents })
      .from(offerings)
      .where(and(eq(offerings.happyHourId, row.id), eq(offerings.active, true)));
    // Key matches sanitizeOfferings' dedupe identity (case/price-prefix-insensitive) so a
    // re-extraction's "All shareables" doesn't duplicate a stored "All Shareables".
    const seenOff = new Set(existingOff.map((o) => `${offeringNameKey(o.name)}|${o.priceCents ?? ""}`));
    // Same name, different price → the venue changed its price since the last extraction, not
    // a distinct item. Indexed by name only so a re-extraction can find the stale row and retire
    // it instead of leaving both prices live side by side (Lilac Montecito: Baked Oysters
    // $19 stayed live next to a freshly-extracted $24 because the old insert-only key was
    // name+price, so a price change never matched anything to replace).
    const existingByName = new Map(existingOff.map((o) => [offeringNameKey(o.name), o]));
    // $0 deterministic cleanup: dedupe exact repeats, re-kind food mislabeled as drink,
    // and flag day-specific items that don't match this window's days (warn-only).
    const sanitized = sanitizeOfferings(hh.offerings, days, { priceLevel: venueRow?.priceLevel ?? null });
    for (const off of sanitized.offerings) {
      const offKey = `${offeringNameKey(off.name)}|${off.priceCents ?? ""}`;
      if (seenOff.has(offKey)) continue;
      seenOff.add(offKey);
      const stale = existingByName.get(offeringNameKey(off.name));
      if (stale && stale.priceCents !== off.priceCents) {
        await db.update(offerings).set({ active: false }).where(eq(offerings.id, stale.id));
      }
      offeringsAdded++;
      await db.insert(offerings).values({
        happyHourId: row.id,
        kind: off.kind as typeof offerings.$inferInsert["kind"],
        category: off.category as typeof offerings.$inferInsert["category"],
        name: off.name,
        priceCents: off.priceCents,
        originalPriceCents: off.originalPriceCents,
        discountCents: off.discountCents,
        discountPercent: off.discountPercent,
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

  await supersedeBareWindowsForVenue(db, venueId, { authoritative: opts.authoritative });

  const recovered = live > 0;
  if (recovered) {
    await db
      .update(venues)
      .set({ dataCompleteness: "complete", lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(venues.id, venueId));
    // Release a venue Build A had hidden as a dead-end stub: an active HH just landed (Jina
    // recovery, regate, reextract), so flip status back to 'active'. SCOPED to no_happy_hour —
    // never overrides an operator's closed/paused.
    await db
      .update(venues)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(venues.id, venueId), eq(venues.status, "no_happy_hour")));
  }
  return { windowsLive: live, windowsHidden: hidden, offeringsAdded, recovered, hiddenReasons: [...hiddenReasons] };
}

export async function resolveVenue(opts: ResolveOptions): Promise<ResolveResult> {
  const actor = opts.actor ?? "admin";
  const empty: ResolveResult = {
    ok: false, recovered: false, windowsLive: 0, windowsHidden: 0, offeringsAdded: 0, costCents: 0, summary: "", fetchedUrls: [],
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
  // An operator who pasted a URL is asserting "this page is the truth" — let the fresh
  // extraction win over stale bare windows it time-covers (authoritative supersede). Auto
  // discovery (no URL) stays conservative.
  const operatorSupplied = priorityUrls.length > 0;
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
    // A deliberate operator paste asserts "the HH is on this page" — guarantee escalation past a
    // $0 bare window (resolveStubAction's contract: one operator click = one paid call if needed).
    assertHasHappyHour: operatorSupplied,
    forceRender: opts.forceRender,
  });

  const { windowsLive, windowsHidden, offeringsAdded, recovered } = await persistExtractedWindows({
    venueId: venue.id,
    cityId: venue.cityId,
    extracted,
    actor,
    authoritative: operatorSupplied,
  });
  return {
    ok: true,
    recovered,
    windowsLive,
    windowsHidden,
    offeringsAdded,
    costCents: extracted.costCents,
    summary: extracted.summary,
    fetchedUrls: priorityUrls,
  };
}
