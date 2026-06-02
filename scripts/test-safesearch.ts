/**
 * Pure-verdict checks for SafeSearch (no API call, no key needed).
 * Run: npx tsx scripts/test-safesearch.ts
 */
import assert from "node:assert/strict";
import { isSafe, type SafeSearchAnnotation } from "@/lib/moderation/safeSearch";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const clean: SafeSearchAnnotation = { adult: "UNLIKELY", violence: "VERY_UNLIKELY", racy: "POSSIBLE" };
check("clean menu passes", () => assert.equal(isSafe(clean), true));
check("LIKELY adult fails", () => assert.equal(isSafe({ ...clean, adult: "LIKELY" }), false));
check("VERY_LIKELY violence fails", () => assert.equal(isSafe({ ...clean, violence: "VERY_LIKELY" }), false));
check("LIKELY racy fails", () => assert.equal(isSafe({ ...clean, racy: "LIKELY" }), false));
check("missing annotation is treated as safe", () => assert.equal(isSafe({}), true));
check("POSSIBLE is allowed (only LIKELY+ blocks)", () => assert.equal(isSafe({ adult: "POSSIBLE", racy: "POSSIBLE", violence: "POSSIBLE" }), true));

console.log(`\n${passed} checks passed.`);
