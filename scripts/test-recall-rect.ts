/**
 * test-recall-rect — hermetic checks for the recall rectangle floor math (no network).
 * Run: tsx scripts/test-recall-rect.ts
 */
import assert from "node:assert/strict";
import { rectHalfDiagonalMeters, canSubdivideRect, isQuerySaturated } from "@/scripts/seed-discover";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// A ~1.1km × ~1.1km box near lat 37.33 (downtown SJ): half-diagonal ≈ 780m.
const sjBox = { low: { latitude: 37.330, longitude: -121.900 }, high: { latitude: 37.340, longitude: -121.888 } };

check("rectHalfDiagonalMeters is positive and in the expected order of magnitude", () => {
  const m = rectHalfDiagonalMeters(sjBox);
  assert.ok(m > 500 && m < 1500, `half-diagonal ${m} out of expected range`);
});

check("canSubdivideRect: a box whose CHILD would fall below the floor cannot split", () => {
  // Child half-diagonal = parent/2 ≈ 390m; with a 450m floor the child is BELOW floor → cannot split.
  assert.equal(canSubdivideRect(sjBox, 450), false);
});

check("canSubdivideRect: a large box (child above floor) may split", () => {
  const big = { low: { latitude: 37.30, longitude: -121.95 }, high: { latitude: 37.40, longitude: -121.85 } };
  // ~11km box → half-diagonal ~7.8km → child ~3.9km ≥ 450m floor → can split.
  assert.equal(canSubdivideRect(big, 450), true);
});

// isQuerySaturated — the truncation signal that drives subdivision. Google hard-caps a query at
// 60 results (3×20) and gives NO 4th pageToken, so saturation must be read from the result COUNT.
check("isQuerySaturated: a full 60-result query is saturated (Google's hard cap → truncated)", () => {
  assert.equal(isQuerySaturated(60, false), true);
});
check("isQuerySaturated: fewer than the cap is NOT saturated (region exhausted)", () => {
  assert.equal(isQuerySaturated(40, false), false);
  assert.equal(isQuerySaturated(0, false), false);
});
check("isQuerySaturated: a leftover pageToken also flags saturation (defensive)", () => {
  assert.equal(isQuerySaturated(40, true), true);
});

console.log(`\n${passed} checks passed.`);
