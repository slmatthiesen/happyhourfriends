/**
 * fetchUrl — robots.txt-respecting HTTP fetcher used by the Stage 2 verifier
 * tool loop (PRD §4.3) and the seed extractor (lib/ai/siteContent).
 *
 * HTML is reduced to plain text and capped. Tier-2 "smart" reduction: we first strip
 * the heavy SSR noise (scripts/styles/svg/inline-CSS/base64) — on Wix/Squarespace
 * that's the bulk of a multi-MB page — then, if still over budget, keep the
 * MENU-DENSE windows (prices, days, "happy hour", menu/section words) instead of the
 * first N chars. This is why a happy-hour section buried ~1MB deep in a Wix page
 * (e.g. Bottega Michelangelo) now reaches the model. Budget is caller-configurable:
 * the extractor passes a larger one than the verifier.
 *
 * For PDFs (a common menu format) it returns the raw bytes as base64 so the caller
 * can hand them to Claude as a native document block. Never throws.
 */

import { extractMediaLinksDetailed, cappedSquarespaceImageUrl } from "@/lib/places/siteTriage";
import { harvestJsonLdMenu } from "@/lib/places/jsonLdMenu";

const BOT_NAME = "HappyHourFriendsBot";
const USER_AGENT = `${BOT_NAME}/1.0 (+https://happyhourfriends.com)`;
// Bot-managed CDNs (Akamai/Cloudflare) reset the connection or 403/406 our honest bot UA but
// serve real browsers. triageSite already fetches the homepage with this exact browser UA; the
// content fetch (this file) did not, so such a site PASSED triage — its menu links discovered —
// then dropped to ZERO pages here (e.g. Tommy Bahama Scottsdale, whose dinner-menu PDF holds the
// happy hour). We retry a bot-wall failure once with this UA. Distinct from the render fallback:
// render can't return PDF/image bytes, and HH menus are usually PDFs — so the refetch must happen
// here. robots.txt is still checked under our honest BOT_NAME, so this respects the same rules.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const TIMEOUT_MS = 10_000;
const MAX_CONTENT = 8_000; // default (verifier tool loop); extractor overrides higher.
// Claude accepts up to 32MB; keep it sane by default. Env-overridable so an operator can pull a
// known-good oversized menu (e.g. a 19MB Squarespace HH PDF) through the real path for a one-off.
const MAX_PDF_BYTES = Number(process.env.FETCH_MAX_PDF_BYTES) || 10 * 1024 * 1024;
// Vision images — the Claude API accepts up to 10MB BASE64 per image (~7.5MB raw). Default to
// 7MB raw (~9.3MB base64, safely under the cap) so real menu images land — e.g. a Squarespace
// HH menu capped to format=1500w runs ~5.6MB. Env-overridable for one-off oversized pulls.
const MAX_IMAGE_BYTES = Number(process.env.FETCH_MAX_IMAGE_BYTES) || 7 * 1024 * 1024;

