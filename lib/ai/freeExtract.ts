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
import type { ExtractResult, ExtractedHappyHour } from "@/lib/ai/extractHappyHours";
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
        discountPercent: null,
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
  return freeLacksOfferings(free) && pagesShowDroppedDeals(pages);
}

/**
 * True when the free parse produced window(s) but NONE carry an offering — a "bare window".
 * The operator-asserted extract path (a deliberate URL paste) escalates on this alone, WITHOUT
 * the pagesShowDroppedDeals page-signal requirement: the operator has asserted the deals are on
 * the page, so even when the discovery scanners missed the menu doc (no fetched signal to detect),
 * we still pay the model to read what we have rather than return a false-success $0 bare window.
 */
export function freeLacksOfferings(free: ExtractResult | null): boolean {
  return !!free && !free.happyHours.some((w) => w.offerings.length > 0);
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

/** Same positioned clock interval — both bounded and identical, not merely overlapping. Two null
 *  (unpositionable) intervals are NOT a confident match (we can't confirm they're the same slot). */
function sameInterval(a: [number, number] | null, b: [number, number] | null): boolean {
  return a != null && b != null && a[0] === b[0] && a[1] === b[1];
}

/** 'all' (or null) is the whole venue and is compatible with anything; two DIFFERENT
 *  specific areas (bar vs patio) never share offerings. */
function locationCompatible(a: string, b: string): boolean {
  const la = a || "all";
  const lb = b || "all";
  return la === "all" || lb === "all" || la === lb;
}

/** The two windows recur on at least one common ISO day — i.e. the same slot, not merely an
 *  overlapping clock-time on different days (a Sat brunch must not fold into a Mon-Fri window). */
function sharesADay(a: number[], b: number[]): boolean {
  const set = new Set(a);
  return b.some((d) => set.has(d));
}

/**
 * Reconcile a stable free-parse window set with a paid model re-extraction done to recover dropped
 * deals. KEEP-ALL (operator decision 2026-06-22): the model just read the authoritative source
 * (menu PDF / HH page) and is the authority on BOTH the offerings AND the window structure, so
 * EVERY model window is kept. The free parser contributes only ANTI-FLICKER: when a model window is
 * the SAME window as a free one (identical time-bounds, a shared ISO day, compatible location), the
 * model window adopts the free parser's day-set — some sites (SpotHopper) render a recurring HH as
 * dated one-off promo cards, so the model's recurring days flicker run-to-run while the free parser
 * read explicit recurring text ("Tuesday-Friday 4-6PM") and is stable.
 *
 * Why keep-all, and not DROP model-only windows (the prior design): a window dropped HERE never
 * reaches persistExtractedWindows, so it never hits the realness gate that would otherwise insert it
 * hidden (active=false) and surface it for review. Dropping = SILENT LOSS — and at reconcile time a
 * real recurring window read only from a PDF ("ALL DAY SATURDAY $2 off beer cans") is
 * indistinguishable from a dated promo, so the prior design lost it outright (Yellow Belly Tap SB,
 * 2026-06-22). Keeping = the realness gate hides genuine noise but nothing is lost; the operator
 * reviews it. A free window the model did NOT reproduce is also kept — a model recall miss must not
 * drop an explicitly-stated window. The result carries the model's cost/usage so the ledger is right.
 *
 * Residual tradeoff: a SpotHopper site whose dated promos flicker their day-set accumulates
 * near-duplicate promo windows across repeated re-extracts (distinct natural keys); the recurring
 * window itself stays stable, and reconcile:windows / mergeDuplicates collapse the dups.
 */
export function reconcileFreeDaysWithModelOfferings(free: ExtractResult, model: ExtractResult): ExtractResult {
  const freeWindows = free.happyHours;
  const freeIntervals = freeWindows.map((f) => windowInterval(f.startTime, f.endTime, f.allDay));
  const modelWindows: ExtractedHappyHour[] = model.happyHours.map((m) => ({ ...m, offerings: [...m.offerings] }));
  const freeMatched = new Array<boolean>(freeWindows.length).fill(false);

  for (const m of modelWindows) {
    const miv = windowInterval(m.startTime, m.endTime, m.allDay);
    const fi = freeWindows.findIndex(
      (f, i) =>
        locationCompatible(f.locationWithinVenue, m.locationWithinVenue) &&
        sharesADay(f.daysOfWeek, m.daysOfWeek) &&
        sameInterval(miv, freeIntervals[i]),
    );
    if (fi >= 0) {
      m.daysOfWeek = [...freeWindows[fi].daysOfWeek]; // adopt the free parser's stable days (anti-flicker)
      freeMatched[fi] = true;
    }
  }

  // A free window the model never reproduced is a model recall miss — keep it (never drop a window
  // pre-persist; the realness gate hides what it must, but nothing is silently lost).
  const unmatchedFree = freeWindows
    .filter((_, i) => !freeMatched[i])
    .map((f) => ({ ...f, offerings: [...f.offerings] }));

  return { ...model, happyHours: [...modelWindows, ...unmatchedFree] };
}
