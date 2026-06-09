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

/**
 * The ONE persist path — shared by resolveVenue (admin) and scripts/reextract-stubs.ts.
 * Ledger the model call, insert realness-gated windows + offerings + audit, and promote
 * the venue to 'complete' when at least one ACTIVE window lands. Idempotent
 * (ON CONFLICT DO NOTHING). Call once per extracted result, even when it has 0 windows
 * (the ledger still records the call).
 */
export async function persistExtractedWindows(
  opts: PersistOptions,
): Promise<{ windowsLive: number; windowsHidden: number; recovered: boolean }> {
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
    .select({ hoursJson: venues.hoursJson })
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
  for (const hh of extracted.happyHours) {
    const recon = reconFor(hh);
    const reconActive = recon ? recon.active : true;
    const days = recon ? recon.window.daysOfWeek : [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
    const verdict = assessRealness({
      allDay: hh.allDay,
      dayCount: days.length,
      timeKnown: hh.timeKnown,
      confidence: extracted.confidence,
    });
    // Hidden if the realness gate is suspicious OR the free parser flagged the window
    // implausible OR the reconcile gate marked it inactive (operating-hours / overlap).
    // Used for the insert, the live/hidden tally, AND the audit row so all three agree.
    const isActive = !verdict.suspect && !hh.suspect && reconActive;
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
    if (row.active) live++;
    else hidden++;
    // Insert only offerings not already on this window (key by name+price) — re-extraction must
    // not duplicate the existing set, but must add any the prior pass missed.
    const existingOff = await db
      .select({ name: offerings.name, priceCents: offerings.priceCents })
      .from(offerings)
      .where(and(eq(offerings.happyHourId, row.id), eq(offerings.active, true)));
    const seenOff = new Set(existingOff.map((o) => `${o.name ?? ""}|${o.priceCents ?? ""}`));
    for (const off of hh.offerings) {
      const offKey = `${off.name ?? ""}|${off.priceCents ?? ""}`;
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
    await db.insert(auditLog).values({
      tableName: "happy_hours",
      rowId: row.id,
      beforeJsonb: null,
      afterJsonb: { venueId, daysOfWeek: days, startTime: hh.startTime, endTime: hh.endTime, active: isActive },
      actor,
      reason: "stub resolve",
    });
  }

  const recovered = live > 0;
  if (recovered) {
    await db
      .update(venues)
      .set({ dataCompleteness: "complete", lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(venues.id, venueId));
  }
  return { windowsLive: live, windowsHidden: hidden, recovered };
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
