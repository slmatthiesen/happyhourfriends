/**
 * Free, robots-aware site-content fetcher for the AI seed/reverify paths. We fetch the
 * venue's known pages OURSELVES over plain HTTP (via lib/verification/fetchUrl — no
 * Anthropic billing) and render them as model content blocks, so the model is given NO
 * web tools and cannot autonomously incur web_search/web_fetch charges. Shared by the
 * extractor (extractHappyHours) and the adversarial reverifier (reverify/adversarial).
 */
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { fetchUrl, type ImageMediaType } from "@/lib/verification/fetchUrl";

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
  const unique = [...new Set(clean)].slice(0, max);
  const results = await Promise.all(unique.map((u) => fetchUrl(u, { maxContent: opts.maxContent })));
  const pages: FetchedPage[] = [];
  for (const r of results) {
    if (!r.ok) continue;
    if (r.isPdf && r.pdfBase64) pages.push({ url: r.url, pdfBase64: r.pdfBase64 });
    else if (r.isImage && r.imageBase64 && r.imageMediaType)
      pages.push({ url: r.url, imageBase64: r.imageBase64, imageMediaType: r.imageMediaType });
    else if (r.contentText) pages.push({ url: r.url, text: r.contentText });
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
