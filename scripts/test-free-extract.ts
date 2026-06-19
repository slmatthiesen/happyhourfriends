/**
 * Runnable unit checks for freeExtractFromPages.
 * Run: pnpm tsx scripts/test-free-extract.ts
 */
import assert from "node:assert/strict";
import { freeExtractFromPages, shouldEscalateForDroppedDeals } from "@/lib/ai/freeExtract";

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

// The enrich free-first gate decision (the Santo Mezcal bug): the free parser captured a
// bare TIME window from one page but the deals live in a form it can't attach (a menu PDF/
// image, or another fetched page). Must escalate to the paid extractor, not persist bare.
const bareSchedule = { url: "https://x.com/hh", text: "Happy Hour Monday-Friday 3pm-6pm. Join us!" };

check("escalate: free window, 0 offerings, a fetched menu PDF carries the deals", () => {
  const free = freeExtractFromPages([bareSchedule], META);
  assert.ok(free && free.happyHours.length >= 1, "free parsed the window");
  assert.equal(free!.happyHours.some((w) => w.offerings.length > 0), false, "but captured 0 offerings");
  const pdfPage = { url: "https://x.com/hh.pdf", pdfBase64: "JVBERi0=" };
  assert.equal(shouldEscalateForDroppedDeals(free, [bareSchedule, pdfPage]), true);
});
check("escalate: free window + another page showing prices the parser didn't attach", () => {
  const free = freeExtractFromPages([bareSchedule], META);
  const pricePage = { url: "https://x.com/drinks", text: "Drink specials: $9 margaritas, $7 wine" };
  assert.equal(shouldEscalateForDroppedDeals(free, [bareSchedule, pricePage]), true);
});
check("DO NOT escalate: genuinely bare time-only pages stay $0", () => {
  const free = freeExtractFromPages([bareSchedule], META);
  assert.ok(free, "free parsed the bare window");
  assert.equal(shouldEscalateForDroppedDeals(free, [bareSchedule]), false);
});
check("DO NOT escalate when the free parse already captured offerings", () => {
  const priced = { url: "https://x.com/hh", text: "Happy Hour 3-6pm: $5 beer, $7 wine" };
  const free = freeExtractFromPages([priced], META);
  assert.ok(free && free.happyHours.some((w) => w.offerings.length > 0), "free got offerings");
  assert.equal(shouldEscalateForDroppedDeals(free, [priced]), false);
});
check("DO NOT escalate when there is no free window (null → normal paid path handles it)", () => {
  assert.equal(shouldEscalateForDroppedDeals(null, [{ url: "https://x.com", text: "$5 beers all day" }]), false);
});

console.log(`\n${passed} checks passed.`);
