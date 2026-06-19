/**
 * Runnable unit checks for freeExtractFromPages.
 * Run: pnpm tsx scripts/test-free-extract.ts
 */
import assert from "node:assert/strict";
import { freeExtractFromPages, shouldEscalateForDroppedDeals, reconcileFreeDaysWithModelOfferings } from "@/lib/ai/freeExtract";
import type { ExtractResult, ExtractedHappyHour, ExtractedOffering } from "@/lib/ai/extractHappyHours";

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
check("escalate: Rose Garden class — free window + 'Half-off / $3 off' deal text on the SAME page", () => {
  // Real /admin/bare-windows miss (The Rose Garden, 2026-06-19): the free parser captured the
  // Tue–Fri 4–6pm window but dropped the deals to 0 offerings, while the page plainly lists
  // them. The shared extractHappyHours short-circuit used to take this $0 bare result and never
  // pay the model — so the venue could never leave the bare-windows bucket.
  const page = {
    url: "https://therosegardenaz.com/phoenix-downtown-the-rose-garden-happy-hours-specials",
    text: "Happy Hour Tuesday-Friday 4pm-6pm. Half-off all flatbreads. $3 off any menu drink (beer, wine, signature cocktails).",
  };
  const free = freeExtractFromPages([page], META);
  assert.ok(free && free.happyHours.length >= 1, "free parsed the window");
  assert.equal(free!.happyHours.some((w) => w.offerings.length > 0), false, "but dropped the deals → bare window");
  assert.equal(shouldEscalateForDroppedDeals(free, [page]), true, "deal text present → must escalate to paid extractor");
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

// ── reconcileFreeDaysWithModelOfferings: free DAYS win, model supplies OFFERINGS ──────────
const off = (p: Partial<ExtractedOffering>): ExtractedOffering => ({
  kind: "food", category: "appetizer", name: null, priceCents: null, originalPriceCents: null,
  discountCents: null, description: null, conditions: null, sourceUrl: "https://x.com/hh", ...p,
});
const win = (p: Partial<ExtractedHappyHour>): ExtractedHappyHour => ({
  daysOfWeek: [2, 3, 4, 5], allDay: false, startTime: "16:00", endTime: "18:00", timeKnown: true,
  locationWithinVenue: "all", notes: null, sourceUrl: "https://x.com/hh", offerings: [], ...p,
});
const result = (windows: ExtractedHappyHour[], conf = 0.65): ExtractResult => ({
  happyHours: windows, confidence: conf, summary: "", venueType: null,
  usage: { inputTokens: 100, outputTokens: 50 }, costCents: 2, promptHash: "ph", model: "haiku",
});

check("reconcile: Rose Garden — free Tue-Fri days kept, model deals attached, dated promos dropped", () => {
  const free = result([win({ daysOfWeek: [2, 3, 4, 5], offerings: [] })], 1);
  const model = result([
    win({ daysOfWeek: [2, 4, 5, 7], offerings: [off({ name: "Flatbreads", description: "Half-off" }), off({ kind: "drink", category: "beer", description: "$3 off drinks", discountCents: 300 })] }),
    win({ daysOfWeek: [2], allDay: true, startTime: null, endTime: null, offerings: [] }), // Trouble Tuesdays all-day
    win({ daysOfWeek: [7], startTime: "16:00", endTime: "00:00", offerings: [] }), // Sunday Funday extended
  ]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 1, "one stable window, dated promos dropped");
  assert.deepEqual(r.happyHours[0].daysOfWeek, [2, 3, 4, 5], "days from the free parse (stable)");
  assert.equal(r.happyHours[0].offerings.length, 2, "model's deals attached");
  assert.equal(r.costCents, 2, "carries the paid model's cost for the ledger");
});

check("reconcile: model-only windows are DROPPED — explicit statement wins (kills the flicker)", () => {
  const free = result([win({ daysOfWeek: [1, 2, 3, 4, 5], offerings: [] })], 1);
  const model = result([
    win({ daysOfWeek: [1, 2, 3, 4, 5], offerings: [off({ name: "Wings", priceCents: 500 })] }), // overlaps free → folds in
    win({ daysOfWeek: [7], startTime: "16:00", endTime: "18:00", offerings: [off({ name: "Funday deal", priceCents: 900 })] }), // Sunday promo, disjoint day → dropped
  ]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 1, "only the free window survives; the Sunday promo is dropped");
  assert.deepEqual(r.happyHours[0].daysOfWeek, [1, 2, 3, 4, 5], "stable days from the free parse");
  assert.equal(r.happyHours[0].offerings.length, 1, "Wings folded into the free window");
});

check("reconcile: a bare model-only window (no shared day) is dropped as noise", () => {
  const free = result([win({ daysOfWeek: [2, 3, 4, 5], offerings: [] })], 1);
  const model = result([
    win({ daysOfWeek: [2, 3, 4, 5], offerings: [off({ name: "Sliders" })] }),
    win({ daysOfWeek: [7], startTime: "10:00", endTime: "13:00", offerings: [] }), // disjoint bare promo → drop
  ]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 1, "bare model-only promo dropped");
  assert.equal(r.happyHours[0].offerings.length, 1);
});

check("reconcile: distinct specific areas don't cross-pollinate (free 'bar' keeps out 'patio' deals)", () => {
  const free = result([win({ locationWithinVenue: "bar", offerings: [] })], 1);
  const model = result([win({ locationWithinVenue: "patio", offerings: [off({ name: "Patio-only" })] })]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 1, "only the free 'bar' window survives");
  assert.equal(r.happyHours[0].offerings.length, 0, "free 'bar' window did not absorb 'patio' deals");
});

console.log(`\n${passed} checks passed.`);
