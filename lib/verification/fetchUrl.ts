/**
 * fetchUrl — robots.txt-respecting HTTP fetcher used by the Stage 2 verifier
 * tool loop (PRD §4.3). Returns stripped plain text capped at ~8000 chars for HTML.
 * For PDFs (the most common menu format) it returns the raw bytes as base64 so the
 * caller can hand them to Claude as a native document block (text + OCR). Never
 * throws; all errors surface as { ok: false, error }.
 */

const USER_AGENT =
  "HappyHourFriendsBot/1.0 (+https://happyhourfriends.com)";

const TIMEOUT_MS = 10_000;
const MAX_CONTENT = 8_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // Claude accepts up to 32MB; keep it sane.

export interface FetchResult {
  url: string;
  ok: boolean;
  status?: number;
  contentText?: string;
  /** Set when the resource is a PDF — base64 bytes for a document content block. */
  isPdf?: boolean;
  pdfBase64?: string;
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

function stripHtml(html: string): string {
  // Remove <script> and <style> blocks (including content)
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_CONTENT);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchUrl(url: string): Promise<FetchResult> {
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

    const raw = await res.text();
    const contentText = stripHtml(raw);
    return { url, ok: true, status: res.status, contentType, contentText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, ok: false, error: message };
  }
}
