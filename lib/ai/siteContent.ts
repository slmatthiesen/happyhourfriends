/**
 * Free, robots-aware site-content fetcher for the AI seed/reverify paths. We fetch the
 * venue's known pages OURSELVES over plain HTTP (via lib/verification/fetchUrl — no
 * Anthropic billing) and render them as model content blocks, so the model is given NO
 * web tools and cannot autonomously incur web_search/web_fetch charges. Shared by the
 * extractor (extractHappyHours) and the adversarial reverifier (reverify/adversarial).
 */
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { fetchUrl, type FetchResult, type ImageMediaType } from "@/lib/verification/fetchUrl";
import { hasHhOrDealSignal, hasPriceOrDealSignal, scoreHhUrl, TIME_RANGE_RE } from "@/lib/places/hhText";

// Bound the document (PDF/image) payload fed to the model. A venue with many menu
// PDFs (Bottega has 6) overwhelms the extractor — 6/4.5MB returned nothing, while
// ~4/2.4MB extracts cleanly. Cap by count AND bytes; text pages are always included.
const MAX_DOC_PAGES = 5;
// 10MB (was 3MB): real venues publish the happy hour as ONE big menu PDF and nothing smaller
// carries the deals — Hula Hoops's HH lives in a 6.9MB Dinner-menu PDF that 3MB dropped,
// leaving a bare window. We now rank the HH-context-linked doc first (see selectDocsWithinBudget
// + extractMediaLinks), so the budget only has to fit that ONE doc; 10MB raw (~13MB base64) is
// well under the Anthropic 32MB request ceiling. Env-overridable (paired with fetchUrl's
// FETCH_MAX_PDF_BYTES) for the rare oversized menu (e.g. Fate Brewing's 19MB HH PDF).
const MAX_DOC_BYTES = Number(process.env.FETCH_MAX_DOC_BYTES) || 10_000_000;
/** Statuses bot walls answer plain fetches with — a headless browser usually gets through. */
const BOT_WALL_STATUSES = new Set([401, 403, 406, 429]);
/** Below this many chars, a reachable page's stripped text is treated as a content-less SPA
 *  shell (a JS app frame whose real menu loads client-side) — Cheesecake Factory's happy-hour
 *  shell strips to 246 chars of footer ("Privacy Policy · © 2026"). */
const SPA_SHELL_TEXT_FLOOR = 600;

/**
 * Heuristic for "this page's stripped text is machine payload, not prose" — JS-walled
 * sites (Popmenu/Wix route manifests, telemetry configs) often strip to brace-heavy,
 * space-poor token soup that PASSES the has-text check and so never render-escalates
 * (Cala's route slugs, Ciao Grazie's telemetry JSON, 2026-06-10). Real menu/HH prose has
 * normal word spacing; code/JSON/slug dumps don't.
 */
/** Path carries year tokens and ALL of them are ≥2 years old — a dated menu doc that
 *  likely outlived its schedule (The Monica's happyhour-2-6.png under /uploads/2022/
 *  beat the homepage's current "3-6 PM" three extracts in a row). Mirrors the audit
 *  rule's stale-year logic; a path with no year tokens is never judged stale. */
export function isStaleDatedDocPath(url: string, now: Date = new Date()): boolean {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const years = [...path.matchAll(/(?<!\d)20\d{2}(?!\d)/g)].map((m) => Number(m[0]));
    if (years.length === 0) return false;
    return Math.max(...years) <= now.getFullYear() - 2;
  } catch {
    return false;
  }
}

export function looksLikeMachineText(text: string): boolean {
  const sample = text.slice(0, 3_000);
  if (sample.length < 200) return false; // tiny texts are judged by the empty-check instead
  const spaces = (sample.match(/ /g) ?? []).length / sample.length;
  const codey = (sample.match(/[{}[\]=;|/\\_]/g) ?? []).length / sample.length;
  return spaces < 0.08 || codey > 0.08;
}

