/**
 * freeExtract — bridge the deterministic parser (lib/places/parseHhText) to the
 * persist layer's ExtractResult, so a $0 HTML parse flows through the exact same
 * audited write path as the paid extractor (lib/recover/resolveVenue).
 *
 * Returns null when there is NO clean window — the caller then escalates to the
 * paid extractor. CLEAN-but-implausible windows ARE returned, marked `suspect` so
 * persist writes them hidden (active=false): the venue stays a stub for review.
 */
import { pagesShowDroppedDeals, type FetchedPage } from "@/lib/ai/siteContent";
import type { ExtractResult, ExtractedHappyHour, ExtractedOffering } from "@/lib/ai/extractHappyHours";
import { parseHappyHours, type ParsedWindow } from "@/lib/places/parseHhText";
import { scoreHhUrl } from "@/lib/places/hhText";
import { hhmmToMin } from "@/lib/places/windowReconcile";

/**
 * Provenance score for cross-page dedup. When two pages yield the SAME window
 * (days+start+end), we keep the better-sourced one rather than whichever parsed first.
 * Stated days dominate any URL signal (1000 ≫ max URL score 110): a homepage that only
 * says "4pm-7pm" (days assumed) must never win over the venue's /happy-hour/ page that
 * states "Monday-Friday 4pm-7pm". This was the london-bar-grill bug.
 */
function provenanceScore(w: ParsedWindow): number {
  return (w.daysAssumed ? 0 : 1000) + scoreHhUrl(w.sourceUrl);
}

export function freeExtractFromPages(
  pages: FetchedPage[],
  meta: { model: string; promptHash: string },
): ExtractResult | null {
  // Best window per natural key, with its first-seen order so output stays stable.
  const byKey = new Map<string, { w: ParsedWindow; score: number; order: number }>();
  let order = 0;
  for (const p of pages) {
    for (const w of parseHappyHours(p.text ?? "", p.url)) {
      if (w.confidence !== "clean") continue;
      const key = `${w.daysOfWeek.join(",")}|${w.startTime}|${w.endTime}`;
      const score = provenanceScore(w);
      const existing = byKey.get(key);
      if (existing) {
        // Replace the kept window only if this one is better-sourced; keep its slot.
        if (score > existing.score) byKey.set(key, { w, score, order: existing.order });
        continue;
      }
      byKey.set(key, { w, score, order: order++ });
    }
  }
  if (byKey.size === 0) return null;
  const happyHours: ExtractedHappyHour[] = [...byKey.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ w }) => ({
      daysOfWeek: w.daysOfWeek,
      allDay: w.allDay,
      startTime: w.startTime,
      endTime: w.endTime,
      timeKnown: w.timeKnown,
      locationWithinVenue: w.locationWithinVenue,
      notes: w.notes,
      sourceUrl: w.sourceUrl,
      suspect: !w.plausible, // implausible → written hidden (active=false) for review
      offerings: w.offerings.map((o) => ({
        kind: o.kind,
        category: o.category,
        name: o.name,
        priceCents: o.priceCents,
        originalPriceCents: null,
        discountCents: o.discountCents,
        description: null,
        conditions: null,
        sourceUrl: o.sourceUrl,
      })),
    }));
  return {
    happyHours,
    confidence: 1,
    summary: `Deterministic HTML parse: ${happyHours.length} window(s).`,
    venueType: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    costCents: 0,
    promptHash: meta.promptHash,
    model: meta.model,
  };
}

/**
 * Should the enrich free-first gate ABANDON a $0 free parse and re-pay the extractor?
 * Yes only when the free parse produced window(s) but captured ZERO offerings WHILE the
 * fetched pages still carry real deal content — prices/discounts in text, or a menu PDF/
 * image the text parser can't read (pagesShowDroppedDeals). That's a recall miss on present
 * content (Santo Mezcal: "$9 cocktails" dropped to a bare window), not an empty listing.
 *
 * Returns false when `free` is null (the caller already escalates that case) and false for a
 * genuinely bare "Mon–Fri 3–6pm, no prices, no menu doc" page — that valid time-only window
 * stays for $0 and is never re-touched.
 */