// Transient-failure retry. Media/discovered-page fetches dropped ~1/3 of runs to a
// whole-venue 0% recall: a CDN timeout / connection reset / 5xx on the (single) HH PDF or
// image silently lost the deal source for that run. Retry those — but NOT terminal results
// (404, robots-block, too-large) or auth/forbidden bot walls (401/403/406), which the caller's
// render fallback owns; retrying those would just add latency before the browser tier runs anyway.
// 429 is the exception: it's a rate-limit ("too many requests"), not a hard block — backoff
// CLEARS it (often self-inflicted by our own parallel fetch burst), so we retry it here and only
// fall through to render if it persists past the backoff schedule.
const RETRY_DELAYS_MS = [300, 800]; // length = retry count → 3 attempts total
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * The image's REAL media type from its magic bytes — the only thing Anthropic's vision API trusts.
 * CDNs serve WebP under a .png/.jpg URL (and sometimes an image/png header); the API validates
 * bytes-vs-declared-type and 400s the WHOLE request on a mismatch, dropping all extraction for the
 * venue (Wooden Nickel's bar-interior.png is WebP). Returns null for anything not a Claude-supported
 * raster image (SVG, AVIF, an HTML error page) so the caller skips it rather than risk that 400.
 * Pure + exported for unit testing.
 */
export function sniffImageMediaType(bytes: Uint8Array): ImageMediaType | null {
  const b = bytes;
  if (b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  // WebP: "RIFF" <4-byte size> "WEBP"
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Map a content-type / extension to a Claude-vision-supported image media type. */
function imageMediaType(contentType: string, pathname: string): ImageMediaType | null {
  const ct = contentType.split(";")[0].trim();
  if (ct === "image/jpeg" || ct === "image/png" || ct === "image/gif" || ct === "image/webp") return ct;
  const ext = pathname.toLowerCase().match(/\.(jpe?g|png|gif|webp)(?:$|\?)/)?.[1];
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

export interface FetchOpts {
  /** Max chars of reduced HTML text to return. Default MAX_CONTENT. */
  maxContent?: number;
  /** Injected for tests (hermetic, no network); defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Backoff schedule between transient-failure retries; length = retry count.
   *  Defaults to RETRY_DELAYS_MS. Tests pass [0, 0] to retry without real waits. */
  retryDelaysMs?: number[];
}

/** A failure worth re-attempting: a thrown network/timeout error (no HTTP status reached)
 *  or a transient server status. Terminal results (robots-block, 4xx incl. bot walls,
 *  too-large — all of which carry a status) are NOT retried. */
function isRetryableFailure(r: FetchResult): boolean {
  if (r.ok || r.blockedByRobots) return false;
  if (r.status != null) return RETRYABLE_STATUSES.has(r.status);
  return r.error != null; // thrown network/timeout error — never reached an HTTP status
}

/** A bot-wall signature a real-browser User-Agent might clear: a forbidden/not-acceptable/
 *  unavailable-for-legal status, or a thrown network error with no HTTP status (the TLS
 *  reset / connection drop an Akamai-style bot manager does to a non-browser UA). Excludes
 *  robots blocks (we honor those) and successes. */
function isBotWallFailure(r: FetchResult): boolean {
  if (r.ok || r.blockedByRobots) return false;
  if (r.status != null) return r.status === 403 || r.status === 406 || r.status === 451;
  return r.error != null;
}

/**
 * Deterministic anti-bot wall fingerprint. Cloudflare's managed challenge ("Just a moment…"),
 * Turnstile interstitials, and similar return HTTP 200 with a content-less JS challenge page —
 * so the status looks fine but the real page (the HH menu) never loads. We detect it from the
 * HUMAN-FACING challenge copy the interstitial shows the visitor, so the ladder can escalate to
 * the anti-bot provider (Jina). These phrases don't appear in legitimate restaurant prose, so
 * the false-positive risk is nil. (Raw script tokens like `cf_chl` / `challenge-platform` were
 * tried but FALSE-FIRED on content-bearing listing pages that merely embed a Cloudflare script —
 * e.g. an edan.io listing with real venue text — so they're excluded.) Matched on raw HTML
 * (pre-strip) AND survives in stripped text, so the same check works on a headless-rendered
 * challenge page too. Pure + exported.
 */
const BOT_WALL_FINGERPRINTS = [
  "just a moment",
  "enable javascript and cookies to continue",
  "checking your browser before",
  "attention required! | cloudflare",
  "please verify you are a human",
  "verifying you are human",
];
export function detectBotWall(s: string): boolean {
  if (!s) return false;
  const t = s.toLowerCase();
  return BOT_WALL_FINGERPRINTS.some((f) => t.includes(f));
}

/** Signals that a text window carries menu / happy-hour content. */
const MENU_SIGNAL =
  /\$\s?\d|happy[ -]?hour|\b(mon|tue|wed|thu|fri|sat|sun|daily|weekday|weekend)\b|\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?|am|pm)\b|\b(menu|special|appetizer|cocktail|martini|draft|draught|wine|beer|spirit|well drink|pint|glass|bottle)\b/gi;

function menuScore(s: string): number {
  return (s.match(MENU_SIGNAL) ?? []).length;
}

// Non-global twin of MENU_SIGNAL for deciding whether ONE harvested string is worth
// keeping (a global regex is stateful across .test() calls — don't reuse MENU_SIGNAL here).
const HARVEST_SIGNAL =
  /\$\s?\d|happy[ -]?hour|\b(mon|tue|wed|thu|fri|sat|sun|daily|weekday|weekend)\b|\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?|am|pm)\b|\b(menu|special|appetizer|cocktail|martini|draft|draught|wine|beer|spirit|well drink|pint|glass|bottle)\b/i;

/** Decode the escapes a JSON string literal carries (\uXXXX, \n, \", \/, \\). */
function decodeJsonString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(["'/\\])/g, "$1");
}

/**
 * Harvest human-readable text from the JSON inside inline <script> blocks. SSR site
 * builders stash the page's real content there and render it client-side: Wix
 * `wix-warmup-data`, Heroku/dashtrack `bootstrapApp({...})`, Square/Weebly configs.
 * stripHtml drops <script> wholesale, so without this those pages reduce to nothing —
 * e.g. Philly's Sports Grill, whose only happy-hour text ("Happy Hour: 3pm-7pm daily")
 * lives in a dashtrack config blob, stripped to 0 chars. We pull the quoted string
 * values (decode escapes + entities, strip inner HTML tags) and keep the menu/HH-signal
 * ones, bounded by `cap`. Exported for unit tests.
 */
export function harvestScriptText(html: string, cap = 8000): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(html)) !== null) {
    if (/\bsrc\s*=/i.test(sm[1])) continue; // external bundle — no inline text to mine
    const body = sm[2];
    const strRe = /"((?:\\.|[^"\\]){3,500})"/g;
    let m: RegExpExecArray | null;
    while ((m = strRe.exec(body)) !== null) {
      let v = decodeJsonString(m[1]);
      if (v.includes("<")) v = v.replace(/<[^>]+>/g, " "); // notes:"<p>Happy Hour…</p>"
      v = v
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (v.length < 4) continue;
      if (/^[\w.\-]+$/.test(v)) continue; // bare token — a JSON key / id / slug, not prose
      // Wix/SSR sites echo the request's User-Agent into their warmup JSON; our own bot
      // name contains "HappyHour", which false-fires every downstream HH-signal regex.
      if (v.includes(BOT_NAME)) continue;
      if (!HARVEST_SIGNAL.test(v)) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      used += v.length + 3;
      if (used >= cap) return out.join(" · ");
    }
  }
  return out.join(" · ");
}

