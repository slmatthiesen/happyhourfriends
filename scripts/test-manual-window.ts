/**
 * Hermetic unit checks for buildManualWindowInsert — the pure validation + row-shaping for
 * operator-entered happy hours (Component C, bot-walled venues). The operator entering data
 * IS the verification, so the window lands active=true (bypasses the realness gate). Run:
 * npx tsx scripts/test-manual-window.ts
 */
import assert from "node:assert/strict";
import { buildManualWindowInsert } from "@/lib/recover/manualWindow";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const base = {
  venueId: "11111111-1111-1111-1111-111111111111",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "15:00",
  endTime: "18:00",
  sourceUrl: "https://foo.com/happy-hour",
  offerings: [{ kind: "drink" as const, category: "beer" as const, name: "$5 drafts", priceCents: 500 }],
};

check("happy path: active=true, time_known=true, sorted days, source carried", () => {
  const { hhRow, offeringRows } = buildManualWindowInsert(base);
  assert.equal(hhRow.active, true);
  assert.equal(hhRow.timeKnown, true);
  assert.equal(hhRow.allDay, false);
  assert.deepEqual(hhRow.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(hhRow.sourceUrl, "https://foo.com/happy-hour");
  assert.equal(offeringRows.length, 1);
  assert.equal(offeringRows[0].sourceUrl, "https://foo.com/happy-hour");
});

check("days are de-duped and sorted", () => {
  const { hhRow } = buildManualWindowInsert({ ...base, daysOfWeek: [5, 1, 1, 3] });
  assert.deepEqual(hhRow.daysOfWeek, [1, 3, 5]);
});

check("until-close: endTime null is allowed (start set)", () => {
  const { hhRow } = buildManualWindowInsert({ ...base, endTime: null });
  assert.equal(hhRow.endTime, null);
  assert.equal(hhRow.startTime, "15:00");
});

check("rejects empty days", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, daysOfWeek: [] }), /at least one day/i));

check("rejects out-of-range ISO day", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, daysOfWeek: [0] }), /1..7/));

check("rejects a window with no time bound at all", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, startTime: null, endTime: null }), /time bound/i));

check("rejects a missing source url (must be first-party)", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, sourceUrl: "" }), /source/i));

console.log(`\n${passed} checks passed.`);
