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

import { extractMediaLinks } from "@/lib/places/siteTriage";
import { harvestJsonLdMenu } from "@/lib/places/jsonLdMenu";

const BOT_NAME = "HappyHourFriendsBot";
const USER_AGENT = `${BOT_NAME}/1.0 (+https://happyhourfriends.com)`;

const TIMEOUT_MS = 10_000;
const MAX_CONTENT = 8_000; // default (verifier tool loop); extractor overrides higher.
const MAX_PDF_BYTES = 10 * 1024 * 1024; // Claude accepts up to 32MB; keep it sane.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // vision images — keep request size sane.

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

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
  contentType?: string;
  blockedByRobots?: boolean;
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
  // 4. Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

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
  const jsonLdMenu = harvestJsonLdMenu(html);
  if (jsonLdMenu) text = text ? `${jsonLdMenu}\n\n${text}` : jsonLdMenu;

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
  try {
    const parsed = new URL(url);
    const targetPath = parsed.pathname + parsed.search;
    const robotsUrl = `${parsed.origin}/robots.txt`;

    // --- robots.txt check ---
    try {
      const robotsController = new AbortController();
      const robotsTimer = setTimeout(
        () => robotsController.abort(),
        TIMEOUT_MS,
      );
      const robotsRes = await fetch(robotsUrl, {
        signal: robotsController.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(robotsTimer);

      if (robotsRes.ok) {
        const robotsTxt = await robotsRes.text();
        if (
          isBlockedByRobots(
            robotsTxt,
            BOT_NAME,
            targetPath,
          )
        ) {
          return { url, ok: false, blockedByRobots: true };
        }
      }
    } catch {
      // robots.txt fetch failed — proceed optimistically
    }

    // --- Target fetch ---
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/pdf,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);

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
      return {
        url,
        ok: true,
        status: res.status,
        contentType: imgType,
        isImage: true,
        imageBase64: bytes.toString("base64"),
        imageMediaType: imgType,
      };
    }

    const raw = await res.text();
    const contentText = stripHtml(raw, maxContent);
    const mediaLinks = extractMediaLinks(raw, res.url || url);
    return { url, ok: true, status: res.status, contentType, contentText, mediaLinks };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, ok: false, error: message };
  }
}
