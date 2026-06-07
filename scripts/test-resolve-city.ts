/**
 * Unit checks for requireCityArgs (the --state enforcement). Pure, hermetic.
 * Run: pnpm tsx scripts/test-resolve-city.ts
 */
import assert from "node:assert/strict";
import { requireCityArgs } from "@/lib/cities/resolveCity";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("both --city and --state → parsed, lowercased", () => {
  const r = requireCityArgs(["node", "x", "--city", "Hollywood", "--state", "FL"]);
  assert.deepEqual(r, { slug: "hollywood", state: "fl" });
});
check("missing --state → throws (state is mandatory)", () => {
  assert.throws(() => requireCityArgs(["node", "x", "--city", "hollywood"]), /state.*required|required.*state/i);
});
check("missing --city → throws", () => {
  assert.throws(() => requireCityArgs(["node", "x", "--state", "fl"]), /required/i);
});
check("neither → throws", () => {
  assert.throws(() => requireCityArgs(["node", "x"]), /required/i);
});

console.log(`\n${passed} checks passed.`);
