/**
 * Unit checks for formatWindowByDay. Run: npx tsx scripts/test-format-by-day.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { formatWindowByDay } from "@/lib/format";
import type { OpenPeriod } from "@/lib/geo/timezone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Mon–Thu close 22:00; Fri close midnight (next day).
const hours: OpenPeriod[] = [
  { openDay: 1, openMin: 11 * 60, closeDay: 1, closeMin: 22 * 60 },
  { openDay: 2, openMin: 11 * 60, closeDay: 2, closeMin: 22 * 60 },
  { openDay: 3, openMin: 11 * 60, closeDay: 3, closeMin: 22 * 60 },
  { openDay: 4, openMin: 11 * 60, closeDay: 4, closeMin: 22 * 60 },
  { openDay: 5, openMin: 11 * 60, closeDay: 6, closeMin: 0 },
];

const untilClose = {
  allDay: false, startTime: "15:00", endTime: null, daysOfWeek: [1, 2, 3, 4, 5],
};
check("varying close splits into per-close groups", () =>
  assert.deepEqual(formatWindowByDay(untilClose, hours), [
    { days: [1, 2, 3, 4], bounds: "3 PM – 10 PM" },
    { days: [5], bounds: "3 PM – 12 AM" },
  ]));

check("uniform close collapses to one group", () =>
  assert.deepEqual(
    formatWindowByDay(
      { allDay: false, startTime: "15:00", endTime: null, daysOfWeek: [1, 2, 3, 4] },
      hours,
    ),
    [{ days: [1, 2, 3, 4], bounds: "3 PM – 10 PM" }],
  ));

check("no hours → single fallback group with text bounds", () =>
  assert.deepEqual(formatWindowByDay(untilClose, null), [
    { days: [1, 2, 3, 4, 5], bounds: "3 PM – close" },
  ]));

check("all-day with hours resolves open–close", () =>
  assert.deepEqual(
    formatWindowByDay(
      { allDay: true, startTime: null, endTime: null, daysOfWeek: [1] },
      hours,
    ),
    [{ days: [1], bounds: "11 AM – 10 PM" }],
  ));

check("bounded window is unchanged across its days", () =>
  assert.deepEqual(
    formatWindowByDay(
      { allDay: false, startTime: "16:00", endTime: "18:00", daysOfWeek: [1, 2] },
      hours,
    ),
    [{ days: [1, 2], bounds: "4 PM – 6 PM" }],
  ));

console.log(`\n${passed} checks passed.`);
