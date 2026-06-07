/**
 * test-hh-outcomes — readable, outcome-oriented suite for the FREE happy-hour parser.
 * Run: pnpm tsx scripts/test-hh-outcomes.ts  (exits non-zero on any failure)
 *
 * The parser works on a page's EXTRACTED TEXT (what stripHtml produces), not raw HTML —
 * so each case is the text a real venue page would yield. Cases are grouped by the THREE
 * outcomes that matter downstream:
 *
 *   CONFIRM  → a clean, believable window → written LIVE (venue promoted out of stub)
 *   REVIEW   → parses, but low-confidence → written HIDDEN (active=false, stays a stub)
 *   IGNORE   → no trustworthy window → nothing written (escalate to paid / stay stub)
 *
 * "live"/"review" map to ParsedWindow.confidence==="clean" plus the plausible flag;
 * the GROUP D cases prove the same mapping end-to-end through freeExtractFromPages, which
 * is what the persist layer actually writes (suspect=!plausible → active=false).
 */
import assert from "node:assert/strict";
import { parseHappyHours, type ParsedWindow } from "@/lib/places/parseHhText";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";

const URL = "https://example-venue.com/happy-hour";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const windows = (t: string): ParsedWindow[] => parseHappyHours(t, URL);
/** Windows that would be shown publicly (clean + plausible). */
const live = (t: string) => windows(t).filter((w) => w.confidence === "clean" && w.plausible);
/** Windows captured but hidden for operator review (clean + implausible). */
const review = (t: string) => windows(t).filter((w) => w.confidence === "clean" && !w.plausible);
/** Any clean window at all (i.e. something would be written). */
const anyClean = (t: string) => windows(t).some((w) => w.confidence === "clean");

// ───────────────────────────────────────────────────────────────────────────
// GROUP A — CONFIRM: real happy hours in many time formats → written LIVE
// ───────────────────────────────────────────────────────────────────────────

check("A1 '3pm-6pm' (compact meridiem) + 'daily' → live 15:00-18:00 all week", () => {
  const w = live("Happy Hour 3pm-6pm daily")[0];
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "18:00");
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5, 6, 7]);
});

check("A2 '3 p.m. to 6 p.m.' (spaced periods + 'to') Mon-Fri → live 15:00-18:00", () => {
  const w = live("Happy hour 3 p.m. to 6 p.m. Mon-Fri")[0];
  assert.ok(w, "expected a live window");
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "18:00");
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5]);
});

check("A3 bare '3-6' but with the literal 'happy hour' → confident → live 15:00-18:00", () => {
  const w = live("Happy hour 3-6 Mon-Fri")[0];
  assert.ok(w, "bare numbers are trusted when 'happy hour' is explicit");
  assert.equal(w.startTime, "15:00");
  assert.equal(w.endTime, "18:00");
});