/** A page we fetched ourselves, ready to drop into the model's content blocks. */
export interface FetchedPage {
  url: string;
  /** Stripped page text (HTML) — present for non-PDF pages that fetched OK. */
  text?: string;
  /** Base64 PDF bytes — present for PDF menus, handed over as a document block. */
  pdfBase64?: string;
  /** Base64 image bytes — present for image menus, handed over as a vision block. */
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
}

/**
 * Free pre-extraction gate: should these fetched pages be sent to the (paid) Claude
 * extractor at all? Escalate when ANY page carries a PDF/image menu we can't read for
 * free, OR any page's text shows a happy-hour/deal signal. Pages with none of that have
 * no happy hour to find — skip them at $0 instead of paying Claude to read "nothing here".
 */
export function pagesHaveExtractableSignal(pages: FetchedPage[]): boolean {
  return pages.some(
    (p) =>
      Boolean(p.pdfBase64) ||
      Boolean(p.imageBase64) ||
      (typeof p.text === "string" && hasHhOrDealSignal(p.text)),
  );
}

/**
 * Narrower than pagesHaveExtractableSignal: do these pages carry actual DEAL/PRICE content
 * the shallow text parser would drop? True when a page has a PDF/image menu (binary — the
 * free parser can't read it) OR its text shows a concrete price/discount (hasPriceOrDealSignal,
 * NOT a bare schedule). The escalation trigger when the $0 parse captured a window but ZERO
 * offerings: a bare "Mon–Fri 3–6pm, no prices, no menu doc" page returns false and stays $0;
 * Santo Mezcal ("$9 cocktails") or a venue whose deals live in a menu PDF returns true.
 */
export function pagesShowDroppedDeals(pages: FetchedPage[]): boolean {
  return pages.some(
    (p) =>
      Boolean(p.pdfBase64) ||
      Boolean(p.imageBase64) ||
      (typeof p.text === "string" && hasPriceOrDealSignal(p.text)),
  );
}

/**
 * A plain `#fragment` is the SAME document server-side: fetching /menu#happyhour and
 * /menu#exploremenu returns identical bytes. Strip it so same-page anchor links collapse to
 * one fetch target — but preserve hashbang / hash-route fragments (`#!/…`, `#/…`) that some
 * SPAs use as the actual route. */
