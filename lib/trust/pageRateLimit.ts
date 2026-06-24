/**
 * In-memory sliding-window rate limiter for PUBLIC PAGE reads (city tables, venue
 * pages). Guards against bulk scrapers pulling the whole dataset page-by-page — the
 * exact attack the API limiters don't cover, since the data lives in server-rendered
 * HTML, not a JSON endpoint.
 *
 * Two hard rules shape this:
 *   1. NEVER throttle legitimate search/social crawlers — SEO is the growth model.
 *      Known good-bot UAs are exempt (see isAllowedCrawler). This is belt-and-
 *      suspenders behind Cloudflare's reverse-DNS "Verified Bots", which is the real
 *      defense against UA spoofing; the UA allowlist here only protects SEO when CF
 *      is NOT yet fronting the origin.
 *   2. Limits are generous enough that a human clicking through the site never trips
 *      them — only automated bulk fetching does.
 *
 * Single-instance only (the app runs one Next server on the droplet); the store
 * resets on restart. Multi-instance would need a shared store (out of scope). Mirrors
 * lib/trust/signalRateLimit.ts.
 */
export interface RateWindow {
  windowMs: number;
  max: number;
}

// Defaults: 60 reqs/min burst + 600 reqs/10min sustained, per client IP. A human
// browsing trips neither; a scraper pulling hundreds of venue pages does. Tunable via
// env without a code change.
export const PAGE_WINDOWS: RateWindow[] = [
  { windowMs: 60_000, max: envInt("PAGE_RATE_LIMIT_PER_MIN", 60) },
  { windowMs: 600_000, max: envInt("PAGE_RATE_LIMIT_PER_10MIN", 600) },
];

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/**
 * Pure: given prior request timestamps (ms) and `now`, decide whether a new request
 * is allowed. When allowed, returns the pruned list with `now` appended (persist it).
 * When blocked, returns the pruned list unchanged (do not record the blocked hit, so
 * a backed-off scraper can recover instead of being permanently wedged).
 */
export function evaluatePageWindow(
  events: number[],
  now: number,
  windows: RateWindow[] = PAGE_WINDOWS,
): { allowed: boolean; events: number[]; retryAfterMs: number } {
  const maxWindow = Math.max(...windows.map((w) => w.windowMs));
  const recent = events.filter((t) => now - t < maxWindow);
  for (const w of windows) {
    const inWindow = recent.filter((t) => now - t < w.windowMs);
    if (inWindow.length >= w.max) {
      // Retry-After = when the oldest in-window hit ages out of this window.
      const oldest = Math.min(...inWindow);
      return { allowed: false, events: recent, retryAfterMs: w.windowMs - (now - oldest) };
    }
  }
  return { allowed: true, events: [...recent, now], retryAfterMs: 0 };
}

const store = new Map<string, number[]>();

/**
 * Stateful wrapper: check + record one request for `key`. Returns
 * { limited, retryAfterSec }. `now` is injectable for tests.
 */
export function hitPageLimit(
  key: string,
  now: number = Date.now(),
): { limited: boolean; retryAfterSec: number } {
  const prior = store.get(key) ?? [];
  const { allowed, events, retryAfterMs } = evaluatePageWindow(prior, now);
  store.set(key, events);
  return { limited: !allowed, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

/** Test seam — clear the in-memory store. */
export function __resetPageLimiter(): void {
  store.clear();
}

// ── Crawler allowlist ─────────────────────────────────────────────────────────

// Verified search + social crawlers we WANT to let through unthrottled: search
// engines for indexing, social/chat bots for link unfurls. Matched case-insensitively
// as substrings of the User-Agent. Spoofable on its own — Cloudflare Verified Bots is
// the spoof-proof layer — but exempting these protects SEO whether or not CF is live.
const ALLOWED_CRAWLER_UAS = [
  "googlebot",
  "google-inspectiontool",
  "storebot-google",
  "bingbot",
  "duckduckbot",
  "slurp", // Yahoo
  "baiduspider",
  "yandexbot",
  "applebot",
  "petalbot",
  "facebookexternalhit",
  "facebookcatalog",
  "meta-externalagent",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "whatsapp",
  "telegrambot",
];

export function isAllowedCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return ALLOWED_CRAWLER_UAS.some((bot) => ua.includes(bot));
}

// ── Client IP extraction ──────────────────────────────────────────────────────

/**
 * Resolve the real client IP, Cloudflare-aware. `cf-connecting-ip` is set by CF to the
 * true visitor when the origin is proxied; otherwise we fall back to the first hop of
 * `x-forwarded-for` (set by nginx) then `x-real-ip`. Returns null when none are present
 * (direct origin hit with no proxy headers) — callers should fail OPEN on a null key so
 * a header-stripping quirk never blocks real users.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    null
  );
}
