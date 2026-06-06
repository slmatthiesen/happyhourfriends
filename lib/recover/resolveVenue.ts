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
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { venues, cities, happyHours, offerings, auditLog } from "@/db/schema";
import { aiUsageLedger } from "@/db/schema/ops";
import { extractHappyHours, type ExtractResult } from "@/lib/ai/extractHappyHours";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { assessRealness } from "@/lib/places/realnessGate";
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

  let live = 0;
  let hidden = 0;
  for (const hh of extracted.happyHours) {
    const days = [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
    const verdict = assessRealness({
      allDay: hh.allDay,
      dayCount: days.length,
      timeKnown: hh.timeKnown,
      confidence: extracted.confidence,
    });
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
        active: !verdict.suspect && !hh.suspect,
        extractConfidence: String(extracted.confidence),
        timeKnown: hh.timeKnown,
        sourceUrl: hh.sourceUrl,
      })
      .onConflictDoNothing()
      .returning({ id: happyHours.id });
    if (!row) continue; // duplicate window already present
    if (verdict.suspect) hidden++;
    else live++;
    for (const off of hh.offerings) {
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
      afterJsonb: { venueId, daysOfWeek: days, startTime: hh.startTime, endTime: hh.endTime, active: !verdict.suspect },
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
