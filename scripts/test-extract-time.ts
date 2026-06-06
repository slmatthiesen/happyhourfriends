/**
 * The extractor must coerce happy-hour times to DB-legal "HH:MM" strings (or null).
 * Regression: the model sometimes returns times as NUMBERS (e.g. "Fish Fry Friday 11AM-9PM"
 * → startTime 11, endTime 21), which crashed the postgres `time` bind and aborted a whole
 * batch persist. Run: tsx scripts/test-extract-time.ts
 */
import assert from "node:assert";
import { normaliseTime, normaliseRawExtract } from "@/lib/ai/extractHappyHours";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("normaliseTime: numeric hours → HH:MM strings", () => {
  assert.equal(normaliseTime(11), "11:00");
  assert.equal(normaliseTime(21), "21:00");
  assert.equal(normaliseTime(0), "00:00");
  assert.equal(normaliseTime(9), "09:00");
});

check("normaliseTime: already-good strings pass through (normalised)", () => {
  assert.equal(normaliseTime("15:30"), "15:30");
  assert.equal(normaliseTime("9:00"), "09:00");
  assert.equal(normaliseTime("09:00:00"), "09:00");
  assert.equal(normaliseTime("11"), "11:00");
});

check("normaliseTime: 12-hour clock strings", () => {
  assert.equal(normaliseTime("9pm"), "21:00");
  assert.equal(normaliseTime("11am"), "11:00");
  assert.equal(normaliseTime("11:30pm"), "23:30");
  assert.equal(normaliseTime("12am"), "00:00");
});

check("normaliseTime: invalid / empty → null", () => {
  assert.equal(normaliseTime(null), null);
  assert.equal(normaliseTime(undefined), null);
  assert.equal(normaliseTime(""), null);
  assert.equal(normaliseTime(24), null);
  assert.equal(normaliseTime("soon"), null);
  assert.equal(normaliseTime("25:99"), null);
});

check("normaliseRawExtract: numeric times (the Fat Willy's crash) → string times", () => {
  const out = normaliseRawExtract({
    happyHours: [
      {
        daysOfWeek: [5],
        allDay: false,
        startTime: 11 as unknown as string,
        endTime: 21 as unknown as string,
        notes: "Fish Fry Friday 11AM-9PM",
        sourceUrl: "https://fatwillysaz.com/menu.pdf",
        offerings: [],
      },
    ],
    confidence: 0.75,
  });
  assert.equal(out.happyHours.length, 1);
  assert.equal(typeof out.happyHours[0].startTime, "string");
  assert.equal(out.happyHours[0].startTime, "11:00");
  assert.equal(out.happyHours[0].endTime, "21:00");
  assert.equal(out.happyHours[0].allDay, false);
});

console.log(`\n${passed} checks passed.`);