/**
 * Pull structured menus out of inline JSON. JS frameworks (Next.js RSC / Squarespace) embed the
 * full menu — including Happy Hour — as JSON in a <script> and render it into tabs client-side, so
 * innerText sees only the visible tab and stripHtml/harvestScriptText can't pair an item's name with
 * its price (Twelvemonth's HH never reached the model → a bare window). This walks the menu shape
 * `{"title":<section>,"items":[{"name":…,"price":…}]}` in document order and emits readable
 * "## Section / Name — $price" lines so the model gets the deals (it scopes to the HH section, so we
 * keep every section rather than pre-filter). Handles the flight-escaped (\") and plain forms.
 * Pure + exported for unit testing.
 */
export function harvestMenuJson(html: string, cap = 8000): string {
  // Unescape one level of flight encoding (self.__next_f chunks escape quotes as \"); a no-op for
  // already-plain SSR JSON. Gate on the menu-item signature so non-menu JSON is never mined.
  const u = html.replace(/\\"/g, '"');
  if (!/"items"\s*:\s*\[\s*\{\s*"name"/.test(u)) return "";
  const tokenRe =
    /"title"\s*:\s*"([^"]{1,80})"|"name"\s*:\s*"([^"}]{1,80})"[^}]*?"price"\s*:\s*"([^"}]{0,24})"/g;
  // Flight JSON encodes punctuation as \uXXXX (& → &) — decode so names read cleanly.
  const dec = (s: string) =>
    s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).trim();
  type Tok = { kind: "title" | "item"; name: string; price?: string };
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(u)) !== null) {
    if (m[1] !== undefined) toks.push({ kind: "title", name: dec(m[1]) });
    else {
      const price = dec(m[3] ?? "").replace(/\${2,}/g, "$"); // "$$15" template artifact → "$15"
      toks.push({ kind: "item", name: dec(m[2]), price: /^\$?\d/.test(price) ? price : "" });
    }
  }
  // Keep a section title only when an item follows it (drops page-meta "title" fields).
  const lines: string[] = [];
  let used = 0;
  const push = (s: string) => { if (used < cap) { lines.push(s); used += s.length + 1; } };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "title") { if (toks[i + 1]?.kind === "item") push(`\n## ${t.name}`); }
    else if (t.name) push(t.price ? `${t.name} — ${t.price}` : t.name);
  }
  return lines.some((l) => !l.startsWith("\n##")) ? lines.join("\n").trim() : "";
}

