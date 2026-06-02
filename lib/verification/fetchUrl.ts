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

const USER_AGENT =
  "HappyHourFriendsBot/1.0 (+https://happyhourfriends.com)";

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

function stripHtml(html: string, maxContent: number = MAX_CONTENT): string {
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
            "HappyHourFriendsBot",
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
