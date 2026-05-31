/**
 * Runnable unit checks for hhLikelihood (no test framework in repo).
 * Run: npx tsx scripts/test-hh-likelihood.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { hhLikelihood } from "@/lib/places/hhLikelihood";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// primaryType drives the score (per-cuisine, matching the review doc)
check("sports_bar is high", () =>
  assert.ok((hhLikelihood({ primaryType: "sports_bar" }) ?? 0) > 0.5));
check("bar is high", () =>
  assert.ok((hhLikelihood({ primaryType: "bar" }) ?? 0) > 0.5));
check("brewery is high", () =>
  assert.ok((hhLikelihood({ primaryType: "brewery" }) ?? 0) > 0.5));
check("american_restaurant is high", () =>
  assert.ok((hhLikelihood({ primaryType: "american_restaurant" }) ?? 0) > 0.5));
check("italian_restaurant is high", () =>
  assert.ok((hhLikelihood({ primaryType: "italian_restaurant" }) ?? 0) > 0.5));
check("mexican_restaurant is mid (not >0.5)", () => {
  const v = hhLikelihood({ primaryType: "mexican_restaurant" }) ?? 0;
  assert.ok(v > 0 && v <= 0.5);
});
check("chinese_restaurant is low", () =>
  assert.ok((hhLikelihood({ primaryType: "chinese_restaurant" }) ?? 1) < 0.1));
check("thai_restaurant is ~0", () =>
  assert.equal(hhLikelihood({ primaryType: "thai_restaurant" }), 0));
check("seafood_restaurant is low", () =>
  assert.ok((hhLikelihood({ primaryType: "seafood_restaurant" }) ?? 1) < 0.1));

// types[] fallback when primaryType is null
check("types[] sports_bar wins when primaryType null", () =>
  assert.ok((hhLikelihood({ primaryType: null, types: ["point_of_interest", "sports_bar"] }) ?? 0) > 0.5));

// name-keyword floor lifts an otherwise-generic restaurant
check("name 'Cantina' floors a generic restaurant above 0.5", () =>
  assert.ok((hhLikelihood({ primaryType: "restaurant", name: "Ojos Locos Sports Cantina" }) ?? 0) > 0.5));

// genuinely unknown → null (treated as below-threshold by the gate)
check("no signal at all → null", () =>
  assert.equal(hhLikelihood({ primaryType: null, types: null, name: null }), null));

console.log(`\n${passed} checks passed.`);
