/**
 * Runnable unit checks for freeExtractFromPages.
 * Run: pnpm tsx scripts/test-free-extract.ts
 */
import assert from "node:assert/strict";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
const META = { model: "deterministic-html-v1", promptHash: "abc" };

check("clean plausible window → cost-0 ExtractResult, not suspect", () => {
  const r = freeExtractFromPages([{ url: "https://x.com/hh", text: "Happy Hour: 3pm-7pm daily" }], META);
  assert.ok(r, "expected a result");
  assert.equal(r!.costCents, 0);
  assert.equal(r!.usage.inputTokens, 0);
  assert.equal(r!.model, "deterministic-html-v1");
  assert.equal(r!.happyHours.length, 1);
  assert.equal(r!.happyHours[0].startTime, "15:00");
  assert.ok(!r!.happyHours[0].suspect);
  assert.equal(r!.confidence, 1);
});
check("clean but implausible window → returned, marked suspect (hidden for review)", () => {
  const r = freeExtractFromPages([{ url: "https://x.com", text: "Happy hour 11am-10pm daily" }], META);
  assert.ok(r, "expected a result (captured hidden, not dropped)");
  assert.equal(r!.happyHours.length, 1);
  assert.equal(r!.happyHours[0].suspect, true);
});
check("only fuzzy content → null (escalate)", () => {
  const r = freeExtractFromPages([{ url: "https://x.com", text: "the best happy hour in town!" }], META);
  assert.equal(r, null);
});
check("no pages → null", () => {
  assert.equal(freeExtractFromPages([], META), null);
});

console.log(`\n${passed} checks passed.`);
