/**
 * Runnable unit checks for the pure window-reconcile gate (no test framework in repo).
 * Run: npx tsx scripts/test-window-reconcile.ts — exits non-zero on any failure.
 * The gate NEVER drops data; it merges duplicate windows or flips active=false.
 * See docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md.
 */
import assert from "node:assert/strict";
import {
  durationMin,
  mergeDuplicates,
  isOperatingHours,
  windowsOverlap,
  reconcileWindows,
  offeringsFingerprint,
  type ReconcileWindow,
} from "@/lib/places/windowReconcile";
import type { OpenPeriod } from "@/lib/geo/timezone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function w(daysOfWeek: number[], startTime: string | null, endTime: string | null, allDay = false): ReconcileWindow {
  return { daysOfWeek, startTime, endTime, allDay };
}

check("durationMin: same-day bounded", () => {
  assert.equal(durationMin(w([1], "14:00:00", "17:00:00")), 180);
});
check("durationMin: crosses midnight (end < start)", () => {
  // 11:00 → 00:00 is 13h
  assert.equal(durationMin(w([1], "11:00:00", "00:00:00")), 780);
});
check("durationMin: null start or end → null", () => {
  assert.equal(durationMin(w([1], "20:00:00", null)), null);
  assert.equal(durationMin(w([1], null, "17:00:00")), null);
});
check("durationMin: parses HH:MM (no seconds) same as HH:MM:SS", () => {
  assert.equal(durationMin(w([1], "14:00", "17:00")), 180);
});
check("op-hours: coverage ≥80% on only 1 of 2 days is NOT a majority (strict >50%)", () => {
  // 5h window (15:00–20:00, start>11:00 so business-day rule N/A, <8h so backstop N/A).
  // Mon open 15:00–20:00 → window covers 100% (match); Tue open 12:00–23:00 → 45% (no match).
  const hours = [
    { openDay: 1, openMin: 900, closeDay: 1, closeMin: 1200 },
    { openDay: 2, openMin: 720, closeDay: 2, closeMin: 1380 },
  ];
  assert.equal(isOperatingHours(w([1, 2], "15:00:00", "20:00:00"), hours), false);
});

check("mergeDuplicates: identical times across days union into one window", () => {
  const merged = mergeDuplicates([
    w([1], "15:00:00", "18:00:00"),
    w([2], "15:00:00", "18:00:00"),
    w([1, 2, 3, 4, 5], "15:00:00", "18:00:00"),
    w([6], "15:00:00", "18:00:00"),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].window.daysOfWeek, [1, 2, 3, 4, 5, 6]);
  assert.ok(merged[0].reasons.includes("merged_duplicate"));
  assert.equal(merged[0].active, true);
});

check("mergeDuplicates: different times stay separate, no merged_duplicate reason", () => {
  const merged = mergeDuplicates([
    w([1, 2, 3, 4, 5], "15:00:00", "18:00:00"),
    w([1, 2, 3, 4, 5], "08:00:00", "23:00:00"),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].reasons.includes("merged_duplicate"), false);
});

check("mergeDuplicates: allDay is part of the key (not merged with bounded)", () => {
  const merged = mergeDuplicates([
    w([1], "15:00:00", "21:00:00", true),
    w([2, 3, 4, 5], "15:00:00", "21:00:00", false),
  ]);
  assert.equal(merged.length, 2);
});

