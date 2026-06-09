/**
 * renderEscalation — pure detector for "this venue has an HH-specific page the free pass
 * could not extract from." The single, uniform trigger for the audit's paid render-escalation
 * (covers stubs AND flagged venues identically). NO DB, NO network, NO AI ($0, unit-tested).
 *
 * Escalate when there is a richer HH source we haven't captured:
 *   - unread_hh_page:      an HH-specific page (scoreHhUrl>0) triage found but the free pass
 *                          never read (a JS shell / PDF the plain fetch skipped).
 *   - hh_page_no_offerings: an HH-specific page was read, but the free windows carry NO
 *                          offerings (times without specials — the specials are likely in a PDF).
 */
import { scoreHhUrl } from "@/lib/places/hhText";
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";
import type { FetchedPage } from "@/lib/ai/siteContent";

export interface EscalationInput {
  /** CONFIRMED HH candidate URLs only (resolveEnrichAction.confirmedHhUrls) — anchor links,
   *  sitemap/Wix routes, linked menu docs; NEVER speculative `GUESS_MENU_PATHS`. Passing the
   *  flattened priorityUrls here reintroduces the soft-404 over-escalation the audit had. */
  confirmedHhUrls: string[];
  /** URLs the free pass actually read usable content from (built.pages[].url). */
  readUrls: string[];
  /** The free ExtractResult.happyHours (or null when the free pass returned nothing). */
  freeWindows: { offerings: unknown[] }[] | null;
}

export type EscalationReason = "unread_hh_page" | "hh_page_no_offerings";

export interface EscalationVerdict {
  escalate: boolean;
  reason: EscalationReason | null;
  hhPages: string[]; // the HH-specific pages found (for the report)
}

/** Strip a trailing slash so "/x/" and "/x" compare equal. */
function norm(u: string): string {
  return u.replace(/\/+$/, "");
}

export function needsRenderEscalation(input: EscalationInput): EscalationVerdict {
  // Threshold ≥ 60: explicit HH pages (100+), specials (70), and drink/cocktail menus (60).
  // Generic menu paths (score 30–40) are not HH-specific enough to justify escalation.
  // HH-specific (score ≥ 60) AND first-party: a denylisted-aggregator page would be paid for
  // and then rejected by the §13 source guard, so drop it before it can escalate (condition 3).
  const hhPages = input.confirmedHhUrls.filter((u) => scoreHhUrl(u) >= 60 && !isDenylistedSource(u));
  if (hhPages.length === 0) return { escalate: false, reason: null, hhPages: [] };

  const read = new Set(input.readUrls.map(norm));
  const unreadHhPage = hhPages.some((u) => !read.has(norm(u)));
  if (unreadHhPage) return { escalate: true, reason: "unread_hh_page", hhPages };

  const noOfferings =
    !!input.freeWindows &&
    input.freeWindows.length > 0 &&
    input.freeWindows.every((w) => w.offerings.length === 0);
  if (noOfferings) return { escalate: true, reason: "hh_page_no_offerings", hhPages };

  return { escalate: false, reason: null, hhPages };
}

export type EscalationRoute = "free" | "paid" | "skip" | "relevance-check";

/**
 * Phase-2 STRUCTURAL routing for a flagged venue's fetched HH pages. The paid-vs-skip
 * RELEVANCE judgment for ambiguous HTML is no longer made here (URL/keyword heuristics were
 * brittle) — it returns "relevance-check" and the async caller asks the Haiku gate
 * (classifyHhRelevance). Pure ($0, no DB/network/AI), so it stays unit-testable.
 *   - skip:            no usable page content was fetched.
 *   - free:            free parse yielded a clean, non-suspect window carrying >=1 offering.
 *   - paid:            a clean-but-thin (no-offering) window (model finds the offerings), OR
 *                      any PDF/image doc (a single vision call extracts, or returns [] on junk
 *                      — a separate relevance read would re-pay the doc input).
 *   - relevance-check: HTML with no clean window and no doc — let the Haiku gate decide.
 * Suspect-only free windows are parser NOISE and are ignored here (never an escalation signal).
 */
export function routeEscalation(
  pages: FetchedPage[],
  freeResult: { happyHours: { suspect?: boolean; offerings: unknown[] }[] } | null,
): EscalationRoute {
  const usable = pages.filter((p) => p.text || p.pdfBase64 || p.imageBase64);
  if (usable.length === 0) return "skip";
  const freeWindows = freeResult?.happyHours ?? [];
  // Free parse already found a clean window WITH offerings → take it for $0.
  if (freeWindows.some((w) => !w.suspect && w.offerings.length > 0)) return "free";
  // Clean but thin (no offerings) → the model may find the offerings (e.g. in a linked doc).
  if (freeWindows.some((w) => !w.suspect)) return "paid";
  // No clean window. A doc always extracts; ambiguous HTML goes to the Haiku relevance gate.
  const hasDoc = usable.some((p) => p.pdfBase64 || p.imageBase64);
  if (hasDoc) return "paid";
  return "relevance-check";
}
