/**
 * Unit checks for the neighborhood recognizability helpers.
 * Run: npx tsx scripts/test-recognizability.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  tierForPlace,
  recognizabilityScore,
  isRecognizableFine,
  RECOGNIZABLE_BAR,
} from "@/lib/geo/recognizability";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// tierForPlace: coarse OSM place types → coarse, fine ones → fine, unknown → fine.
check("suburb is coarse", () => assert.equal(tierForPlace("suburb"), "coarse"));
check("city_district is coarse", () =>
  assert.equal(tierForPlace("city_district"), "coarse"));
check("borough is coarse", () => assert.equal(tierForPlace("borough"), "coarse"));
check("neighbourhood is fine", () =>
  assert.equal(tierForPlace("neighbourhood"), "fine"));
check("quarter is fine", () => assert.equal(tierForPlace("quarter"), "fine"));
check("unknown/empty defaults to fine", () => {
  assert.equal(tierForPlace(undefined), "fine");
  assert.equal(tierForPlace(""), "fine");
});

// recognizabilityScore: wiki tag → 2, bare suburb → 1, else 0.
check("wikidata present → 2", () =>
  assert.equal(recognizabilityScore({ wikidata: "Q123", place: "neighbourhood" }), 2));
check("wikipedia present → 2", () =>
  assert.equal(recognizabilityScore({ wikipedia: "en:Sam Hughes", place: "quarter" }), 2));
check("bare suburb (no wiki) → 1", () =>
  assert.equal(recognizabilityScore({ place: "suburb" }), 1));
check("plain neighbourhood, no wiki → 1 (OSM-presence signal)", () =>
  assert.equal(recognizabilityScore({ place: "neighbourhood" }), 1));
check("quarter, no wiki → 1", () =>
  assert.equal(recognizabilityScore({ place: "quarter" }), 1));
check("empty tags → 0", () => assert.equal(recognizabilityScore({}), 0));

// isRecognizableFine: fine + score ≥ bar.
check("fine + score 2 is recognizable", () =>
  assert.equal(isRecognizableFine("fine", 2), true));
check("fine + score 0 is NOT recognizable", () =>
  assert.equal(isRecognizableFine("fine", 0), false));
check("coarse is never 'recognizable fine' regardless of score", () =>
  assert.equal(isRecognizableFine("coarse", 2), false));
check("RECOGNIZABLE_BAR is 1", () => assert.equal(RECOGNIZABLE_BAR, 1));

console.log(`\n${passed} checks passed.`);