export function shouldEscalateForDroppedDeals(free: ExtractResult | null, pages: FetchedPage[]): boolean {
  if (!free) return false;
  const hasOfferings = free.happyHours.some((w) => w.offerings.length > 0);
  return !hasOfferings && pagesShowDroppedDeals(pages);
}

const MIN_PER_DAY = 1440;

/** Effective [start,end] minute interval, or null when unpositionable (no start, not all-day). */
function windowInterval(startTime: string | null, endTime: string | null, allDay: boolean): [number, number] | null {
  if (allDay) return [0, MIN_PER_DAY];
  if (startTime == null) return null;
  const start = hhmmToMin(startTime);
  let end = endTime == null ? MIN_PER_DAY : hhmmToMin(endTime);
  if (endTime != null && end <= start) end += MIN_PER_DAY; // crosses midnight
  return [start, end];
}

function intervalsOverlap(a: [number, number] | null, b: [number, number] | null): boolean {
  if (!a || !b) return false;
  return a[0] < b[1] && b[0] < a[1];
}

/** 'all' (or null) is the whole venue and is compatible with anything; two DIFFERENT
 *  specific areas (bar vs patio) never share offerings. */
function locationCompatible(a: string, b: string): boolean {
  const la = a || "all";
  const lb = b || "all";
  return la === "all" || lb === "all" || la === lb;
}

const offeringKey = (o: ExtractedOffering): string =>
  `${(o.name ?? "").toLowerCase().trim()}|${o.priceCents ?? ""}|${(o.description ?? "").toLowerCase().trim()}`;

/** The two windows recur on at least one common ISO day — i.e. the same slot, not merely an
 *  overlapping clock-time on different days (a Sat brunch must not fold into a Mon-Fri window). */
function sharesADay(a: number[], b: number[]): boolean {
  const set = new Set(a);
  return b.some((d) => set.has(d));
}

/**
 * Reconcile a stable free-parse window set with a paid model re-extraction done ONLY to recover
 * dropped deals. The free windows' DAYS/TIMES win — they were parsed from explicit recurring text
 * ("Tuesday-Friday 4-6PM"), so they're stable run-to-run; the model supplies the OFFERINGS. This
 * kills the day-set flicker on sites that render a recurring HH as dated one-off promo cards
 * (SpotHopper: "Sunday Funday", "Trouble Tuesdays") that the model otherwise folds into the
 * recurring day-set differently on every run.
 *
 * Each free window keeps its days/time and gains the offerings of every model window whose days
 * overlap it at the same time and a compatible location (deduped). Model-only windows are
 * DROPPED — "explicit statement wins": a window the free parser didn't derive from explicit text
 * is exactly the dated-promo noise (SpotHopper "Sunday Funday" 4-6pm) whose day-set flickers run
 * to run. The result carries the model's cost/usage/confidence so the ledger reflects the call.
 *
 * Tradeoff (operator decision 2026-06-19): a genuinely separate recurring window that the free
 * parser missed AND that shares no day with any free window is also dropped. Rare — the free
 * parser captures any explicitly-stated window, and a deal window almost always shares a day with
 * the stated recurring one. Consistency is the goal here; the operator reviews each resolve.
 */
export function reconcileFreeDaysWithModelOfferings(free: ExtractResult, model: ExtractResult): ExtractResult {
  const freeWindows: ExtractedHappyHour[] = free.happyHours.map((f) => ({ ...f, offerings: [...f.offerings] }));
  const freeIntervals = freeWindows.map((f) => windowInterval(f.startTime, f.endTime, f.allDay));

  freeWindows.forEach((f, fi) => {
    const fiv = freeIntervals[fi];
    const seen = new Set(f.offerings.map(offeringKey));
    for (const m of model.happyHours) {
      if (!locationCompatible(f.locationWithinVenue, m.locationWithinVenue)) continue;
      if (!sharesADay(f.daysOfWeek, m.daysOfWeek)) continue;
      if (!intervalsOverlap(fiv, windowInterval(m.startTime, m.endTime, m.allDay))) continue;
      for (const off of m.offerings) {
        const k = offeringKey(off);
        if (seen.has(k)) continue;
        seen.add(k);
        f.offerings.push({ ...off, sourceUrl: off.sourceUrl || f.sourceUrl });
      }
    }
  });

  return { ...model, happyHours: freeWindows };
}
