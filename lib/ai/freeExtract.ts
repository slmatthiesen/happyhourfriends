/**
 * freeExtract — bridge the deterministic parser (lib/places/parseHhText) to the
 * persist layer's ExtractResult, so a $0 HTML parse flows through the exact same
 * audited write path as the paid extractor (lib/recover/resolveVenue).
 *
 * Returns null when there is NO clean window — the caller then escalates to the
 * paid extractor. CLEAN-but-implausible windows ARE returned, marked `suspect` so
 * persist writes them hidden (active=false): the venue stays a stub for review.
 */
import type { FetchedPage } from "@/lib/ai/siteContent";
import type { ExtractResult, ExtractedHappyHour } from "@/lib/ai/extractHappyHours";
import { parseHappyHours, type ParsedWindow } from "@/lib/places/parseHhText";
import { scoreHhUrl } from "@/lib/places/hhText";

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