export interface FetchResult {
  url: string;
  ok: boolean;
  status?: number;
  contentText?: string;
  /** Set when the resource is a PDF — base64 bytes for a document content block. */
  isPdf?: boolean;
  pdfBase64?: string;
  /** Set when the resource is an image — base64 bytes for a vision image block. */
  isImage?: boolean;
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
  /** PDF/image menu links found in this HTML page's raw markup — the caller follows
   *  them one hop (the menu doc usually lives on a sub-page like /menus). */
  mediaLinks?: string[];
  /** The subset of mediaLinks the page linked under happy-hour context (anchor text / alt /
   *  nearby source said "happy hour"). The page's OWN label for which doc holds the deals —
   *  selection ranks these above filename score so an "HH.pdf" the page calls "Happy Hour"
   *  beats a higher-filename-scored sibling (lib/ai/siteContent selectDocsWithinBudget). */
  hhContextMediaLinks?: string[];
  contentType?: string;
  blockedByRobots?: boolean;
  /** An anti-bot wall (Cloudflare/Turnstile challenge) answered with a content-less 200. The
   *  ladder escalates this to the anti-bot provider tier (lib/places/fetchProviders). */
  blocked?: "bot_wall";
  /** This result came from the anti-bot provider (Jina) escalation, not a direct fetch. Set by
   *  siteContent's anti-bot tier so a deliberately-captured screenshot always counts as signal. */
  fromAntiBot?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// robots.txt parsing (minimal — handles User-agent groups and Disallow lines)
// ---------------------------------------------------------------------------

function isBlockedByRobots(
  robotsTxt: string,
  botName: string,
  targetPath: string,
): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let inApplicableGroup = false;
  const botLower = botName.toLowerCase();

  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;

    if (line.toLowerCase().startsWith("user-agent:")) {
      const agent = line.slice("user-agent:".length).trim().toLowerCase();
      inApplicableGroup = agent === "*" || botLower.includes(agent);
      continue;
    }

