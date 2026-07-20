/**
 * Golden tests for lib/geo/timezone/nextWindowStart — the "when does happy hour next
 * start" math behind the venue-page live line. now is built directly in venue-local terms
 * (no tz/Date needed). Pure logic, runs in CI.
 */
import assert from "node:assert/strict";
import {
  nextWindowStart,
  type HappyHourWindow,
  type OpenPeriod,
  type VenueLocalNow,
} from "@/lib/geo/timezone";

let passed = 0;
function check(name: string) {
  passed++;
  console.log(`  ✓ ${name}`);
}

const now = (dayOfWeek: number, minutes: number): VenueLocalNow => ({
  dayOfWeek,
  minutes,
  hhmm: "",
});
const win = (
  days: number[],
  start: string | null,
  end: string | null,
  extra: Partial<HappyHourWindow> = {},
): HappyHourWindow => ({ daysOfWeek: days, allDay: false, startTime: start, endTime: end, ...extra });

const MONFRI_4_6 = win([1, 2, 3, 4, 5], "16:00", "18:00");

// Later today (before start).
assert.deepEqual(nextWindowStart([MONFRI_4_6], now(1, 14 * 60)), {
  dayOffset: 0,
  isoDay: 1,
  startTime: "16:00",
});
check("Mon 2pm → starts today 16:00");

// Passed today → tomorrow.
assert.deepEqual(nextWindowStart([MONFRI_4_6], now(1, 20 * 60)), {
  dayOffset: 1,
  isoDay: 2,
  startTime: "16:00",
});
check("Mon 8pm (passed) → starts tomorrow (Tue) 16:00");

// Weekend gap → next Monday (offset 2 from Saturday).
assert.deepEqual(nextWindowStart([MONFRI_4_6], now(6, 14 * 60)), {
  dayOffset: 2,
  isoDay: 1,
  startTime: "16:00",
});
check("Sat → skips Sun, starts Mon 16:00");

// Earliest of two same-day windows wins.
assert.deepEqual(
  nextWindowStart([win([1], "17:00", "19:00"), win([1], "15:00", "16:00")], now(1, 12 * 60)),
  { dayOffset: 0, isoDay: 1, startTime: "15:00" },
);
check("two Monday windows → picks the earlier 15:00");

// Cross-midnight window: start is its start clock time.
assert.deepEqual(
  nextWindowStart([win([5], "21:00", "02:00", { crossesMidnight: true })], now(5, 10 * 60)),
  { dayOffset: 0, isoDay: 5, startTime: "21:00" },
);
check("Fri 10am → cross-midnight window starts today 21:00");

// All-day window with NO hours → unresolvable → null.
assert.equal(
  nextWindowStart([win([1, 2, 3, 4, 5, 6, 7], null, null, { allDay: true })], now(1, 10 * 60), null),
  null,
);
check("all-day, no hours → null (never guess an open time)");

// All-day window WITH hours → starts at venue open.
const monOpen11: OpenPeriod[] = [{ openDay: 1, openMin: 11 * 60, closeDay: 1, closeMin: 22 * 60 }];
assert.deepEqual(
  nextWindowStart([win([1], null, null, { allDay: true })], now(1, 9 * 60), monOpen11),
  { dayOffset: 0, isoDay: 1, startTime: "11:00" },
);
check("all-day + hours → starts at venue open 11:00");

// No windows → null.
assert.equal(nextWindowStart([], now(1, 10 * 60)), null);
check("no windows → null");

console.log(`\n${passed} checks passed`);
