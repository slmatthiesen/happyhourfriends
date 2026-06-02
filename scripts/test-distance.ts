/**
 * Unit checks for the distance util. Run: npx tsx scripts/test-distance.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { haversineMiles, formatDistance } from "@/lib/geo/distance";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
function approx(actual: number, expected: number, tol: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected} ± ${tol}, got ${actual}`,
  );
}

// One degree of longitude at the equator ≈ 69.09 miles.
check("1° longitude at equator ≈ 69.09 mi", () =>
  approx(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 69.09, 0.5, "lng"));
// One degree of latitude ≈ 69.09 miles anywhere.
check("1° latitude ≈ 69.09 mi", () =>
  approx(haversineMiles({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 69.09, 0.5, "lat"));
// Identical points → 0.
check("identical points → 0 mi", () =>
  assert.equal(haversineMiles({ lat: 47, lng: -122 }, { lat: 47, lng: -122 }), 0));
// Real-world sanity: Tacoma → Seattle is ~25 miles.
check("Tacoma → Seattle ≈ 25 mi", () =>
  approx(
    haversineMiles({ lat: 47.2426, lng: -122.4597 }, { lat: 47.6062, lng: -122.3321 }),
    25.3,
    2.0,
    "tac-sea",
  ));

// formatDistance thresholds.
check("< 0.1 mi label below a tenth", () =>
  assert.equal(formatDistance(0.04), "< 0.1 mi"));
check("zero formats as < 0.1 mi", () =>
  assert.equal(formatDistance(0), "< 0.1 mi"));
check("one decimal at 0.44", () =>
  assert.equal(formatDistance(0.44), "0.4 mi"));
check("one decimal at 1.24", () =>
  assert.equal(formatDistance(1.24), "1.2 mi"));
check("whole number keeps one decimal", () =>
  assert.equal(formatDistance(2), "2.0 mi"));

console.log(`\n${passed} checks passed.`);
