/**
 * JinaFetchProvider — anti-bot fetch via Jina Reader (r.jina.ai).
 *
 * Proven to bypass Cloudflare's managed challenge where our static fetch and a vanilla headless
 * render both get the "Just a moment…" interstitial (San Jose: Jack's HH recovered as text; Rise
 * Woodfire's Toast menu read off the screenshot). Two modes:
 *   - fetchText:       GET https://r.jina.ai/<url>  →  markdown body.
 *   - fetchScreenshot: same with `X-Return-Format: screenshot` + JSON accept  →  the response is
 *                      `{ data: { screenshotUrl } }`, a signed URL we then download as a PNG.
 *
 * The HTTP client is injectable (fetchImpl) so tests are hermetic — no network, no key.
 */
import type { AntiBotFetchResult, FetchProvider } from "./types";

const READER_BASE = "https://r.jina.ai/";
const TIMEOUT_MS = Number(process.env.JINA_TIMEOUT_MS) || 45_000;
// Seconds Jina waits for the page to finish rendering before the screenshot. Image-based menus
// (Toast/Squarespace) load the menu graphic after first paint — without the wait Jina sometimes
// captures the page BEFORE the menu image lands (a lean, near-blank shot the model reads as no HH,
// e.g. Rise Woodfire's 39KB vs 178KB capture). 10s makes the capture deterministic.
const SCREENSHOT_WAIT_S = Number(process.env.JINA_SCREENSHOT_WAIT_S) || 10;

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export interface JinaProviderOpts {
  apiKey: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class JinaFetchProvider implements FetchProvider {
  readonly name = "jina-reader";
  private readonly apiKey: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: JinaProviderOpts) {
    this.apiKey = opts.apiKey;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async fetchText(url: string): Promise<AntiBotFetchResult> {
    try {
      const res = await withTimeout((signal) =>
        this.doFetch(`${READER_BASE}${url}`, {
          signal,
          headers: this.headers({ "X-Return-Format": "markdown" }),
        }),
      );
      if (!res.ok) return { ok: false, blocked: res.status === 403 || res.status === 451, error: `jina text ${res.status}` };
      const text = await res.text();
      if (!text || text.trim().length === 0) return { ok: false, error: "jina text empty" };
      return { ok: true, contentText: text };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetchScreenshot(url: string): Promise<AntiBotFetchResult> {
    try {
      const res = await withTimeout((signal) =>
        this.doFetch(`${READER_BASE}${url}`, {
          signal,
          headers: this.headers({
            "X-Return-Format": "screenshot",
            "X-Timeout": String(SCREENSHOT_WAIT_S),
            Accept: "application/json",
          }),
        }),
      );
      if (!res.ok) return { ok: false, blocked: res.status === 403 || res.status === 451, error: `jina shot ${res.status}` };
      const body = (await res.json()) as { data?: { screenshotUrl?: string } };
      const shotUrl = body?.data?.screenshotUrl;
      if (!shotUrl) return { ok: false, error: "jina screenshot: no screenshotUrl in response" };
      // Download the actual PNG from the signed (GCS) URL — no auth header needed.
      const png = await withTimeout((signal) => this.doFetch(shotUrl, { signal }));
      if (!png.ok) return { ok: false, error: `jina screenshot download ${png.status}` };
      const bytes = Buffer.from(await png.arrayBuffer());
      if (bytes.byteLength === 0) return { ok: false, error: "jina screenshot empty" };
      return { ok: true, imageBase64: bytes.toString("base64"), imageMediaType: "image/png" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
