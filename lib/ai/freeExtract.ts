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
import { parseHappyHours } from "@/lib/places/parseHhText";

export function freeExtractFromPages(
  pages: FetchedPage[],
  meta: { model: string; promptHash: string },
): ExtractResult | null {
  const happyHours: ExtractedHappyHour[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    for (const w of parseHappyHours(p.text ?? "", p.url)) {
      if (w.confidence !== "clean") continue;
      const key = `${w.daysOfWeek.join(",")}|${w.startTime}|${w.endTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      happyHours.push({
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
      });
    }
  }
  if (happyHours.length === 0) return null;
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
