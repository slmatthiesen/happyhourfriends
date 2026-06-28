/**
 * Runnable unit checks for freeExtractFromPages.
 * Run: pnpm tsx scripts/test-free-extract.ts
 */
import assert from "node:assert/strict";
import { freeExtractFromPages, shouldEscalateForDroppedDeals, freeLacksOfferings, reconcileFreeDaysWithModelOfferings } from "@/lib/ai/freeExtract";
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

// freeLacksOfferings: the operator-asserted (deliberate URL paste) escalation predicate. It drops
// the pagesShowDroppedDeals page-signal requirement so a bare window escalates even when discovery
// missed the menu doc — the Cervecería case (deals only in an undetected banner image).
check("freeLacksOfferings: bare window → true; with offerings → false; null → false", () => {
  const bare = freeExtractFromPages([bareSchedule], META);
  const priced = freeExtractFromPages([{ url: "https://x.com/hh", text: "Happy Hour 3-6pm: $5 beer, $7 wine" }], META);
  assert.equal(freeLacksOfferings(bare), true);
  assert.equal(freeLacksOfferings(priced), false);
  assert.equal(freeLacksOfferings(null), false);
});
check("operator-paste contrast: a NO-SIGNAL bare page stays $0 in batch but WOULD escalate on assert", () => {
  const free = freeExtractFromPages([bareSchedule], META);
  // Batch sweep: no page signal → keep the $0 bare window (cost control across thousands).
  assert.equal(shouldEscalateForDroppedDeals(free, [bareSchedule]), false);
  // Operator pasted this exact URL asserting the HH is here → escalate regardless of signal.
  assert.equal(freeLacksOfferings(free), true);
});

// ── reconcileFreeDaysWithModelOfferings: free DAYS win, model supplies OFFERINGS ──────────
const off = (p: Partial<ExtractedOffering>): ExtractedOffering => ({
  kind: "food", category: "appetizer", name: null, priceCents: null, originalPriceCents: null,
  discountCents: null, discountPercent: null, description: null, conditions: null, sourceUrl: "https://x.com/hh", ...p,
});
const win = (p: Partial<ExtractedHappyHour>): ExtractedHappyHour => ({
  daysOfWeek: [2, 3, 4, 5], allDay: false, startTime: "16:00", endTime: "18:00", timeKnown: true,
  locationWithinVenue: "all", notes: null, sourceUrl: "https://x.com/hh", offerings: [], ...p,
});
const result = (windows: ExtractedHappyHour[], conf = 0.65): ExtractResult => ({
  happyHours: windows, confidence: conf, summary: "", venueType: null,
  usage: { inputTokens: 100, outputTokens: 50 }, costCents: 2, promptHash: "ph", model: "haiku",
});

// KEEP-ALL (2026-06-22): every model window survives; the free parse only snaps the day-set of a
// MATCHED window (identical time-bounds + shared day) for anti-flicker. Dropping a window pre-persist
// bypasses the realness gate (silent loss), so disjoint/all-day model windows are kept, not dropped.
check("reconcile: Rose Garden — matched window adopts free's stable days; distinct promos kept (own days)", () => {
  const free = result([win({ daysOfWeek: [2, 3, 4, 5], offerings: [] })], 1);
  const model = result([
    win({ daysOfWeek: [2, 4, 5, 7], offerings: [off({ name: "Flatbreads", description: "Half-off" }), off({ kind: "drink", category: "beer", description: "$3 off drinks", discountCents: 300 })] }),
    win({ daysOfWeek: [2], allDay: true, startTime: null, endTime: null, offerings: [] }), // Trouble Tuesdays all-day
    win({ daysOfWeek: [7], startTime: "16:00", endTime: "00:00", offerings: [] }), // Sunday Funday extended
  ]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 3, "matched window + 2 distinct promos all kept");
  const main = r.happyHours.find((w) => w.startTime === "16:00" && w.endTime === "18:00")!;
  assert.deepEqual(main.daysOfWeek, [2, 3, 4, 5], "matched window adopts the free parser's stable days");
  assert.equal(main.offerings.length, 2, "matched window keeps the model's deals");
  assert.ok(r.happyHours.some((w) => w.allDay && w.daysOfWeek.join() === "2"), "Trouble Tuesday all-day kept on its own day");
  assert.ok(r.happyHours.some((w) => w.daysOfWeek.join() === "7"), "Sunday Funday kept on its own day (not folded in)");
  assert.equal(r.costCents, 2, "carries the paid model's cost for the ledger");
});

