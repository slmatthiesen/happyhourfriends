/**
 * Runnable unit checks for lib/recover/hiddenReview (no test framework in repo).
 * Run: pnpm tsx scripts/test-hidden-review.ts — exits non-zero on any failure.
 *
 * Goldens come from the 2026-06-11 weak-city investigation: gate-hidden windows on
 * stub venues in Daly City / Five Cities / Oakland, where a few HH-shaped windows
 * (Super Duper 4–6pm, Quarterdeck 3–5pm) sat hidden among op-hours over-captures.
 */
import assert from "node:assert/strict";
import { durationHours, isHhShaped, suggestAction } from "@/lib/recover/hiddenReview";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const timed = (startTime: string | null, endTime: string | null) => ({
  startTime,
  endTime,
  allDay: false,
  timeKnown: true,
});

check("durationHours: plain afternoon window", () => {
  assert.equal(durationHours("16:00:00", "18:00:00"), 2);
});
check("durationHours: crosses midnight", () => {
  assert.equal(durationHours("22:00:00", "01:00:00"), 3);
});
check("durationHours: null end (until close) → null", () => {
  assert.equal(durationHours("16:00:00", null), null);
});

check("promotes Super Duper-shaped window (Mon–Fri 16:00–18:00)", () => {
  assert.equal(suggestAction(timed("16:00:00", "18:00:00")), "promote");
});
check("promotes Quarterdeck-shaped window (15:00–17:00)", () => {
  assert.equal(suggestAction(timed("15:00:00", "17:00:00")), "promote");
});
check("keeps op-hours span hidden (11:30–22:00, 10.5h)", () => {
  assert.equal(suggestAction(timed("11:30:00", "22:00:00")), "keep_hidden");
});
check("keeps morning span hidden (08:00–17:00 — Sidewalk Café office hours)", () => {
  assert.equal(suggestAction(timed("08:00:00", "17:00:00")), "keep_hidden");
});
check("keeps all-day hidden even when short-looking", () => {
  assert.equal(suggestAction({ startTime: null, endTime: null, allDay: true, timeKnown: false }), "keep_hidden");
});
check("keeps unknown-time hidden (Splash Café day-specials, no time)", () => {
  assert.equal(suggestAction({ startTime: null, endTime: null, allDay: false, timeKnown: false }), "keep_hidden");
});
check("keeps until-close hidden (no stated end)", () => {
  assert.equal(isHhShaped(timed("16:00:00", null)), false);
});

console.log(`\n${passed} checks passed.`);
