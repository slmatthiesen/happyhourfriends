/**
 * Runnable unit checks for the pure realness gate (no test framework in repo).
 * Run: npx tsx scripts/test-realness-gate.ts — exits non-zero on any failure.
 *
 * The gate NEVER drops data; it only decides whether a stored window is shown
 * (active) or hidden for review (suspect). See
 * docs/superpowers/specs/2026-05-31-capture-everything-realness-filter-design.md.
 */
import assert from "node:assert/strict";
import { assessRealness, MIN_CONFIDENCE } from "@/lib/places/realnessGate";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A normal, confident, bounded window (the Aunt Chiladas shape: Mon–Fri, open–6pm).
const GOOD = { allDay: false, dayCount: 5, timeKnown: true, confidence: 0.9 };

check("a bounded, confident window is NOT suspect (Aunt Chiladas)", () => {
  const r = assessRealness(GOOD);
  assert.equal(r.suspect, false);
  assert.deepEqual(r.reasons, []);
});

check("an open-until-X window (timeKnown via end) is NOT suspect", () => {
  // start null, end known → timeKnown true, allDay false
  const r = assessRealness({ allDay: false, dayCount: 5, timeKnown: true, confidence: 0.8 });
  assert.equal(r.suspect, false);
});

check("explicit all-day on 1 day is NOT suspect", () => {
  const r = assessRealness({ allDay: true, dayCount: 1, timeKnown: true, confidence: 0.9 });
  assert.equal(r.suspect, false);
});

check("explicit all-day on 2 days is NOT suspect", () => {
  const r = assessRealness({ allDay: true, dayCount: 2, timeKnown: true, confidence: 0.9 });
  assert.equal(r.suspect, false);
});

check("all-day on 3 days IS suspect (likely regular pricing)", () => {
  const r = assessRealness({ allDay: true, dayCount: 3, timeKnown: true, confidence: 0.9 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("all_day_many_days"));
});

check("all-day every day (7) IS suspect", () => {
  const r = assessRealness({ allDay: true, dayCount: 7, timeKnown: true, confidence: 0.95 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("all_day_many_days"));
});

check("no time info at all IS suspect (no_time_window)", () => {
  // coerced all-day with timeKnown false
  const r = assessRealness({ allDay: true, dayCount: 2, timeKnown: false, confidence: 0.9 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("no_time_window"));
});

check("low confidence IS suspect even for a clean window", () => {
  const r = assessRealness({ ...GOOD, confidence: MIN_CONFIDENCE - 0.01 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("low_confidence"));
});

check("confidence exactly at the threshold is NOT low_confidence", () => {
  const r = assessRealness({ ...GOOD, confidence: MIN_CONFIDENCE });
  assert.equal(r.reasons.includes("low_confidence"), false);
});

check("multiple signals accumulate distinct reasons", () => {
  const r = assessRealness({ allDay: true, dayCount: 7, timeKnown: false, confidence: 0.1 });
  assert.equal(r.suspect, true);
  assert.ok(r.reasons.includes("all_day_many_days"));
  assert.ok(r.reasons.includes("no_time_window"));
  assert.ok(r.reasons.includes("low_confidence"));
});

console.log(`\n${passed} checks passed.`);
