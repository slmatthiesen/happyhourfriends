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
import { scoreHhUrl, matchesHappyHour, isDrinkOrHhPageUrl } from "@/lib/places/hhText";
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

export type EscalationRoute = "free" | "paid" | "skip";

/**
 * Phase-2 routing for a flagged venue's fetched HH pages (operator policy B): reserve the paid
 * model for what the deterministic free parser fundamentally can't read, take the $0 free parse
 * when it already found a real stocked window, and skip when there's nothing to read.
 *   - skip:  no usable page content was fetched.
 *   - paid:  any page is a PDF/image (a doc — needs the vision model), OR the HTML free parse
 *            missed / returned only thin (no-offering) or suspect windows.
 *   - free:  pure-HTML pages AND the free parse yielded a clean, non-suspect window carrying
 *            ≥1 offering — apply it for $0, no model call.
 * Pure ($0, no DB/network/AI) — the doc check runs BEFORE trusting any free window so a thin
 * HTML window can never short-circuit a linked PDF that holds the real offerings.
 */
export function routeEscalation(
  pages: FetchedPage[],
  freeResult: { happyHours: { suspect?: boolean; offerings: unknown[] }[] } | null,
  /** The flagged HH page's URL. A literal happy-hour page (scoreHhUrl>=100) makes ANY doc it
   *  resolves to worth a vision call (Oeste's opaquely-named CDN PDF); a drink/cocktail page url
   *  escalates on its own (drink menus can carry HH — operator's call). */
  hhPageUrl = "",
): EscalationRoute {
  const usable = pages.filter((p) => p.text || p.pdfBase64 || p.imageBase64);
  if (usable.length === 0) return "skip";
  const freeWindows = freeResult?.happyHours ?? [];
  // Free parse already found a clean window WITH offerings → take it for $0.
  if (freeWindows.some((w) => !w.suspect && w.offerings.length > 0)) return "free";
  // Free parse found a CLEAN window but thin (no offerings) → the model may find the offerings.
  // NOTE: only NON-suspect windows count. parseHhText hallucinates suspect junk windows from
  // unrelated text (Marisol's hotel-package page → a bogus 2am-8pm window; Giuseppe's lunch/dinner
  // hours → bogus windows); escalating on those was the Five-Cities waste.
  if (freeWindows.some((w) => !w.suspect)) return "paid";
  // No clean window. Only pay the model for a genuine HH lead:
  //   - an HH-RELEVANT doc: a PDF/image whose own filename is HH-named (scoreHhUrl>=60: happy-hour/
  //     specials/drink/cocktail/wine), OR any doc when the HH page is a literal happy-hour page. A
  //     generic Dinner/Bar/Dessert-Menu.pdf scores 0 and is NOT worth a vision call.
  //   - HTML text that LITERALLY says "happy hour" (NOT a day+time pattern — that matched Giuseppe's
  //     operating hours on /about; the parser already turns real day+time windows into clean rows).
  //   - or the flagged page is itself a drink/cocktail/happy-hour URL (drink menus can carry HH).
  // Bare "specials" packages, /about hours, covid notices, generic/food menus → skip at $0.
  const hhPageScore = scoreHhUrl(hhPageUrl);
  const hhDoc = usable.some(
    (p) => (p.pdfBase64 || p.imageBase64) && (scoreHhUrl(p.url) >= 60 || hhPageScore >= 100),
  );
  const hhText = usable.some((p) => p.text != null && matchesHappyHour(p.text));
  return hhDoc || hhText || isDrinkOrHhPageUrl(hhPageUrl) ? "paid" : "skip";
}
