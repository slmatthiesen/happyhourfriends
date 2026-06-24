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
import type { APIRequestContext, Browser, BrowserContext } from "playwright";
import { harvestMenuJson, sniffImageMediaType, type FetchResult } from "@/lib/verification/fetchUrl";
import { extractMediaLinksDetailed, extractMenuEmbedUrls } from "@/lib/places/siteTriage";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124 Safari/537.36";

let _browser: Browser | null = null;
// Launch is memoized: fetchPages renders URLs via Promise.all, so concurrent first calls
// raced chromium.launch() and the loser's browser leaked untracked — closeRenderBrowser
// only closed the winner, stranding the node process on the orphan's open handles
// (reextract + adjudicate runs never exited, 2026-06-10).
let _launching: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  if (!_launching) {
    _launching = (async () => {
      const { chromium } = await import("playwright");
      const b = await chromium.launch({ headless: true });
      _browser = b;
      _launching = null;
      return b;
    })();
  }
  return _launching;
}

/** Close the shared browser. Call once at the end of a batch run to free Chromium. */
export async function closeRenderBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

/** Strip a menu-widget's HTML to readable text (it returns small, clean markup — no need for the
 *  full fetchUrl pipeline). Drops script/style, unwraps tags, collapses whitespace. */
function widgetHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|li|tr|div|section|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Fetch any known menu-widget iframes embedded in `html` and return their combined text (each
 *  under a "Menu (embedded from <host>):" header), or "" if none/failed. Never throws. */
async function harvestMenuEmbeds(
  request: APIRequestContext,
  html: string,
  baseUrl: string,
  opts: { timeout: number; maxBytes: number },
): Promise<string> {
  const urls = extractMenuEmbedUrls(html, baseUrl).slice(0, 3);
  const chunks: string[] = [];
  for (const u of urls) {
    try {
      const r = await request.get(u, { timeout: opts.timeout, maxRedirects: 10 });
      if (!r.ok()) continue;
      const buf = await r.body();
      if (buf.length > opts.maxBytes) continue;
      const text = widgetHtmlToText(buf.toString("utf8"));
      if (text.length > 20) chunks.push(`Menu (embedded from ${new URL(u).hostname}):\n${text}`);
    } catch {
      /* skip an unreachable widget — fall back to the page's own text */
    }
  }
  return chunks.join("\n\n");
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
      // Trust the BYTES: a WebP served as image/png mislabeled here 400s the extraction request.
      const actualType = sniffImageMediaType(buf);
      if (actualType && buf.length <= maxBytes) {
        return { url: finalUrl, ok: true, status: resp.status(), contentType: actualType, isImage: true, imageBase64: buf.toString("base64"), imageMediaType: actualType };
      }
    }

    // HTML — render it so JS-injected menu links/text appear, then read the rendered page.
    const page = await ctx.newPage();
    try {
      const nav = await page.goto(finalUrl, { waitUntil: "domcontentloaded", timeout });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      const html = await page.content();
      const text = await page.innerText("body").catch(() => "");
      const media = extractMediaLinksDetailed(html, page.url());
      const mediaLinks = media.map((m) => m.url);
      const hhContextMediaLinks = media.filter((m) => m.hhContext).map((m) => m.url);
      // Cross-origin MENU-widget iframes (SinglePlatform etc.) hold the deals but their content is
      // NOT in body.innerText. Fetch each widget's own HTML as text and fold it in, so a single
      // paid extraction captures the menu instead of leaving a bare window (Finch & Fork SB).
      const embedText = await harvestMenuEmbeds(ctx.request, html, page.url(), { timeout, maxBytes });
      // Inline framework menu JSON (Next.js RSC / Squarespace tabs): the HH menu is in a <script>
      // chunk innerText can't see — reconstruct it so the deals reach the model (Twelvemonth SB).
      const menuJson = harvestMenuJson(html);
      const parts = [text, menuJson, embedText].filter(Boolean);
      return { url: page.url(), ok: true, status: nav?.status() ?? resp.status(), contentType: ct, contentText: parts.join("\n\n"), mediaLinks, hhContextMediaLinks };
    } finally {
      await page.close().catch(() => {});
    }
  } catch (e) {
    return { url, ok: false, error: (e as Error).message };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}