export function stripPageAnchor(u: string): string {
  return u.replace(/#(?![!/]).*$/, "");
}

/** Dedup key for a fetch target: anchor-stripped + trailing-slash-normalised. */
export function fetchUrlKey(u: string): string {
  return stripPageAnchor(u).replace(/\/$/, "");
}

/**
 * The first `max` distinct fetch targets, in order, deduped by fetchUrlKey. Same-page anchors
 * and slash variants collapse so they don't burn slots a real menu image/PDF needs — Bei
 * Sushi's homepage links 4 same-page anchors (#happyhour, #exploremenu, …) that crowded its
 * happy-hour PNG out of the fetch budget, so the model never saw the deals. Returns the
 * anchor-stripped URL (a real, fetchable document).
 */
export function dedupeFetchTargets(urls: (string | null | undefined)[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== "string" || u.trim().length === 0) continue;
    const key = fetchUrlKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(stripPageAnchor(u));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Should we re-fetch `r` with the headless browser? The plain, robots-respecting fetch runs
 * first; the (slow) browser only helps when it can see MORE than that fetch did:
 *   - blockedByRobots — a robots-walled page/shortlink a real browser just loads.
 *   - bot wall (401/403/406/429) — refused to our UA, fine in a browser (veroamorepizza.com).
 *   - junk machine-text — SSR token-soup that needs JS to become readable.
 *   - empty shell — reachable, no text/doc/media → a JS app frame with nothing extracted.
 *   - boilerplate shell — reachable with only a SHORT, signal-less blurb (nav/footer) and no
 *     menu doc to follow: a JS-SPA menu whose content loads client-side. Catches platforms
 *     that (unlike Cheesecake Factory, which is robots-blocked) serve a non-empty shell the
 *     empty-shell branch never sees. Gated on no HH/deal/price signal so a real-but-terse HH
 *     page is never needlessly re-rendered, and on no media so a doc is followed instead.
 * NEVER for a genuine 404/410/dead URL — rendering misses would launch a browser per miss.
 * Pure + exported so the trigger is unit-testable without the network.
 */
export function needsBrowserRender(r: FetchResult): boolean {
  if (r.blockedByRobots === true) return true;
  if (!r.ok) return r.status != null && BOT_WALL_STATUSES.has(r.status);
  if (r.isPdf || r.isImage) return false;
  if (r.contentText) {
    if (looksLikeMachineText(r.contentText)) return true;
    if (r.mediaLinks && r.mediaLinks.length) return false; // a real menu doc to follow → no render
    return (
      r.contentText.length < SPA_SHELL_TEXT_FLOOR &&
      !hasHhOrDealSignal(r.contentText) &&
      !hasPriceOrDealSignal(r.contentText)
    );
  }
  return !(r.mediaLinks && r.mediaLinks.length); // empty shell with no doc to follow
}

/**
 * Fetch the given URLs over plain HTTP (deduped, capped). Order is preserved, so pass the
 * highest-signal URLs first. Failures (unreachable / robots-blocked / non-HTML-non-PDF)
 * are silently skipped — the returned list contains only pages with usable content.
 */
export async function fetchPages(
  urls: (string | null | undefined)[],
  max = 5,
  opts: {
    maxContent?: number;
    /** Headless-render fallback (lib/verification/renderUrl). INJECTED, not imported, so
     *  siteContent stays playwright-free for the app bundle. Used only when the plain,
     *  robots-respecting fetch yields nothing usable (a JS-SPA shell or a robots-blocked
     *  shortlink) — so normal venues never pay the browser cost. */
    render?: (url: string) => Promise<FetchResult>;
  } = {},
): Promise<FetchedPage[]> {
  const unique = dedupeFetchTargets(urls, max);
  // Plain fetch first; fall back to the headless render tier only when it can see MORE
  // (see needsBrowserRender).
  const fetchOne = async (u: string): Promise<FetchResult> => {
    const r = await fetchUrl(u, { maxContent: opts.maxContent });
    if (needsBrowserRender(r) && opts.render) {
      const rendered = await opts.render(u);
      if (rendered.ok) return rendered;
    }
    return r;
  };
  const results = await Promise.all(unique.map(fetchOne));
  const pages: FetchedPage[] = [];
  const seen = new Set(unique.map(fetchUrlKey));
  const follow: string[] = [];
  const docs: FetchResult[] = []; // PDF/image results, added later under a budget
  for (const r of results) {
    if (!r.ok) continue;
    if (r.isPdf || r.isImage) { docs.push(r); continue; }
    // Include the page text only when there is some — JS-shell homepages (Squarespace/Wix)
    // strip to empty.
    if (r.contentText) pages.push({ url: r.url, text: r.contentText });
    // Queue PDF/image menu links found in the RAW HTML even when the page stripped to
    // empty text. Those sites render no readable text but DO link their menu/HH PDFs in
    // the served HTML; gating this on contentText is why such venues became stubs despite
    // a reachable HH PDF (fetchUrl populates mediaLinks from raw HTML regardless of text).
    for (const m of r.mediaLinks ?? []) {
      const k = fetchUrlKey(m);
      if (!seen.has(k)) { seen.add(k); follow.push(m); }
    }
  }

  // Follow media links ONE HOP — the menu doc usually lives on a sub-page (e.g. /menus)
  // we'd otherwise only read as text. Bottega's happy-hour PDF is here.
  const toFollow = follow.slice(0, 6);
  if (toFollow.length > 0) {
    const more = await Promise.all(toFollow.map(fetchOne));
    for (const r of more) if (r.ok && (r.isPdf || r.isImage)) docs.push(r);
  }

  // Fresh page text outranks stale documents: when the page TEXT already states an
  // actual time-range schedule, skip docs whose path is dated ≥2 years old — the model
  // otherwise trusts a full (stale) menu image over the current text (The Monica's 2022
  // PNG vs the homepage's "3-6 PM"). A mere HH MENTION isn't enough to skip: a nav link
  // saying "Happy Hour" with no schedule means the doc IS the only schedule source
  // (Linger Longer's 2024 flyer is the venue's entire published schedule).
  const htmlStatesSchedule = pages.some(
    (p) => typeof p.text === "string" && TIME_RANGE_RE.test(p.text),
  );
  pages.push(
    ...selectDocsWithinBudget(docs, {
      maxBytes: MAX_DOC_BYTES,
      maxPages: MAX_DOC_PAGES,
      staleDated: htmlStatesSchedule ? isStaleDatedDocPath : undefined,
    }),
  );
  return pages;
}

/** Raw doc bytes a fetched PDF/image carries (base64 inflates ~4/3, so undo it). */
function docRawBytes(r: Pick<FetchResult, "pdfBase64" | "imageBase64">): number {
  return (r.pdfBase64?.length ?? r.imageBase64?.length ?? 0) * 0.75;
}

/**
 * Pick the menu docs (PDF/image) to feed the model, under a count + byte budget.
 * Ranking: happy-hour relevance first (scoreHhUrl) so a "happy+hour.PNG" (100) outranks a
 * generic food-menu image (30) — Bei Sushi. For EQUAL score the sort is stable, so it keeps
 * the caller's order — which is HH-context first (extractMediaLinks ranks a doc linked next to
 * "happy hour" page text ahead of one that isn't). That's how Hula Hoops's 6.9MB Happy-Hour
 * Dinner PDF beats its 7.9MB Brunch PDF (both filename-score 0): we spend the budget on the
 * HH-linked doc and never send the irrelevant brunch menu. `staleDated(url)` drops docs
 * superseded by fresh page text (see caller). Pure + exported so the budget math is
 * unit-testable without the network.
 */
export function selectDocsWithinBudget(
  docs: FetchResult[],
  opts: { maxBytes: number; maxPages: number; staleDated?: (url: string) => boolean },
): FetchedPage[] {
  const ranked = [...docs].sort((a, b) => scoreHhUrl(b.url) - scoreHhUrl(a.url));
  const picked: FetchedPage[] = [];
  let docBytes = 0;
  for (const r of ranked) {
    if (opts.staleDated?.(r.url)) continue;
    const bytes = docRawBytes(r);
    if (picked.length >= opts.maxPages || docBytes + bytes > opts.maxBytes) continue;
    if (r.isPdf && r.pdfBase64) picked.push({ url: r.url, pdfBase64: r.pdfBase64 });
    else if (r.isImage && r.imageBase64 && r.imageMediaType)
      picked.push({ url: r.url, imageBase64: r.imageBase64, imageMediaType: r.imageMediaType });
    else continue;
    docBytes += bytes;
  }
  return picked;
}

/**
 * Render fetched pages as content blocks: a `Source: <url>` text block per HTML page, and
 * a label + document block per PDF. The model cites the exact `Source:` URL as its sourceUrl.
 */
export function renderPagesAsBlocks(pages: FetchedPage[]): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  for (const p of pages) {
    if (p.pdfBase64) {
      blocks.push({ type: "text", text: `Source: ${p.url} (PDF)` });
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: p.pdfBase64 },
      });
    } else if (p.imageBase64 && p.imageMediaType) {
      blocks.push({ type: "text", text: `Source: ${p.url} (image menu)` });
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: p.imageMediaType, data: p.imageBase64 },
      });
    } else if (p.text) {
      blocks.push({ type: "text", text: `Source: ${p.url}\n\n${p.text}` });
    }
  }
  return blocks;
}
