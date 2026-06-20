/**
 * test-new-happy-hour-dedup — the `new_happy_hour` apply path must be dedup-aware so a
 * submission that duplicates an existing window never crashes on happy_hours_natural_uq
 * (the natural unique key is venue_id+days_of_week+start_time+end_time+location).
 *
 * Two pure planners decide the write before any DB mutation:
 *   - planNewHappyHour(proposed, existing[]) → insert | attach(resurrect?)
 *   - newOfferingsToInsert(proposed[], existing[]) → the non-duplicate subset
 *
 * Run: pnpm tsx scripts/test-new-happy-hour-dedup.ts  (exits non-zero on any failure)
 */
import assert from "node:assert/strict";
import {
  planNewHappyHour,
  newOfferingsToInsert,
} from "@/lib/apply/newHappyHour";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ── planNewHappyHour ────────────────────────────────────────────────────────────
check("no existing windows → insert", () => {
  const plan = planNewHappyHour(
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00", endTime: "17:30" },
    [],
  );
  assert.deepEqual(plan, { mode: "insert" });
});

check("identical LIVE window → attach without resurrect (the crashing case)", () => {
  const plan = planNewHappyHour(
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00", endTime: "17:30" },
    [
      {
        id: "live-row",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "15:00:00",
        endTime: "17:30:00",
        locationWithinVenue: "all",
        deletedAt: null,
      },
    ],
  );
  assert.deepEqual(plan, {
    mode: "attach",
    happyHourId: "live-row",
    resurrect: false,
  });
});

check("identical SOFT-DELETED window → attach with resurrect", () => {
  const plan = planNewHappyHour(
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00", endTime: "17:30" },
    [
      {
        id: "dead-row",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "15:00:00",
        endTime: "17:30:00",
        locationWithinVenue: "all",
        deletedAt: new Date("2026-06-20T00:00:00Z"),
      },
    ],
  );
  assert.deepEqual(plan, {
    mode: "attach",
    happyHourId: "dead-row",
    resurrect: true,
  });
});

check("day-order differences still match (natural key is sorted)", () => {
  const plan = planNewHappyHour(
    { daysOfWeek: [5, 1, 3, 2, 4], startTime: "15:00", endTime: "17:30" },
    [
      {
        id: "live-row",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "15:00:00",
        endTime: "17:30:00",
        locationWithinVenue: "all",
        deletedAt: null,
      },
    ],
  );
  assert.equal(plan.mode, "attach");
});

check("different end_time is a distinct window → insert", () => {
  const plan = planNewHappyHour(
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00", endTime: "18:00" },
    [
      {
        id: "live-row",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "15:00:00",
        endTime: "17:30:00",
        locationWithinVenue: "all",
        deletedAt: null,
      },
    ],
  );
  assert.deepEqual(plan, { mode: "insert" });
});

check("until-close (null end) matches an existing null-end window", () => {
  const plan = planNewHappyHour(
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00", endTime: null },
    [
      {
        id: "live-row",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "15:00:00",
        endTime: null,
        locationWithinVenue: "all",
        deletedAt: null,
      },
    ],
  );
  assert.equal(plan.mode, "attach");
});

check("a null end does NOT match a fixed-end window", () => {
  const plan = planNewHappyHour(
    { daysOfWeek: [1, 2, 3, 4, 5], startTime: "15:00", endTime: null },
    [
      {
        id: "live-row",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "15:00:00",
        endTime: "17:30:00",
        locationWithinVenue: "all",
        deletedAt: null,
      },
    ],
  );
  assert.deepEqual(plan, { mode: "insert" });
});

check("different location_within_venue is a distinct window → insert", () => {
  const plan = planNewHappyHour(
    {
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: "15:00",
      endTime: "17:30",
      locationWithinVenue: "patio",
    },
    [
      {
        id: "live-row",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "15:00:00",
        endTime: "17:30:00",
        locationWithinVenue: "all",
        deletedAt: null,
      },
    ],
  );
  assert.deepEqual(plan, { mode: "insert" });
});

// ── newOfferingsToInsert ────────────────────────────────────────────────────────
check("no existing offerings → all proposed kept", () => {
  const out = newOfferingsToInsert(
    [{ kind: "drink", category: "beer", name: "Drafts", priceCents: 400 }],
    [],
  );
  assert.equal(out.length, 1);
});

check("an offering already present on the window is dropped", () => {
  const out = newOfferingsToInsert(
    [
      { kind: "drink", category: "beer", name: "Drafts", priceCents: 400 },
      { kind: "food", category: "app", name: "Wings", priceCents: 600 },
    ],
    [{ kind: "drink", category: "beer", name: "Drafts", priceCents: 400 }],
  );
  assert.deepEqual(out.map((o) => o.name), ["Wings"]);
});

check("proposed list is de-duplicated against itself", () => {
  const out = newOfferingsToInsert(
    [
      { kind: "drink", category: "beer", name: "Drafts", priceCents: 400 },
      { kind: "drink", category: "beer", name: "drafts", priceCents: 400 },
    ],
    [],
  );
  assert.equal(out.length, 1);
});

console.log(`\n${passed} checks passed.`);