    if (inApplicableGroup && line.toLowerCase().startsWith("disallow:")) {
      const prefix = line.slice("disallow:".length).trim();
      if (prefix && targetPath.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTML stripping
// ---------------------------------------------------------------------------

export function stripHtml(html: string, maxContent: number = MAX_CONTENT): string {
  // 1. Drop heavy noise FIRST: comments, scripts/styles/svg/etc., inline style attrs,
  //    and base64 data URIs. On SSR builders this is the bulk of the bytes.
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|noscript|head|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/\sstyle="[^"]*"/gi, " ")
    .replace(/\bdata:[a-z0-9/;,+=._-]{60,}/gi, " ");
  // 1b. Preserve section structure BEFORE the blanket tag strip. Headings → "## " markers,
  //     block boundaries → newlines. Without this the page collapses to one flat line and
  //     offerings get mis-attributed across sections (Alcazar's $17 cocktails / $40 bottle /
  //     footer "Location" all landed in the Happy Hour window). div/section breaks cover
  //     Wix/Squarespace sites that render labels as styled divs, not <h*>.
  text = text
    .replace(/<h[1-6]\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, "\n## ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|tr|div|section|article|header|footer|ul|ol|table)\s*>/gi, "\n");
  // 2. Remove remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // 3. Decode common HTML entities
  text = text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
  // 4. Collapse intra-line whitespace but PRESERVE the line breaks from step 1b (the
  //    section signal). Cap blank-line runs so payload stays tight.
  text = text
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 4b. Recover content SSR builders hide in <script> JSON (stripped at step 1). On a
  //     client-hydrated page the visible text is empty but the happy-hour info is in the
  //     config blob — append it so it reaches the model (Philly's Sports Grill).
  const scriptText = harvestScriptText(html);
  if (scriptText) text = text ? `${text} ${scriptText}` : scriptText;

  // 4c. schema.org JSON-LD Menu: restaurant CMSs publish the HH menu (exact name↔price
  //     pairs) as structured data that step 1 drops and harvestScriptText can't pair
  //     (bare-token prices are skipped). PREPEND the reconstructed HH menu so it leads
  //     the payload and is always kept by the budget trim below (windows[0]). Spencer's:
  //     12 real HH items instead of a stray "$42" Sunday-Supper entrée.
  const jsonLdMenu = harvestJsonLdMenu(html, text);
  if (jsonLdMenu) text = text ? `${jsonLdMenu}\n\n${text}` : jsonLdMenu;

  // 4d. Inline framework menu JSON (Next.js RSC / Squarespace): the full menu, including Happy
  //     Hour, lives in a <script> flight chunk and renders into client-side tabs — invisible to
  //     steps above. PREPEND the reconstructed name↔price menu (Twelvemonth's HH was here).
  const menuJson = harvestMenuJson(html);
  if (menuJson) text = text ? `${menuJson}\n\n${text}` : menuJson;

  if (text.length <= maxContent) return text;

  // 5. Over budget: keep the intro (venue context) + the densest menu/HH windows, in
  //    original order — so content buried deep in a big page still reaches the model.
  const WIN = 1500;
  const windows: { i: number; score: number; text: string }[] = [];
  for (let i = 0; i < text.length; i += WIN) {
    const chunk = text.slice(i, i + WIN);
    windows.push({ i, score: menuScore(chunk), text: chunk });
  }
  const picked = [windows[0]]; // always keep the intro
  let used = windows[0].text.length;
  for (const w of windows.slice(1).filter((w) => w.score > 0).sort((a, b) => b.score - a.score)) {
    if (used + w.text.length > maxContent) continue;
    picked.push(w);
    used += w.text.length;
    if (used >= maxContent) break;
  }
  picked.sort((a, b) => a.i - b.i);
  return picked.map((w) => w.text).join(" … ");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchUrl(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const maxContent = opts.maxContent ?? MAX_CONTENT;
  const doFetch = opts.fetchImpl ?? fetch;
  // Cap oversized Squarespace CDN images to a model-sufficient width BEFORE fetching, so a
  // high-res menu image doesn't blow the 10MB-base64 API cap (no-op for every other URL).
  url = cappedSquarespaceImageUrl(url);
  const retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    return { url, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const targetPath = parsed.pathname + parsed.search;
  const robotsUrl = `${parsed.origin}/robots.txt`;

  // --- robots.txt check (once; failures proceed optimistically, never retried) ---
  try {
    const robotsController = new AbortController();
    const robotsTimer = setTimeout(() => robotsController.abort(), TIMEOUT_MS);
    const robotsRes = await doFetch(robotsUrl, {
      signal: robotsController.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(robotsTimer);

    if (robotsRes.ok) {
      const robotsTxt = await robotsRes.text();
      if (isBlockedByRobots(robotsTxt, BOT_NAME, targetPath)) {
        return { url, ok: false, blockedByRobots: true };
      }
    }
  } catch {
    // robots.txt fetch failed — proceed optimistically
  }

  // --- Target fetch + parse (one attempt; a thrown error becomes an {ok:false, error}) ---
  const attempt = async (userAgent: string): Promise<FetchResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/pdf,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!res.ok) {
        return { url, ok: false, status: res.status };
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      const looksPdf =
        contentType.includes("application/pdf") ||
        parsed.pathname.toLowerCase().endsWith(".pdf");

      if (looksPdf) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.byteLength > MAX_PDF_BYTES) {
          return {
            url,
            ok: false,
            status: res.status,
            contentType,
            error: `PDF too large (${Math.round(bytes.byteLength / 1024 / 1024)}MB).`,
          };
        }
        return {
          url,
          ok: true,
          status: res.status,
          contentType: "application/pdf",
          isPdf: true,
          pdfBase64: bytes.toString("base64"),
        };
      }

      // Image menus (>50% of HH menus are image/PDF) → return bytes for a vision block.
      const imgType = imageMediaType(contentType, parsed.pathname);
      if (imgType) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          return { url, ok: false, status: res.status, contentType, error: "image too large" };
        }
        // Trust the BYTES, not the URL/header: a WebP served as .png mislabeled here 400s the whole
        // extraction request. Sniff fails → not a Claude-supported raster (SVG/AVIF/error page) → skip.
        const actualType = sniffImageMediaType(bytes);
        if (!actualType) {
          return { url, ok: false, status: res.status, contentType, error: "unsupported image format" };
        }
        return {
          url,
          ok: true,
          status: res.status,
          contentType: actualType,
          isImage: true,
          imageBase64: bytes.toString("base64"),
          imageMediaType: actualType,
        };
      }

      const raw = await res.text();
      // Cloudflare/Turnstile challenge served as a 200 with no real content — flag it so the
      // ladder escalates to the anti-bot provider (the bot-UA refetch above doesn't clear a
      // managed JS challenge; only a real browser / cloud reader does).
      const blocked = detectBotWall(raw) ? ("bot_wall" as const) : undefined;
      const contentText = stripHtml(raw, maxContent);
      const media = extractMediaLinksDetailed(raw, res.url || url);
      const mediaLinks = media.map((m) => m.url);
      const hhContextMediaLinks = media.filter((m) => m.hhContext).map((m) => m.url);
      return { url, ok: true, status: res.status, contentType, contentText, mediaLinks, hhContextMediaLinks, blocked };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { url, ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  };

  let result = await attempt(USER_AGENT);
  for (let i = 0; i < retryDelays.length && isRetryableFailure(result); i++) {
    await sleep(retryDelays[i]);
    result = await attempt(USER_AGENT);
  }
  // Bot-wall fallback: our honest bot UA was reset/forbidden but a real browser may be served.
  // One browser-UA attempt — recovers CDN-walled menus (incl. PDFs the render path can't fetch).
  // If it also fails we return the bot-UA result so its status still routes the render fallback.
  if (isBotWallFailure(result)) {
    const browserResult = await attempt(BROWSER_UA);
    if (browserResult.ok) return browserResult;
  }
  return result;
}
