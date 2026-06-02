/**
 * Runnable unit checks for the pure stub ranker (no test framework in repo).
 * Run: npx tsx scripts/test-stub-rank.ts — exits non-zero on any failure.
 *
 * See docs/superpowers/specs/2026-06-01-rank-stub-candidates-design.md.
 */
import assert from "node:assert/strict";
import { scoreStub, HARVEST_BOOST, MAX_POP_BUMP, LOW_YIELD_PRIOR } from "@/lib/places/stubRank";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("type prior passes through from primaryType (sports_bar 0.62)", () => {
  const r = scoreStub({ name: "Foo", primaryType: "sports_bar" });
  assert.equal(r.base, 0.62);
  assert.ok(Math.abs(r.score - 0.62) < 1e-9);
  assert.ok(r.reasons.some((x) => x.includes("type prior 0.62")));
});

check("harvest signal adds exactly the boost, capped at 1.0", () => {
  const r = scoreStub({ name: "Foo", primaryType: "pub", harvestSignal: true });
  assert.ok(Math.abs(r.score - (0.58 + HARVEST_BOOST)) < 1e-9);
  const high = scoreStub({ name: "Bar", primaryType: "sports_bar", harvestSignal: true, rating: 5, userRatingCount: 99999 });
  assert.ok(high.score <= 1, "score never exceeds 1");
});

check("no type signal → base null but harvest still ranks it", () => {
  const r = scoreStub({ harvestSignal: true });
  assert.equal(r.base, null);
  assert.ok(Math.abs(r.score - HARVEST_BOOST) < 1e-9);
  assert.ok(r.reasons.includes("no type signal"));
});

check("CLOSED_PERMANENTLY is flagged for exclusion", () => {
  const r = scoreStub({ name: "Foo", primaryType: "bar", businessStatus: "CLOSED_PERMANENTLY" });
  assert.equal(r.closed, true);
});

check("operational / null business status is NOT closed", () => {
  assert.equal(scoreStub({ primaryType: "bar", businessStatus: "OPERATIONAL" }).closed, false);
  assert.equal(scoreStub({ primaryType: "bar" }).closed, false);
});

check("no website is flagged but does not zero the score", () => {
  const r = scoreStub({ name: "Foo", primaryType: "bar", hasWebsite: false });
  assert.equal(r.noSite, true);
  assert.ok(r.score > 0);
  assert.ok(r.reasons.some((x) => x.includes("search by name")));
});

check("popularity is a bounded tiebreak (≤ MAX_POP_BUMP)", () => {
  const r = scoreStub({ primaryType: "bar", rating: 5, userRatingCount: 1_000_000 });
  assert.ok(r.popBump <= MAX_POP_BUMP + 1e-9);
  // more reviews → strictly higher bump among equal-rating venues
  const few = scoreStub({ primaryType: "bar", rating: 4.5, userRatingCount: 10 });
  const many = scoreStub({ primaryType: "bar", rating: 4.5, userRatingCount: 5000 });
  assert.ok(many.popBump > few.popBump);
  // zero rating or zero reviews → no bump
  assert.equal(scoreStub({ primaryType: "bar", rating: 0, userRatingCount: 500 }).popBump, 0);
  assert.equal(scoreStub({ primaryType: "bar", rating: 4.5, userRatingCount: 0 }).popBump, 0);
});

check("low-yield tail: seafood/thai/cafe fall below LOW_YIELD_PRIOR", () => {
  for (const pt of ["seafood_restaurant", "thai_restaurant", "cafe", "sushi_restaurant"]) {
    const r = scoreStub({ primaryType: pt });
    assert.ok((r.base ?? 0) < LOW_YIELD_PRIOR, `${pt} should be low-yield`);
  }
  // a bar is above the tail
  assert.ok((scoreStub({ primaryType: "bar" }).base ?? 0) >= LOW_YIELD_PRIOR);
});

console.log(`\n${passed} checks passed.`);