check("reconcile: a model-only window on a disjoint day is KEPT (no silent loss), not dropped", () => {
  const free = result([win({ daysOfWeek: [1, 2, 3, 4, 5], offerings: [] })], 1);
  const model = result([
    win({ daysOfWeek: [1, 2, 3, 4, 5], offerings: [off({ name: "Wings", priceCents: 500 })] }), // matches free
    win({ daysOfWeek: [7], startTime: "16:00", endTime: "18:00", offerings: [off({ name: "Funday deal", priceCents: 900 })] }), // disjoint day → KEPT
  ]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 2, "both windows survive — the Sunday promo is no longer dropped");
  const wings = r.happyHours.find((w) => w.daysOfWeek.join() === "1,2,3,4,5")!;
  assert.equal(wings.offerings[0].name, "Wings", "Wings stays on the matched Mon-Fri window");
  assert.ok(r.happyHours.some((w) => w.daysOfWeek.join() === "7" && w.offerings[0]?.name === "Funday deal"), "Funday kept on Sunday");
});

check("reconcile: an all-day model special does NOT fold into a bounded window sharing a day", () => {
  // Yellow Belly Tap SB regression: Mon-Thu 4-6 free skeleton; the model adds the real PDF deals
  // PLUS Saturday all-day + Taco Tuesday + Wed burger. The all-day specials must stay separate (days
  // 2,3 fall inside Mon-Thu but the time-bounds differ), and the Saturday window must NOT be lost.
  const free = result([win({ daysOfWeek: [1, 2, 3, 4], startTime: "16:00", endTime: "18:00", offerings: [] })], 1);
  const model = result([
    win({ daysOfWeek: [1, 2, 3, 4], startTime: "16:00", endTime: "18:00", offerings: [
      off({ kind: "drink", category: "beer", name: "Beer", discountCents: 200 }),
      off({ kind: "drink", category: "wine", name: "Wine", discountCents: 200 }),
      off({ kind: "food", category: "other", name: "All pizzas", discountCents: 300 }),
      off({ kind: "food", category: "appetizer", name: "Pretzels, fries & soup", discountCents: 200 }),
    ] }),
    win({ daysOfWeek: [6], allDay: true, startTime: null, endTime: null, offerings: [off({ kind: "drink", category: "beer", name: "Beer cans", discountCents: 200 })] }),
    win({ daysOfWeek: [2], allDay: true, startTime: null, endTime: null, offerings: [off({ name: "Local Fish Tacos", discountCents: 400 })] }),
    win({ daysOfWeek: [3], allDay: true, startTime: null, endTime: null, offerings: [off({ category: "entree", name: "Burger and Beer Special", priceCents: 1500 })] }),
  ]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 4, "all four windows survive");
  const monThu = r.happyHours.find((w) => w.startTime === "16:00" && w.endTime === "18:00")!;
  assert.equal(monThu.offerings.length, 4, "Mon-Thu window has ONLY its 4 real HH deals");
  assert.ok(!monThu.offerings.some((o) => /burger|taco/i.test(o.name ?? "")), "no Tue/Wed special folded into Mon-Thu");
  assert.ok(r.happyHours.some((w) => w.daysOfWeek.join() === "6"), "Saturday all-day window is preserved, not dropped");
});

check("reconcile: distinct specific areas don't cross-pollinate; both the patio deal and the bare bar window survive", () => {
  const free = result([win({ locationWithinVenue: "bar", offerings: [] })], 1);
  const model = result([win({ locationWithinVenue: "patio", offerings: [off({ name: "Patio-only" })] })]);
  const r = reconcileFreeDaysWithModelOfferings(free, model);
  assert.equal(r.happyHours.length, 2, "patio window kept (real deal) AND the unmatched bare bar window kept");
  const patio = r.happyHours.find((w) => w.locationWithinVenue === "patio")!;
  assert.equal(patio.offerings[0].name, "Patio-only", "patio deal preserved");
  const bar = r.happyHours.find((w) => w.locationWithinVenue === "bar")!;
  assert.equal(bar.offerings.length, 0, "bar window stays bare (did not absorb patio deal)");
});

console.log(`\n${passed} checks passed.`);
