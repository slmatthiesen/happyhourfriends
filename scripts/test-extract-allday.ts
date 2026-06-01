/**
 * Runnable unit checks for normaliseHappyHour's CAPTURE behavior (no test framework
 * in repo). Run: npx tsx scripts/test-extract-allday.ts — exits non-zero on failure.
 *
 * Policy (2026-05-31): the extractor stops THROWING AWAY good data. It keeps every
 * structurally-valid window (coercing shape where needed) and only drops on provenance
 * grounds (no sourceUrl / competitor source / no valid days). Realness (all-day-every-day,
 * no-time, low-confidence) is decided downstream by lib/places/realnessGate, not here.
 * See docs/superpowers/specs/2026-05-31-capture-everything-realness-filter-design.md.
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
function extract(hh: Record<string, unknown>) {
  return normaliseRawExtract({
    happyHours: [{ sourceUrl: SRC, offerings: [], ...hh }],
    confidence: 0.9,
    summary: "x",
  });
}

// ---- The data we used to throw away is now KEPT --------------------------------

check("open-until-X (start null, end set) is KEPT as a bounded window [Aunt Chiladas]", () => {
  const r = extract({ daysOfWeek: [1, 2, 3, 4, 5], allDay: false, startTime: null, endTime: "18:00" });
  assert.equal(r.happyHours.length, 1);
  const w = r.happyHours[0];
  assert.equal(w.allDay, false);
  assert.equal(w.startTime, null);
  assert.equal(w.endTime, "18:00");
  assert.equal(w.timeKnown, true);
});

check("a deal with NO time info is KEPT, coerced to all-day, timeKnown=false", () => {
  const r = extract({ daysOfWeek: [1], allDay: false, startTime: null, endTime: null });
  assert.equal(r.happyHours.length, 1);
  const w = r.happyHours[0];
  assert.equal(w.allDay, true);
  assert.equal(w.startTime, null);
  assert.equal(w.endTime, null);
  assert.equal(w.timeKnown, false);
});

check("all-day on 3 days is KEPT now (gate hides it, not the extractor)", () => {
  const r = extract({ daysOfWeek: [1, 2, 3], allDay: true, startTime: null, endTime: null });
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].allDay, true);
  assert.equal(r.happyHours[0].timeKnown, true);
});

check("all-day on all 7 days is KEPT now", () => {
  const r = extract({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], allDay: true, startTime: null, endTime: null });
  assert.equal(r.happyHours.length, 1);
});

check("all-day with stray times is KEPT, times nulled to satisfy DB shape", () => {
  const r = extract({ daysOfWeek: [1], allDay: true, startTime: "16:00", endTime: "18:00" });
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].allDay, true);
  assert.equal(r.happyHours[0].startTime, null);
  assert.equal(r.happyHours[0].endTime, null);
  assert.equal(r.happyHours[0].timeKnown, true);
});

// ---- Ordinary windows unchanged ------------------------------------------------

check("a normal bounded window is unchanged, timeKnown=true", () => {
  const r = extract({ daysOfWeek: [1, 2, 3, 4, 5], allDay: false, startTime: "16:00", endTime: "18:00" });
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].allDay, false);
  assert.equal(r.happyHours[0].startTime, "16:00");
  assert.equal(r.happyHours[0].timeKnown, true);
});

check("a 'until close' window (start set, end null) is unchanged, timeKnown=true", () => {
  const r = extract({ daysOfWeek: [5], allDay: false, startTime: "22:00", endTime: null });
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].startTime, "22:00");
  assert.equal(r.happyHours[0].endTime, null);
  assert.equal(r.happyHours[0].timeKnown, true);
});

// ---- Provenance drops STILL drop (these are §13 non-negotiables) ---------------

check("a window with no sourceUrl is dropped", () => {
  const r = normaliseRawExtract({
    happyHours: [{ daysOfWeek: [1], allDay: false, startTime: "16:00", endTime: "18:00", offerings: [] }],
    confidence: 0.9,
    summary: "x",
  });
  assert.equal(r.happyHours.length, 0);
});

check("a window from a denylisted competitor source is dropped", () => {
  const r = extract({ daysOfWeek: [1], startTime: "16:00", endTime: "18:00", sourceUrl: "https://ultimatehappyhours.com/x" });
  assert.equal(r.happyHours.length, 0);
});

check("a window with no valid days is dropped", () => {
  const r = extract({ daysOfWeek: [], allDay: false, startTime: "16:00", endTime: "18:00" });
  assert.equal(r.happyHours.length, 0);
});

console.log(`\n${passed} checks passed.`);
