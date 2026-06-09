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

export interface EscalationInput {
  /** Triage-ranked candidate URLs (resolveEnrichAction.priorityUrls). */
  priorityUrls: string[];
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
  const hhPages = input.priorityUrls.filter((u) => scoreHhUrl(u) >= 60);
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
