/**
 * Free, robots-aware site-content fetcher for the AI seed/reverify paths. We fetch the
 * venue's known pages OURSELVES over plain HTTP (via lib/verification/fetchUrl — no
 * Anthropic billing) and render them as model content blocks, so the model is given NO
 * web tools and cannot autonomously incur web_search/web_fetch charges. Shared by the
 * extractor (extractHappyHours) and the adversarial reverifier (reverify/adversarial).
 */
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { fetchUrl, type FetchResult, type ImageMediaType } from "@/lib/verification/fetchUrl";
import { hasHhOrDealSignal } from "@/lib/places/hhText";

// Bound the document (PDF/image) payload fed to the model. A venue with many menu
// PDFs (Bottega has 6) overwhelms the extractor — 6/4.5MB returned nothing, while
// ~4/2.4MB extracts cleanly. Cap by count AND bytes; text pages are always included.
const MAX_DOC_PAGES = 5;
const MAX_DOC_BYTES = 3_000_000;
/** Statuses bot walls answer plain fetches with — a headless browser usually gets through. */
const BOT_WALL_STATUSES = new Set([401, 403, 406, 429]);

/**
 * Heuristic for "this page's stripped text is machine payload, not prose" — JS-walled
 * sites (Popmenu/Wix route manifests, telemetry configs) often strip to brace-heavy,
 * space-poor token soup that PASSES the has-text check and so never render-escalates
 * (Cala's route slugs, Ciao Grazie's telemetry JSON, 2026-06-10). Real menu/HH prose has
 * normal word spacing; code/JSON/slug dumps don't.
 */
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
  const clean = urls.filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0,
  );
  const norm = (u: string) => u.replace(/\/$/, "");
  const unique = [...new Set(clean)].slice(0, max);
  // Plain fetch first; fall back to the headless render tier ONLY when it came back empty
  // (robots-blocked, or a JS shell with no text / no docs / no media links).
  const fetchOne = async (u: string): Promise<FetchResult> => {
    const r = await fetchUrl(u, { maxContent: opts.maxContent });
    // Only fall back to the (slow) browser when it can actually help: a robots-blocked
    // shortlink the browser would just follow, a bot-UA wall (401/403/406/429 — a real
    // browser usually gets through; veroamorepizza.com 403s plain fetch but renders fine),
    // or a reachable JS-shell that rendered no text / docs / links. NEVER for a genuine
    // 404/410/dead URL (e.g. a speculative path guess) — rendering those would launch a
    // browser per miss and stall prep.
    const botWalled = !r.ok && r.status != null && BOT_WALL_STATUSES.has(r.status);
    const junkText = r.ok && !!r.contentText && looksLikeMachineText(r.contentText);
    const worthRendering =
      r.blockedByRobots === true ||
      botWalled ||
      junkText ||
      (r.ok && !r.contentText && !r.isPdf && !r.isImage && !(r.mediaLinks && r.mediaLinks.length));
    if (worthRendering && opts.render) {
      const rendered = await opts.render(u);
      if (rendered.ok) return rendered;
    }
    return r;
  };
  const results = await Promise.all(unique.map(fetchOne));
  const pages: FetchedPage[] = [];
  const seen = new Set(unique.map(norm));
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
      if (!seen.has(norm(m))) { seen.add(norm(m)); follow.push(m); }
    }
  }

  // Follow media links ONE HOP — the menu doc usually lives on a sub-page (e.g. /menus)
  // we'd otherwise only read as text. Bottega's happy-hour PDF is here.
  const toFollow = follow.slice(0, 6);
  if (toFollow.length > 0) {
    const more = await Promise.all(toFollow.map(fetchOne));
    for (const r of more) if (r.ok && (r.isPdf || r.isImage)) docs.push(r);
  }

  // Add docs under a bounded budget (too many / too-large docs overwhelm the model).
  let docCount = 0;
  let docBytes = 0;
  for (const r of docs) {
    const bytes = (r.pdfBase64?.length ?? r.imageBase64?.length ?? 0) * 0.75;
    if (docCount >= MAX_DOC_PAGES || docBytes + bytes > MAX_DOC_BYTES) continue;
    if (r.isPdf && r.pdfBase64) pages.push({ url: r.url, pdfBase64: r.pdfBase64 });
    else if (r.isImage && r.imageBase64 && r.imageMediaType)
      pages.push({ url: r.url, imageBase64: r.imageBase64, imageMediaType: r.imageMediaType });
    else continue;
    docCount++;
    docBytes += bytes;
  }
  return pages;
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
