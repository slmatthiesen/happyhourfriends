/**
 * Free, robots-aware site-content fetcher for the AI seed/reverify paths. We fetch the
 * venue's known pages OURSELVES over plain HTTP (via lib/verification/fetchUrl — no
 * Anthropic billing) and render them as model content blocks, so the model is given NO
 * web tools and cannot autonomously incur web_search/web_fetch charges. Shared by the
 * extractor (extractHappyHours) and the adversarial reverifier (reverify/adversarial).
 */
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { fetchUrl, type FetchResult, type ImageMediaType } from "@/lib/verification/fetchUrl";

// Bound the document (PDF/image) payload fed to the model. A venue with many menu
// PDFs (Bottega has 6) overwhelms the extractor — 6/4.5MB returned nothing, while
// ~4/2.4MB extracts cleanly. Cap by count AND bytes; text pages are always included.
const MAX_DOC_PAGES = 5;
const MAX_DOC_BYTES = 3_000_000;

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
 * Fetch the given URLs over plain HTTP (deduped, capped). Order is preserved, so pass the
 * highest-signal URLs first. Failures (unreachable / robots-blocked / non-HTML-non-PDF)
 * are silently skipped — the returned list contains only pages with usable content.
 */
export async function fetchPages(
  urls: (string | null | undefined)[],
  max = 5,
  opts: { maxContent?: number } = {},
): Promise<FetchedPage[]> {
  const clean = urls.filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0,
  );
  const norm = (u: string) => u.replace(/\/$/, "");
  const unique = [...new Set(clean)].slice(0, max);
  const results = await Promise.all(unique.map((u) => fetchUrl(u, { maxContent: opts.maxContent })));
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
    const more = await Promise.all(toFollow.map((u) => fetchUrl(u, { maxContent: opts.maxContent })));
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
