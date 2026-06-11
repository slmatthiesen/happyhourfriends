/**
 * Runnable unit checks for lib/recover/hiddenReview (no test framework in repo).
 * Run: pnpm tsx scripts/test-hidden-review.ts — exits non-zero on any failure.
 *
 * Policy goldens (operator-set 2026-06-11): suggestions NEVER say "promote" — a
 * shape guess is not evidence (the original shape rule promoted Mason Bar's
 * "Dinner Served Daily 5:00pm–10:00pm" as a happy hour). "delete" only on hard
 * evidence the window is service hours: matches Google operating hours, or came
 * from a meal-menu page with zero offerings.
 */
import assert from "node:assert/strict";
import { durationHours, suggestAction, deleteEvidence } from "@/lib/recover/hiddenReview";
import type { OpenPeriod } from "@/lib/geo/timezone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const win = (over: Partial<Parameters<typeof suggestAction>[0]> = {}) => ({
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "16:00:00" as string | null,
  endTime: "18:00:00" as string | null,
  allDay: false,
  timeKnown: true,
  sourceUrl: "https://example.com/happy-hour" as string | null,
  offerings: 0,
  ...over,
});

/** Open 11:00–21:00 on the given ISO days. */
const open = (days: number[]): OpenPeriod[] =>
  days.map((d) => ({ openDay: d, openMin: 11 * 60, closeDay: d, closeMin: 21 * 60 }));

check("durationHours: plain afternoon window", () => {
  assert.equal(durationHours("16:00:00", "18:00:00"), 2);
});
check("durationHours: crosses midnight", () => {
  assert.equal(durationHours("22:00:00", "01:00:00"), 3);
});
check("durationHours: null end (until close) → null", () => {
  assert.equal(durationHours("16:00:00", null), null);
});

// NEVER promote — even a perfectly HH-shaped window is only a guess until verified.
check("HH-shaped window (Mon–Fri 16–18) is NOT promoted — keep_hidden", () => {
  assert.equal(suggestAction(win(), null), "keep_hidden");
});

check("window covering the venue's Google hours → delete (operating hours)", () => {
  const w = win({ startTime: "11:00:00", endTime: "21:00:00" });
  assert.equal(suggestAction(w, open([1, 2, 3, 4, 5])), "delete");
  assert.equal(deleteEvidence(w, open([1, 2, 3, 4, 5])), "matches venue operating hours");
});

check("Mason golden: dinner-menu page + 0 offerings → delete", () => {
  const w = win({
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startTime: "17:00:00",
    endTime: "22:00:00",
    sourceUrl: "https://www.masonbarag.com/menus/dinner/",
  });
  assert.equal(suggestAction(w, null), "delete");
  assert.equal(deleteEvidence(w, null), "meal-service menu page, no deals attached");
});

check("meal-menu page WITH offerings attached → keep_hidden (could be a real special)", () => {
  const w = win({ sourceUrl: "https://example.com/lunch-deals", offerings: 3 });
  assert.equal(suggestAction(w, null), "keep_hidden");
});

check("no hours_json, 9h span → delete (operating-hours duration heuristic)", () => {
  const w = win({ startTime: "11:00:00", endTime: "20:00:00" });
  assert.equal(suggestAction(w, null), "delete");
});

check("2h special at a venue open 10h does NOT match operating hours", () => {
  assert.equal(suggestAction(win(), open([1, 2, 3, 4, 5])), "keep_hidden");
});

check("all-day window → keep_hidden (governed by the all-day policy, not nuked)", () => {
  const w = win({ startTime: null, endTime: null, allDay: true, timeKnown: false });
  assert.equal(suggestAction(w, open([1, 2, 3, 4, 5])), "keep_hidden");
});

check("unknown-time day-special (Splash Café) → keep_hidden", () => {
  const w = win({ daysOfWeek: [2], startTime: null, endTime: null, timeKnown: false });
  assert.equal(suggestAction(w, null), "keep_hidden");
});

console.log(`\n${passed} checks passed.`);