check("mergeDuplicates: same times but DIFFERENT offerings stay separate (per-day specials)", () => {
  const merged = mergeDuplicates([
    { ...w([1], "11:00:00", "19:00:00"), offeringsKey: "moonshine|700" },
    { ...w([2], "11:00:00", "19:00:00"), offeringsKey: "tequila|500" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged.some((r) => r.reasons.includes("merged_duplicate")), false);
});

check("mergeDuplicates: same times AND same offerings union their days", () => {
  const merged = mergeDuplicates([
    { ...w([1], "16:00:00", "18:00:00"), offeringsKey: "wells|500" },
    { ...w([6, 7], "16:00:00", "18:00:00"), offeringsKey: "wells|500" },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].window.daysOfWeek, [1, 6, 7]);
});

check("mergeDuplicates: omitted offeringsKey keeps the times-only behavior", () => {
  const merged = mergeDuplicates([w([1], "16:00:00", "18:00:00"), w([2], "16:00:00", "18:00:00")]);
  assert.equal(merged.length, 1);
});

check("offeringsFingerprint: order-insensitive, case/whitespace-normalized", () => {
  const a = offeringsFingerprint([
    { name: "Wells", priceCents: 500 },
    { name: " Tacos ", priceCents: null },
  ]);
  const b = offeringsFingerprint([
    { name: "tacos", priceCents: null },
    { name: "wells", priceCents: 500 },
  ]);
  assert.equal(a, b);
});

check("op-hours: ≥8h window with no hours_json is operating-hours", () => {
  assert.equal(isOperatingHours(w([1, 2, 3, 4, 5], "08:00:00", "23:00:00"), null), true); // 15h
});
check("op-hours: 3h afternoon HH is NOT operating-hours", () => {
  assert.equal(isOperatingHours(w([1, 2, 3, 4, 5], "14:00:00", "17:00:00"), null), false);
});
check("op-hours: business-day span (start ≤11:00 & ≥6h) is operating-hours", () => {
  assert.equal(isOperatingHours(w([1], "09:00:00", "16:00:00"), null), true); // 7h, starts 09:00
});
check("op-hours: 6h afternoon HH (start >11:00) is NOT operating-hours (Garland Mon if bounded)", () => {
  assert.equal(isOperatingHours(w([1], "15:00:00", "21:00:00"), null), false); // 6h but starts 15:00
});
check("op-hours: allDay windows are EXEMPT", () => {
  assert.equal(isOperatingHours(w([1], "15:00:00", "21:00:00", true), null), false);
});
check("op-hours: hours_json ≥80% coverage is operating-hours", () => {
  const hours: OpenPeriod[] = [{ openDay: 1, openMin: 600, closeDay: 1, closeMin: 1380 }]; // 10:00–23:00
  assert.equal(isOperatingHours(w([1], "10:00:00", "23:00:00"), hours), true); // covers 100%
});
check("op-hours: coverage is interval OVERLAP, not duration ratio (GOLDEN Fuego)", () => {
  // Fri 16:00–18:00 special; club open Fri 21:30–00:00 (2.5h). Duration ratio is 80%
  // but the windows don't even touch — NOT operating hours.
  const hours: OpenPeriod[] = [{ openDay: 5, openMin: 1290, closeDay: 6, closeMin: 0 }];
  assert.equal(isOperatingHours(w([5], "16:00:00", "18:00:00"), hours), false);
});
check("op-hours: usable hours_json is AUTHORITATIVE over the ≥8h backstop (GOLDEN Dirty Oscar's)", () => {
  // 8h daily-special window at a venue open 14h → 57% coverage → real deal, not op-hours.
  const hours: OpenPeriod[] = [{ openDay: 1, openMin: 600, closeDay: 2, closeMin: 0 }]; // 10:00–00:00
  assert.equal(isOperatingHours(w([1], "11:00:00", "19:00:00"), hours), false);
  // Same window with NO hours_json still trips the ≥8h backstop.
  assert.equal(isOperatingHours(w([1], "11:00:00", "19:00:00"), null), true);
});
check("op-hours: start-only window starting ≈ open time is operating-hours", () => {
  const hours: OpenPeriod[] = [{ openDay: 1, openMin: 660, closeDay: 1, closeMin: 1380 }]; // 11:00–23:00
  assert.equal(isOperatingHours(w([1], "11:00:00", null), hours), true); // start ≈ open, no end
});
check("op-hours: start-only window with no hours_json is NOT operating-hours", () => {
  assert.equal(isOperatingHours(w([1], "20:00:00", null), null), false);
});

check("overlap: same-day different-range windows overlap", () => {
  assert.equal(windowsOverlap(w([1, 2], "18:00:00", "20:00:00"), w([1], "19:00:00", "21:00:00")), true);
});
check("overlap: identical times are NOT an overlap-conflict (handled by merge)", () => {
  assert.equal(windowsOverlap(w([1], "15:00:00", "18:00:00"), w([2], "15:00:00", "18:00:00")), false);
});
check("overlap: no shared day → no overlap", () => {
  assert.equal(windowsOverlap(w([1], "18:00:00", "20:00:00"), w([2], "19:00:00", "21:00:00")), false);
});
check("overlap: non-overlapping ranges on shared day → no overlap", () => {
  assert.equal(windowsOverlap(w([1], "12:00:00", "15:00:00"), w([1], "16:00:00", "21:00:00")), false);
});
check("overlap: start-only (until close) overlaps a later bounded window on shared day", () => {
  assert.equal(windowsOverlap(w([1], "11:00:00", null), w([1], "18:00:00", "20:00:00")), true);
});

function active(rs: ReturnType<typeof reconcileWindows>) {
  return rs.filter((r) => r.active);
}

check("GOLDEN Lantern: 3 operating-hours hidden, real 14–17 stays live", () => {
  const rs = reconcileWindows(
    [
      w([1, 2, 3, 4, 5, 6, 7], "10:00:00", "23:00:00"),
      w([1, 2, 3, 4, 5, 6, 7], "11:00:00", "23:00:00"),
      w([1, 2, 3, 4, 5, 6, 7], "11:00:00", "00:00:00"),
      w([1, 2, 3, 4, 5, 6, 7], "14:00:00", "17:00:00"),
    ],
    null,
  );
  const live = active(rs);
  assert.equal(live.length, 1);
  assert.equal(live[0].window.startTime, "14:00:00");
  assert.equal(rs.filter((r) => r.reasons.includes("operating_hours")).length, 3);
});

check("GOLDEN Swinging Doors: per-day frags merge to one 15–18, op-hours hidden", () => {
  const rs = reconcileWindows(
    [
      w([1], "15:00:00", "18:00:00"),
      w([2], "15:00:00", "18:00:00"),
      w([3], "15:00:00", "18:00:00"),
      w([4], "15:00:00", "18:00:00"),
      w([5], "15:00:00", "18:00:00"),
      w([6], "15:00:00", "18:00:00"),
      w([1, 2, 3, 4, 5], "15:00:00", "18:00:00"),
      w([1, 2, 3, 4, 5], "08:00:00", "23:00:00"),
      w([1, 2, 3, 4, 5], "08:00:00", "22:00:00"),
    ],
    null,
  );
  const live = active(rs);
  assert.equal(live.length, 1);
  assert.deepEqual(live[0].window.daysOfWeek, [1, 2, 3, 4, 5, 6]);
  assert.equal(live[0].window.startTime, "15:00:00");
  assert.equal(live[0].window.endTime, "18:00:00");
});

check("GOLDEN Bigfoot: all overlapping/start-only windows hidden → stub", () => {
  const rs = reconcileWindows(
    [
      w([1, 2, 3, 4, 5, 6, 7], "18:00:00", "20:00:00"),
      w([1, 2, 3, 4, 5, 6, 7], "19:00:00", "21:00:00"),
      w([1, 2, 3, 4, 5, 6, 7], "19:00:00", "22:00:00"),
      w([1, 2, 3, 4, 5, 6, 7], "11:00:00", null),
      w([1, 2, 3, 4, 5, 6, 7], "20:00:00", null),
      w([1, 2, 3, 4, 5, 6, 7], "21:00:00", null),
    ],
    null,
  );
  assert.equal(active(rs).length, 0);
});

check("GOLDEN Elks Temple: Mon–Fri base HH + same-time per-day specials all stay live, unmerged", () => {
  const hours: OpenPeriod[] = [1, 2, 3, 4, 5].map((d) => ({ openDay: d, openMin: 420, closeDay: d, closeMin: 1380 }));
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5], "14:00:00", "17:00:00"), offeringsKey: "base-hh-menu" },
      { ...w([1], "14:00:00", "17:00:00"), offeringsKey: "mule monday|1000" },
      { ...w([2], "14:00:00", "17:00:00"), offeringsKey: "la paloma|875" },
      { ...w([3], "14:00:00", "17:00:00"), offeringsKey: "old fashioned|950" },
    ],
    hours,
  );
  assert.equal(rs.length, 4); // no merge — distinct deals
  assert.equal(active(rs).length, 4); // identical times never overlap-conflict
});

check("GOLDEN Garland: all-day Monday + Tue–Fri 3–5 both live (no conflict)", () => {
  const rs = reconcileWindows(
    [
      w([1], "15:00:00", "21:00:00", true), // All Day Monday (3–9)
      w([2, 3, 4, 5], "15:00:00", "17:00:00"),
    ],
    null,
  );
  assert.equal(active(rs).length, 2);
});

console.log(`\n${passed} checks passed.`);
