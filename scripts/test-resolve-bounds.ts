/**
 * Unit checks for resolveBoundsForDay. Run: npx tsx scripts/test-resolve-bounds.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  resolveBoundsForDay,
  type HappyHourWindow,
  type OpenPeriod,
} from "@/lib/geo/timezone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Mon–Thu 11:00–22:00, Fri 11:00–02:00(next day).
const monThu: OpenPeriod[] = [
  { openDay: 1, openMin: 11 * 60, closeDay: 1, closeMin: 22 * 60 },
];
const friLate: OpenPeriod[] = [
  { openDay: 5, openMin: 11 * 60, closeDay: 6, closeMin: 2 * 60 },
];

const untilClose: HappyHourWindow = {
  daysOfWeek: [1, 2, 3, 4, 5], allDay: false, startTime: "15:00", endTime: null,
};
check("until-close resolves end to that day's close", () =>
  assert.deepEqual(resolveBoundsForDay(untilClose, monThu, 1), {
    startTime: "15:00", endTime: "22:00",
  }));
check("until-close resolves cross-midnight close to clock time", () =>
  assert.deepEqual(resolveBoundsForDay(untilClose, friLate, 5), {
    startTime: "15:00", endTime: "02:00",
  }));

const allDay: HappyHourWindow = {
  daysOfWeek: [1], allDay: true, startTime: null, endTime: null,
};
check("all-day resolves to open–close", () =>
  assert.deepEqual(resolveBoundsForDay(allDay, monThu, 1), {
    startTime: "11:00", endTime: "22:00",
  }));

const openUntilX: HappyHourWindow = {
  daysOfWeek: [1], allDay: false, startTime: null, endTime: "18:00",
};
check("open-until-X resolves start to that day's open", () =>
  assert.deepEqual(resolveBoundsForDay(openUntilX, monThu, 1), {
    startTime: "11:00", endTime: "18:00",
  }));

const bounded: HappyHourWindow = {
  daysOfWeek: [1], allDay: false, startTime: "16:00", endTime: "18:00",
};
check("bounded window returns null (nothing to resolve)", () =>
  assert.equal(resolveBoundsForDay(bounded, monThu, 1), null));

check("null when hours absent", () =>
  assert.equal(resolveBoundsForDay(untilClose, null, 1), null));
check("null when no period that day", () =>
  assert.equal(resolveBoundsForDay(untilClose, monThu, 7), null));

// Unpublished close (Google 24h) → closeMin null → cannot resolve a close.
const noClose: OpenPeriod[] = [{ openDay: 1, openMin: 11 * 60, closeDay: null, closeMin: null }];
check("null when that day's close is unpublished", () =>
  assert.equal(resolveBoundsForDay(untilClose, noClose, 1), null));

// Split hours: lunch 11–14, dinner 17–23 → earliest open 11:00, latest close 23:00.
const split: OpenPeriod[] = [
  { openDay: 3, openMin: 11 * 60, closeDay: 3, closeMin: 14 * 60 },
  { openDay: 3, openMin: 17 * 60, closeDay: 3, closeMin: 23 * 60 },
];
check("split hours use earliest open + latest close", () =>
  assert.deepEqual(resolveBoundsForDay(allDay, split, 3), {
    startTime: "11:00", endTime: "23:00",
  }));

console.log(`\n${passed} checks passed.`);
