/**
 * Hermetic unit tests for the public-page scrape limiter (lib/trust/pageRateLimit).
 * Covers: window math + Retry-After, the crawler allowlist (SEO must never be
 * throttled), and Cloudflare-aware client-IP extraction. Run: tsx scripts/test-page-rate-limit.ts
 */
import assert from "node:assert";
import {
  clientIpFromHeaders,
  evaluatePageWindow,
  hitPageLimit,
  isAllowedCrawler,
  __resetPageLimiter,
  type RateWindow,
} from "@/lib/trust/pageRateLimit";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const W: RateWindow[] = [
  { windowMs: 60_000, max: 5 },
  { windowMs: 600_000, max: 20 },
];

check("allows requests under the burst limit and records each", () => {
  let events: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = evaluatePageWindow(events, 1_000 + i, W);
    assert.ok(r.allowed, `request ${i} should be allowed`);
    events = r.events;
  }
  assert.equal(events.length, 5);
});

check("blocks the request that exceeds the burst window and does NOT record it", () => {
  let events: number[] = [];
  for (let i = 0; i < 5; i++) events = evaluatePageWindow(events, 1_000 + i, W).events;
  const blocked = evaluatePageWindow(events, 1_010, W);
  assert.ok(!blocked.allowed);
  assert.equal(blocked.events.length, 5, "blocked hit must not be recorded");
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000);
});

check("recovers after the window ages out", () => {
  let events: number[] = [];
  for (let i = 0; i < 5; i++) events = evaluatePageWindow(events, 1_000 + i, W).events;
  // 61s later the oldest 5 have aged out of the 60s window.
  const later = evaluatePageWindow(events, 1_000 + 61_000, W);
  assert.ok(later.allowed);
});

check("hitPageLimit: trips after max, returns a sane Retry-After (seconds)", () => {
  __resetPageLimiter();
  const key = "page:1.2.3.4";
  let last = { limited: false, retryAfterSec: 0 };
  for (let i = 0; i < 70; i++) last = hitPageLimit(key, 5_000 + i);
  assert.ok(last.limited, "should be limited well within the default 60/min");
  assert.ok(last.retryAfterSec >= 1);
});

check("two different IPs have independent budgets", () => {
  __resetPageLimiter();
  for (let i = 0; i < 70; i++) hitPageLimit("page:a", 1_000 + i);
  const other = hitPageLimit("page:b", 2_000);
  assert.ok(!other.limited, "a flood from one IP must not throttle another");
});

check("isAllowedCrawler: real search/social bots are exempt (SEO + unfurls)", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "Mozilla/5.0 (compatible; Applebot/0.1)",
  ]) {
    assert.ok(isAllowedCrawler(ua), `should exempt: ${ua}`);
  }
});

check("isAllowedCrawler: ordinary browsers and scrapers are NOT exempt", () => {
  for (const ua of [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "python-requests/2.31.0",
    "curl/8.4.0",
    "Scrapy/2.11",
    "",
  ]) {
    assert.ok(!isAllowedCrawler(ua), `should NOT exempt: ${ua}`);
  }
  assert.ok(!isAllowedCrawler(null));
});

check("clientIpFromHeaders: prefers cf-connecting-ip, then XFF first hop, then x-real-ip", () => {
  assert.equal(
    clientIpFromHeaders(
      new Headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }),
    ),
    "9.9.9.9",
  );
  assert.equal(
    clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })),
    "1.1.1.1",
  );
  assert.equal(clientIpFromHeaders(new Headers({ "x-real-ip": "3.3.3.3" })), "3.3.3.3");
  assert.equal(clientIpFromHeaders(new Headers()), null, "no proxy headers → null (fail open)");
});

console.log(`\n${passed} checks passed.`);
