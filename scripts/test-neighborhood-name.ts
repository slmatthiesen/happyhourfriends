/**
 * Runnable check: pickNeighborhood extracts a clean vernacular neighborhood name
 * from Google addressComponents, or null for city names, junk, and missing types.
 *
 * Run: tsx scripts/test-neighborhood-name.ts
 */
import assert from "node:assert";
import { pickNeighborhood, normalizeName } from "@/lib/places/neighborhoodName";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("prefers neighborhood-typed component over locality", () => {
  const result = pickNeighborhood(
    [
      { longText: "Temescal", shortText: "Temescal", types: ["neighborhood"] },
      { longText: "Oakland", shortText: "Oakland", types: ["locality"] },
    ],
    "Oakland",
  );
  assert.strictEqual(result, "Temescal");
});

check("falls back to sublocality when no neighborhood type", () => {
  const result = pickNeighborhood(
    [{ longText: "Upper Dimond", types: ["sublocality", "sublocality_level_1"] }],
    "Oakland",
  );
  assert.strictEqual(result, "Upper Dimond");
});

check("rejects the city name itself", () => {
  const result = pickNeighborhood(
    [{ longText: "Oakland", types: ["neighborhood"] }],
    "Oakland",
  );
  assert.strictEqual(result, null);
});

check("rejects junk values", () => {
  const result = pickNeighborhood(
    [{ longText: "Parking lot", types: ["neighborhood"] }],
    "Oakland",
  );
  assert.strictEqual(result, null);
});

check("returns null when no neighborhood/sublocality component present", () => {
  const result = pickNeighborhood(
    [{ longText: "94607", types: ["postal_code"] }],
    "Oakland",
  );
  assert.strictEqual(result, null);
});

check("returns null for null/undefined input", () => {
  assert.strictEqual(pickNeighborhood(null, "Oakland"), null);
  assert.strictEqual(pickNeighborhood(undefined, "Oakland"), null);
  assert.strictEqual(pickNeighborhood([], "Oakland"), null);
});

check("normalizeName collapses internal whitespace and trims", () => {
  assert.strictEqual(normalizeName("  Old   Oakland "), "Old Oakland");
});

console.log(`\n${passed} checks passed.`);
