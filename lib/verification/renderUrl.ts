/**
 * Headless-browser fetch tier — the fallback for venue-published menus the plain,
 * robots-respecting fetcher (lib/verification/fetchUrl) can't read:
 *   1. JS-SPAs whose menu links/text only exist after JavaScript runs (e.g. a Squarespace/
 *      React homepage that strips to empty HTML), and
 *   2. menus behind a crawler-blocking shortlink (e.g. qrco.de's `Disallow: /`) that 302s
 *      to a CDN PDF.
 * A real browser executes JS and does NOT consult robots.txt — exactly how a customer
 * reaches the menu the venue published for them. We use this ONLY on a venue's own site
 * and the links it puts there, never for open-web crawling.
 *
 * playwright + Chromium are LAZY-imported so the Next app bundle never pulls them in; this
 * module is imported only by the local seed/enrich (prep-time) pipeline.
 */
import type { Browser, BrowserContext } from "playwright";
import type { FetchResult } from "@/lib/verification/fetchUrl";
import { extractMediaLinks } from "@/lib/places/siteTriage";
import { scrapeWithFirecrawl } from "@/lib/places/firecrawl";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124 Safari/537.36";

let _browser: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({ headless: true });
  return _browser;
}

/** Close the shared browser. Call once at the end of a batch run to free Chromium. */
export async function closeRenderBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

function isImageCt(ct: string): FetchResult["imageMediaType"] | null {
  if (ct.includes("jpeg") || ct.includes("jpg")) return "image/jpeg";
  if (ct.includes("png")) return "image/png";
  if (ct.includes("webp")) return "image/webp";
  if (ct.includes("gif")) return "image/gif";
  return null;
}

/**
 * Render `url` with a headless browser. Returns the same FetchResult shape as fetchUrl so it
 * slots into the existing content pipeline: a PDF/image link yields a document/vision block;
 * an HTML page yields the RENDERED visible text + media links (so a SPA's JS-injected menu
 * links are finally visible). Returns ok:false on failure (caller falls back / skips).
 */
export async function renderUrl(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<FetchResult> {
  const timeout = opts.timeoutMs ?? 20_000;
  const maxBytes = opts.maxBytes ?? 8_000_000;
  let ctx: BrowserContext | null = null;
  try {
    // Render backend: prefer a configured self-hosted Firecrawl over launching Chromium.
    // Returns null when unconfigured, on error, or for PDFs/images (which the byte path
    // below handles so Claude reads the document directly). See lib/places/firecrawl.ts.
    const fc = await scrapeWithFirecrawl(url);
    if (fc) return fc;

    const browser = await getBrowser();
    ctx = await browser.newContext({ userAgent: UA, ignoreHTTPSErrors: true });

    // First, fetch the bytes via the browser's request API: it follows redirects (the
    // qrco.de → CDN-PDF hop) and ignores robots.txt, without the headless-Chromium quirk of
    // refusing to "navigate" to a PDF. This resolves the PDF/image case directly.
    const resp = await ctx.request.get(url, { timeout, maxRedirects: 10 });
    const finalUrl = resp.url();
    const ct = (resp.headers()["content-type"] || "").toLowerCase();

    if (ct.includes("application/pdf") || /\.pdf(\?|#|$)/i.test(finalUrl)) {
      const buf = await resp.body();
      if (buf.length <= maxBytes && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
        return { url: finalUrl, ok: true, status: resp.status(), contentType: "application/pdf", isPdf: true, pdfBase64: buf.toString("base64") };
      }
    }
    const imgType = isImageCt(ct);
    if (imgType) {
      const buf = await resp.body();
      if (buf.length <= maxBytes) {
        return { url: finalUrl, ok: true, status: resp.status(), contentType: ct, isImage: true, imageBase64: buf.toString("base64"), imageMediaType: imgType };
      }
    }

    // HTML — render it so JS-injected menu links/text appear, then read the rendered page.
    const page = await ctx.newPage();
    try {
      const nav = await page.goto(finalUrl, { waitUntil: "domcontentloaded", timeout });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      const html = await page.content();
      const text = await page.innerText("body").catch(() => "");
      const mediaLinks = extractMediaLinks(html, page.url());
      return { url: page.url(), ok: true, status: nav?.status() ?? resp.status(), contentType: ct, contentText: text, mediaLinks };
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    return { url, ok: false, error: (e as Error).message };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}
