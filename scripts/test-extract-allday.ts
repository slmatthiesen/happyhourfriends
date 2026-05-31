/**
 * Runnable unit checks for the extractor's all-day policy backstop (no test framework
 * in repo). Run: npx tsx scripts/test-extract-allday.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { normaliseRawExtract } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const SRC = "https://example.com/happy-hour";
function allDayWindow(days: number[]) {
  return {
    happyHours: [
      { daysOfWeek: days, allDay: true, startTime: null, endTime: null, sourceUrl: SRC, offerings: [] },
    ],
    confidence: 0.9,
    summary: "x",
  };
}

check("all-day on 1 day is kept", () => {
  const r = normaliseRawExtract(allDayWindow([1]));
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].allDay, true);
});

check("all-day on 2 days is kept", () => {
  const r = normaliseRawExtract(allDayWindow([1, 2]));
  assert.equal(r.happyHours.length, 1);
});

check("all-day on 3 days is dropped", () => {
  const r = normaliseRawExtract(allDayWindow([1, 2, 3]));
  assert.equal(r.happyHours.length, 0);
});

check("all-day on all 7 days is dropped", () => {
  const r = normaliseRawExtract(allDayWindow([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(r.happyHours.length, 0);
});

check("a windowed (non-all-day) deal on 7 days is unaffected", () => {
  const r = normaliseRawExtract({
    happyHours: [
      { daysOfWeek: [1, 2, 3, 4, 5, 6, 7], allDay: false, startTime: "16:00", endTime: "18:00", sourceUrl: SRC, offerings: [] },
    ],
    confidence: 0.9,
    summary: "x",
  });
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].allDay, false);
});

console.log(`\n${passed} checks passed.`);
