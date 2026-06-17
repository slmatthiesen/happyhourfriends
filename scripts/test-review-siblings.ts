/**
 * test-review-siblings — guards buildSiblingWindows, the "what survives if I delete this"
 * context on /admin/reviews rows. Run: pnpm tsx scripts/test-review-siblings.ts
 * (exits non-zero on any failure). Hermetic — no DB.
 */
import assert from "node:assert/strict";
import { buildSiblingWindows, type VenueWindowRow } from "@/lib/recover/reviewQueues";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const win = (over: Partial<VenueWindowRow>): VenueWindowRow => ({
  happyHourId: "x",
  venueId: "v1",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "16:30:00",
  endTime: "18:00:00",
  allDay: false,
  active: true,
  createdAt: "2026-06-15T00:00:00.000Z",
  sourceUrl: "https://example.com/hh",
  offeringNames: ["Wine $6", "Beer $4"],
  ...over,
});

const reviewed = { happyHourId: "old", createdAt: "2026-06-15T00:00:00.000Z" };

check("excludes the reviewed window itself", () => {
  const s = buildSiblingWindows(reviewed, [win({ happyHourId: "old" }), win({ happyHourId: "new" })]);
  assert.equal(s.length, 1);
  assert.equal(s[0].happyHourId, "new");
});

check("flags a window created after the reviewed one as newer", () => {
  const s = buildSiblingWindows(reviewed, [
    win({ happyHourId: "fresh", createdAt: "2026-06-17T00:00:00.000Z" }),
    win({ happyHourId: "stale", createdAt: "2026-06-10T00:00:00.000Z" }),
  ]);
  assert.equal(s.find((w) => w.happyHourId === "fresh")?.newer, true);
  assert.equal(s.find((w) => w.happyHourId === "stale")?.newer, false);
});

check("sorts live before hidden, then newer, then richer", () => {
  const s = buildSiblingWindows(reviewed, [
    win({ happyHourId: "hidden", active: false, createdAt: "2026-06-18T00:00:00.000Z" }),
    win({ happyHourId: "live-old", active: true, createdAt: "2026-06-12T00:00:00.000Z" }),
    win({ happyHourId: "live-new", active: true, createdAt: "2026-06-17T00:00:00.000Z" }),
  ]);
  assert.deepEqual(s.map((w) => w.happyHourId), ["live-new", "live-old", "hidden"]);
});

check("counts offerings and keeps up to 3 names", () => {
  const s = buildSiblingWindows(reviewed, [
    win({ happyHourId: "rich", offeringNames: ["a", "b", "c", "d", "e"] }),
  ]);
  assert.equal(s[0].offeringCount, 5);
  assert.deepEqual(s[0].topOfferings, ["a", "b", "c"]);
});

check("returns empty when the venue has no other windows (delete = orphan)", () => {
  assert.deepEqual(buildSiblingWindows(reviewed, [win({ happyHourId: "old" })]), []);
});

check("a sibling with the SAME created_at is not newer (same extraction batch)", () => {
  const s = buildSiblingWindows(reviewed, [win({ happyHourId: "twin", createdAt: reviewed.createdAt })]);
  assert.equal(s[0].newer, false);
});

check("a missing reviewed created_at never marks siblings newer", () => {
  const s = buildSiblingWindows({ happyHourId: "old", createdAt: "" }, [win({ happyHourId: "x" })]);
  assert.equal(s[0].newer, false);
});

console.log(`\n${passed} checks passed.`);
