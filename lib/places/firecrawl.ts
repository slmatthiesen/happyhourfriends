/**
 * Optional self-hosted Firecrawl render backend. When FIRECRAWL_URL is set we render JS
 * pages through a local Firecrawl instead of (slower, hand-rolled) Playwright. Returns a
 * FetchResult so it slots into renderUrl with NO downstream changes, or null when:
 *   - FIRECRAWL_URL is unset,
 *   - the URL is a PDF/image (those stay on the byte path so Claude reads the doc directly),
 *   - Firecrawl reports the resource is a PDF/image (redirect-to-doc case), or
 *   - any error / empty result.
 * See docs/firecrawl-setup.md.
 */
import type { FetchResult } from "@/lib/verification/fetchUrl";
import { extractMediaLinks } from "@/lib/places/siteTriage";

const TIMEOUT_MS = 30_000;
const WAIT_FOR_MS = 2_000; // let JS render before capture
const SCRAPE_PATH = "/v2/scrape"; // older self-host checkouts use /v1/scrape — see docs/firecrawl-setup.md
const DOC_EXT = /\.(pdf|jpe?g|png|gif|webp)(\?|#|$)/i;

export async function scrapeWithFirecrawl(url: string): Promise<FetchResult | null> {
  const base = process.env.FIRECRAWL_URL;
  if (!base) return null;
  if (DOC_EXT.test(url)) return null; // byte path handles docs (Claude reads them directly)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${base.replace(/\/$/, "")}${SCRAPE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        formats: [{ type: "markdown" }, { type: "html" }, { type: "links" }],
        waitFor: WAIT_FOR_MS,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      success?: boolean;
      data?: {
        markdown?: string;
        html?: string;
        links?: string[];
        metadata?: { url?: string; sourceURL?: string; statusCode?: number; contentType?: string };
      };
    };
    if (!json?.success || !json.data) return null;
    const data = json.data;
    const ct = String(data.metadata?.contentType ?? "").toLowerCase();
    // Firecrawl followed a redirect to a doc — defer to the byte path so Claude gets the
    // real bytes (Firecrawl's text parse loses layout/vision).
    if (ct.includes("application/pdf") || ct.startsWith("image/")) return null;
    const text = typeof data.markdown === "string" ? data.markdown.trim() : "";
    if (!text) return null;
    const finalUrl = data.metadata?.url || data.metadata?.sourceURL || url;
    const html = typeof data.html === "string" ? data.html : "";
    const mediaLinks = html ? extractMediaLinks(html, finalUrl) : [];
    return {
      url: finalUrl,
      ok: true,
      status: data.metadata?.statusCode,
      contentType: ct || "text/html",
      contentText: text,
      mediaLinks,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