check("A4 uppercase '4PM-7PM', no days stated → live 16:00-19:00, days assumed Mon-Fri", () => {
  const w = live("Happy Hour: 4PM-7PM")[0];
  assert.equal(w.startTime, "16:00");
  assert.equal(w.endTime, "19:00");
  assert.deepEqual(w.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.match(w.notes ?? "", /assumed Mon.Fri/i);
});

check("A5 '9pm to close' Thursday-Saturday → live 21:00-open-ended", () => {
  const w = live("Happy hour 9pm to close, Thursday-Saturday")[0];
  assert.equal(w.startTime, "21:00");
  assert.equal(w.endTime, null);
  assert.deepEqual(w.daysOfWeek, [4, 5, 6]);
});

check("A6 'Happy hour specials daily 4pm-6pm' (literal phrase present) → live", () => {
  const w = live("Happy hour specials daily 4pm-6pm")[0];
  assert.ok(w, "the literal 'happy hour' next to the time makes it live");
  assert.equal(w.startTime, "16:00");
  assert.equal(w.endTime, "18:00");
});

check("A7 cross-midnight '11pm-1am Fri & Sat' → live 23:00-01:00 [Fri,Sat]", () => {
  const w = live("Happy hour 11pm-1am Fri & Sat")[0];
  assert.equal(w.startTime, "23:00");
  assert.equal(w.endTime, "01:00");
  assert.deepEqual(w.daysOfWeek, [5, 6]);
});

// ───────────────────────────────────────────────────────────────────────────
// GROUP B — FLAG FOR REVIEW: parses but low-confidence → HIDDEN, venue stays stub
// (review window present AND nothing goes live)
// ───────────────────────────────────────────────────────────────────────────

check("B1 bare '3-6' with only a deal word (no 'happy hour', no am/pm) → review, not live", () => {
  assert.equal(review("Daily specials 3-6").length >= 1, true);
  assert.equal(live("Daily specials 3-6").length, 0);
});

check("B2 'happy hour 11am-9pm' (10h, business-hours shape) → review, not live", () => {
  assert.equal(review("Happy hour 11am-9pm daily").length, 1);
  assert.equal(live("Happy hour 11am-9pm daily").length, 0);
});

check("B3 'Specials 4-6pm' (deal word + pm but no 'happy hour' & days assumed) → review", () => {
  assert.equal(review("Specials 4-6pm").length, 1);
  assert.equal(live("Specials 4-6pm").length, 0);
});

check("B4 24h bare numbers 'Food specials 13-17' → review, not live", () => {
  assert.equal(review("Food specials 13-17").length >= 1, true);
  assert.equal(live("Food specials 13-17").length, 0);
});

// ───────────────────────────────────────────────────────────────────────────
// GROUP C — IGNORE: nothing trustworthy → no clean window written at all
// ───────────────────────────────────────────────────────────────────────────

check("C1 marketing copy, no time → ignored", () => {
  assert.equal(anyClean("We have the best happy hour in town!"), false);
});

check("C2 prices, not times ('$5-$8 wells') → ignored", () => {
  assert.equal(anyClean("Happy hour pricing: wells $5-$8, drafts $6"), false);
});

check("C3 plain operating hours, no happy-hour/deal context → ignored", () => {
  assert.equal(anyClean("Kitchen open 11am-9pm Monday-Friday"), false);
});

check("C4 year range '2018-2024' is not a time → ignored", () => {
  assert.equal(anyClean("Voted best happy hour 2018-2024"), false);
});

check("C5 'happy hour all day Sunday' (no time bound) → ignored", () => {
  assert.equal(anyClean("Happy hour all day Sunday"), false);
});

// ───────────────────────────────────────────────────────────────────────────
// GROUP D — END-TO-END: freeExtractFromPages is what the persist layer writes.
// live → a non-suspect window; review → suspect (active=false); ignore → null.
// ───────────────────────────────────────────────────────────────────────────

check("D1 a confirmed page → ExtractResult with a NON-suspect window ($0)", () => {
  const r = freeExtractFromPages([{ url: URL, text: "Happy Hour 3pm-6pm daily" }], {
    model: "deterministic-html-v1",
    promptHash: "test",
  });
  assert.ok(r, "expected a result");
  assert.equal(r!.costCents, 0);
  assert.equal(r!.happyHours.length, 1);
  assert.ok(!r!.happyHours[0].suspect, "confirmed window must be shown (not suspect)");
});

check("D2 a review-only page → result returned but window marked suspect (written hidden)", () => {
  const r = freeExtractFromPages([{ url: URL, text: "Happy hour 11am-9pm daily" }], {
    model: "deterministic-html-v1",
    promptHash: "test",
  });
  assert.ok(r, "review windows are still captured (hidden), not dropped");
  assert.equal(r!.happyHours.length, 1);
  assert.equal(r!.happyHours[0].suspect, true);
});

check("D3 an ignore page → null (nothing written, escalate/stay stub)", () => {
  const r = freeExtractFromPages([{ url: URL, text: "We have the best happy hour in town!" }], {
    model: "deterministic-html-v1",
    promptHash: "test",
  });
  assert.equal(r, null);
});

console.log(`\n${passed} checks passed.`);
