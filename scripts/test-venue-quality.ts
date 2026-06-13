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
import { hasAlcoholContent, isSquatterHtml } from "@/lib/places/venueQuality";

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

console.log(`\n${passed} checks passed.`);
