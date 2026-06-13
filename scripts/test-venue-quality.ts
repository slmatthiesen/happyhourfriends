/**
 * Runnable unit checks for venue-quality signals (no test framework in repo).
 * Run: npx tsx scripts/test-venue-quality.ts — exits non-zero on any failure.
 *
 * These feed the $0 curation report (audit:quality). The alcohol detector is the
 * trust-critical piece: we detect alcohol POSITIVELY from a venue's own page text
 * (cocktails / draft / wine list / full bar), biased to RECALL — a false positive
 * just keeps a venue, a false negative could wrongly drop a real bar.
 */
import assert from "node:assert/strict";
import { hasAlcoholContent, isSquatterHtml, classifySiteHealth, qualityVerdict } from "@/lib/places/venueQuality";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── hasAlcoholContent — positive alcohol evidence from first-party page text ──────
check("craft cocktails + draft beer → alcohol", () =>
  assert.equal(hasAlcoholContent("Our craft cocktails and draft beer on tap"), true));
check("wine by the glass / wine list → alcohol", () =>
  assert.equal(hasAlcoholContent("Extensive wine list, available by the glass"), true));
check("full bar → alcohol", () =>
  assert.equal(hasAlcoholContent("We have a full bar and a great patio"), true));
check("margaritas + tequila → alcohol", () =>
  assert.equal(hasAlcoholContent("House margaritas and a tequila flight"), true));
check("happy hour wording → alcohol", () =>
  assert.equal(hasAlcoholContent("Happy Hour Mon-Fri 3-6pm"), true));
check("21+ wording → alcohol", () =>
  assert.equal(hasAlcoholContent("Must be 21+ to enter the lounge"), true));

check("family-restaurant menu with no drinks → NOT alcohol", () =>
  assert.equal(hasAlcoholContent("Fried rice, chow mein, dim sum, jasmine tea, boba"), false));
check("'salad bar' / 'granola bar' do not false-match on bare 'bar'", () =>
  assert.equal(hasAlcoholContent("All-you-can-eat salad bar and a granola bar"), false));
check("'ginger' does not false-match 'gin'", () =>
  assert.equal(hasAlcoholContent("Fresh ginger and lemongrass soup"), false));
check("empty text → NOT alcohol", () =>
  assert.equal(hasAlcoholContent(""), false));

// ── isSquatterHtml — lapsed-domain / generic restaurant-finder placeholder ───────
check("GOLDEN Los Metates squatter ('FromTheRestaurant | Find Restaurants Near You')", () =>
  assert.equal(isSquatterHtml("<title>FromTheRestaurant | Find Restaurants Near You</title><body>Find restaurants near you</body>"), true));
check("a real restaurant homepage is NOT a squatter page", () =>
  assert.equal(isSquatterHtml("<title>Celia's Mexican Restaurant — Daly City</title><body>Our menu, hours, and happy hour</body>"), false));
check("empty html → not squatter", () =>
  assert.equal(isSquatterHtml(""), false));

// ── classifySiteHealth — a 403/timeout is ALIVE (bot-wall), never "dead" ──────────
const H = (over: Partial<Parameters<typeof classifySiteHealth>[0]> = {}) =>
  classifySiteHealth({ hasUrl: true, isMenuPlatform: false, isSocial: false, ok: false, status: null, networkError: null, hasText: false, parked: false, squatter: false, brokenHttps: false, ...over });

check("GOLDEN Boulevard Cafe: HTTP 403 is a bot-wall → blocked, NOT dead", () =>
  assert.equal(H({ ok: false, status: 403 }), "blocked"));
check("200 with text → live", () =>
  assert.equal(H({ ok: true, status: 200, hasText: true }), "live"));
check("200 with no extractable text → unreadable (alive), not dead", () =>
  assert.equal(H({ ok: true, status: 200, hasText: false }), "unreadable"));
check("500 → dead", () => assert.equal(H({ ok: false, status: 500 }), "dead"));
check("404 → dead", () => assert.equal(H({ ok: false, status: 404 }), "dead"));
check("429 rate-limit → blocked (alive)", () => assert.equal(H({ ok: false, status: 429 }), "blocked"));
check("DNS/connection failure → dead", () => assert.equal(H({ networkError: "dead" }), "dead"));
check("timeout/reset → blocked (SACRED: alive, kept)", () => assert.equal(H({ networkError: "blocked" }), "blocked"));
check("squatter text → squatter", () => assert.equal(H({ ok: true, status: 200, hasText: true, squatter: true }), "squatter"));
check("broken-https but readable over http → broken-https", () =>
  assert.equal(H({ ok: true, status: 200, hasText: true, brokenHttps: true }), "broken-https"));
check("menu-platform / social / no-site short-circuit", () => {
  assert.equal(H({ isMenuPlatform: true }), "menu-platform");
  assert.equal(H({ isSocial: true }), "social-only");
  assert.equal(H({ hasUrl: false }), "no-site");
});

// ── qualityVerdict — never drop a venue we could not read ─────────────────────────
check("GOLDEN Boulevard Cafe: no HH, no alcohol, blocked site → review (NOT drop?)", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: false, health: "blocked" }), "review"));
check("live site, read it, no alcohol, no HH → drop? (genuinely dry)", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: false, health: "live" }), "drop?"));
check("live site with alcohol → keep", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: true, health: "live" }), "keep"));
check("a live HH always keeps", () =>
  assert.equal(qualityVerdict({ hhLive: 1, anyAlcohol: false, health: "dead" }), "keep"));
check("truly dead site, no HH/alcohol → drop?", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: false, health: "squatter" }), "drop?"));
check("menu-platform, no HH → drop?", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: false, health: "menu-platform" }), "drop?"));
check("real bar with only a Facebook page (alcohol by type/name) → keep", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: true, health: "social-only" }), "keep"));
check("social-only, no alcohol evidence → review (can't confirm dry)", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: false, health: "social-only" }), "review"));
check("unreadable 200, no signal → review", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: false, health: "unreadable" }), "review"));
check("dead site overrides alcohol (likely closed) → drop?", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: true, health: "dead" }), "drop?"));
// A real bar can simply have NO website (Kona Club, Laurel Lounge) — that's a crowdsource
// stub, not junk. no-site must NOT override alcohol-by-type: flag for review, never drop.
check("GOLDEN Kona Club: no-site BAR (alcohol by type) → review, NOT drop?", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: true, health: "no-site" }), "review"));
check("no-site venue with NO alcohol evidence → drop? (nothing to feature)", () =>
  assert.equal(qualityVerdict({ hhLive: 0, anyAlcohol: false, health: "no-site" }), "drop?"));

console.log(`\n${passed} checks passed.`);
