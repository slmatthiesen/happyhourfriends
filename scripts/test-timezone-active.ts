/**
 * Unit checks for hours-aware isWindowActive. Run: npx tsx scripts/test-timezone-active.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  isWindowActive,
  type HappyHourWindow,
  type OpenPeriod,
  type VenueLocalNow,
} from "@/lib/geo/timezone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Helper: build a VenueLocalNow for an ISO day + "HH:MM".
function at(dayOfWeek: number, hhmm: string): VenueLocalNow {
  const [h, m] = hhmm.split(":").map(Number);
  return { dayOfWeek, minutes: h * 60 + m, hhmm };
}

const monOpen: OpenPeriod[] = [{ openDay: 1, openMin: 11 * 60, closeDay: 1, closeMin: 22 * 60 }];

const allDayMon: HappyHourWindow = { daysOfWeek: [1], allDay: true, startTime: null, endTime: null };
check("all-day active during open hours", () =>
  assert.equal(isWindowActive(allDayMon, at(1, "15:00"), monOpen), true));
check("all-day NOT active after close", () =>
  assert.equal(isWindowActive(allDayMon, at(1, "23:00"), monOpen), false));
check("all-day NOT active before open", () =>
  assert.equal(isWindowActive(allDayMon, at(1, "09:00"), monOpen), false));
check("all-day NOT active when hours unknown", () =>
  assert.equal(isWindowActive(allDayMon, at(1, "15:00"), undefined), false));
check("all-day NOT active on a non-listed day", () =>
  assert.equal(isWindowActive(allDayMon, at(2, "15:00"), monOpen), false));

const untilCloseFri: HappyHourWindow = {
  daysOfWeek: [5], allDay: false, startTime: "16:00", endTime: null,
};
const friOpen: OpenPeriod[] = [{ openDay: 5, openMin: 11 * 60, closeDay: 5, closeMin: 23 * 60 }];
check("until-close active after start while open", () =>
  assert.equal(isWindowActive(untilCloseFri, at(5, "18:00"), friOpen), true));
check("until-close NOT active before start", () =>
  assert.equal(isWindowActive(untilCloseFri, at(5, "12:00"), friOpen), false));
check("until-close NOT active after close", () =>
  assert.equal(isWindowActive(untilCloseFri, at(5, "23:30"), friOpen), false));
check("until-close NOT active when hours unknown", () =>
  assert.equal(isWindowActive(untilCloseFri, at(5, "18:00"), undefined), false));

const bounded: HappyHourWindow = {
  daysOfWeek: [1], allDay: false, startTime: "16:00", endTime: "18:00",
};
check("bounded window active inside, no hours needed", () =>
  assert.equal(isWindowActive(bounded, at(1, "17:00")), true));
check("bounded window not active outside, no hours needed", () =>
  assert.equal(isWindowActive(bounded, at(1, "19:00")), false));

console.log(`\n${passed} checks passed.`);
