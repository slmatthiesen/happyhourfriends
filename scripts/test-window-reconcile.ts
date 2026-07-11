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
  windowContains,
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

check("GOLDEN Lantern WITH offerings: op-hours windows carrying the real window's deals are copies → hidden", () => {
  const k = "old fashioned|800;wings|600;house red|700";
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6, 7], "10:00:00", "23:00:00"), offeringsKey: k },
      { ...w([1, 2, 3, 4, 5, 6, 7], "11:00:00", "23:00:00"), offeringsKey: k },
      { ...w([1, 2, 3, 4, 5, 6, 7], "14:00:00", "17:00:00"), offeringsKey: k },
    ],
    null,
  );
  const live = active(rs);
  assert.equal(live.length, 1);
  assert.equal(live[0].window.startTime, "14:00:00");
});

check("GOLDEN Twisted Fork: open-to-close windows with their OWN deal sets are all-day specials → live", () => {
  // Each day's window exactly equals that day's open hours, but each carries real
  // priced deals and no shorter window competes — operator verified on the site.
  const hours: OpenPeriod[] = [
    { openDay: 1, openMin: 840, closeDay: 1, closeMin: 1320 },
    { openDay: 2, openMin: 840, closeDay: 2, closeMin: 1380 },
    { openDay: 3, openMin: 840, closeDay: 3, closeMin: 1380 },
    { openDay: 4, openMin: 840, closeDay: 4, closeMin: 1380 },
    { openDay: 5, openMin: 840, closeDay: 5, closeMin: 1380 },
    { openDay: 6, openMin: 720, closeDay: 6, closeMin: 1380 },
    { openDay: 7, openMin: 720, closeDay: 7, closeMin: 1320 },
  ];
  const base = "house wine|500;mimosa|400;well drinks|600";
  const rs = reconcileWindows(
    [
      { ...w([1], "14:00:00", "22:00:00"), offeringsKey: `chili|;${base}` },
      { ...w([2], "14:00:00", "23:00:00"), offeringsKey: `taco tuesday|;${base}` },
      { ...w([3, 4, 5], "14:00:00", "23:00:00"), offeringsKey: base },
      { ...w([6], "12:00:00", "23:00:00"), offeringsKey: base },
      { ...w([7], "12:00:00", "22:00:00"), offeringsKey: base },
    ],
    hours,
  );
  assert.equal(active(rs).length, 5); // disjoint days, unique-per-venue deal sets → all live
});

check("GOLDEN Fondi: overlapping windows with DIFFERENT deals coexist (lunch menu + Pizza Per Due)", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6, 7], "11:00:00", "16:00:00"), offeringsKey: "lunch menu items|1250" },
      { ...w([1, 2, 3, 4, 5, 6, 7], "14:00:00", "17:00:00"), offeringsKey: "beverages|;pizza & salad combo|3400" },
    ],
    null,
  );
  assert.equal(active(rs).length, 2);
});

check("overlap-conflict: SAME deal set at overlapping times still conflicts (the 4–6 vs 4–7 capture)", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5], "16:00:00", "18:00:00"), offeringsKey: "wells|500" },
      { ...w([1, 2, 3, 4, 5], "16:00:00", "19:00:00"), offeringsKey: "wells|500" },
    ],
    null,
  );
  assert.equal(active(rs).length, 0);
  assert.ok(rs.every((r) => r.reasons.includes("overlap_conflict")));
});

check("overlap-conflict: a BARE window hides ALONE against a deal-carrying one (evidence asymmetry)", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6, 7], "18:00:00", "20:00:00"), offeringsKey: "coors bucket|2200" },
      { ...w([1, 2, 3, 4, 5, 6, 7], "19:00:00", "21:00:00"), offeringsKey: "" },
    ],
    null,
  );
  const live = active(rs);
  assert.equal(live.length, 1);
  assert.equal(live[0].window.startTime, "18:00:00");
});

check("GOLDEN Mr. An's: Tuesday EXTENDED happy hour (same deals, subset days) coexists with the base window", () => {
  // mrantucson.com/specials: HH Mon–Sat 4–7 + "TUESDAY EXTENDED HAPPY HOUR ... 4pm-8pm".
  const k = "wells|600;mules|800;sake bombs|850";
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6], "16:00:00", "19:00:00"), offeringsKey: k },
      { ...w([2], "16:00:00", "20:00:00"), offeringsKey: k },
    ],
    null,
  );
  assert.equal(active(rs).length, 2);
});

check("GOLDEN SunSet: real deal window survives a bare fragment AND an op-hours copy", () => {
  // sunsetwinebistro.com: open Mon–Sat 4–8; HH 4–5:30 with $2-off deals. Extractor also
  // emitted a bare 16–17 fragment and the same deals spanning the full open hours.
  const k = "$2 off glass|;$6 off bottle|;$2 off apps|";
  const hours: OpenPeriod[] = [1, 2, 3, 4, 5, 6].map((d) => ({ openDay: d, openMin: 960, closeDay: d, closeMin: 1200 }));
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6], "16:00:00", "17:30:00"), offeringsKey: k },
      { ...w([1, 2, 3, 4, 5, 6], "16:00:00", "17:00:00"), offeringsKey: "" },
      { ...w([1, 2, 3, 4, 5, 6], "16:00:00", "20:00:00"), offeringsKey: k },
    ],
    hours,
  );
  const live = active(rs);
  assert.equal(live.length, 1);
  assert.equal(live[0].window.endTime, "17:30:00");
  const hidden = rs.filter((r) => !r.active);
  assert.ok(hidden.find((r) => r.window.endTime === "20:00:00")?.reasons.includes("operating_hours"));
  // The bare 16–17 fragment is fully CONTAINED by the real 16:00–17:30 deal, so the
  // (more specific) bare-covered clip catches it before the overlap pass.
  assert.ok(hidden.find((r) => r.window.endTime === "17:00:00")?.reasons.includes("bare_covered_clip"));
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

check("GOLDEN Bistro 44: bar 3–7 + dining 3–6 coexist (location-distinct, no conflict)", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6, 7], "15:00:00", "19:00:00"), location: "bar" },
      { ...w([1, 2, 3, 4, 5, 6, 7], "15:00:00", "18:00:00"), location: "dining" },
    ],
    null,
  );
  assert.equal(active(rs).length, 2);
});

check("location 'all' still conflicts with an overlapping area window", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5], "15:00:00", "19:00:00"), location: "bar" },
      { ...w([1, 2, 3, 4, 5], "15:00:00", "17:00:00"), location: "all" },
    ],
    null,
  );
  // Same (empty) deal sets overlapping with a wildcard area — conflict hides both, as before.
  assert.equal(active(rs).length, 0);
});

check("unset location behaves as 'all' (pre-location behavior unchanged)", () => {
  const rs = reconcileWindows(
    [w([1, 2, 3, 4, 5], "15:00:00", "19:00:00"), w([1, 2, 3, 4, 5], "15:00:00", "17:00:00")],
    null,
  );
  assert.equal(active(rs).length, 0);
});

check("GOLDEN 7 Mile House: closed-day clip drops Tuesday from an 'everyday' window", () => {
  // Google hours: open every day EXCEPT Tuesday (day 2 has no period).
  const hours = [1, 3, 4, 5, 6, 7].map((d) => ({ openDay: d, openMin: 690, closeDay: d, closeMin: 1260 }));
  const rs = reconcileWindows([w([1, 2, 3, 4, 5, 6, 7], "15:00:00", "18:00:00")], hours);
  assert.equal(rs.length, 1);
  assert.deepEqual(rs[0].window.daysOfWeek, [1, 3, 4, 5, 6, 7]);
  assert.equal(rs[0].active, true);
  assert.ok(rs[0].reasons.includes("closed_day_clip"));
});

check("closed-day clip: window entirely on closed days goes inactive", () => {
  const hours = [5, 6].map((d) => ({ openDay: d, openMin: 690, closeDay: d, closeMin: 1260 }));
  const rs = reconcileWindows([w([1, 2], "15:00:00", "18:00:00")], hours);
  assert.equal(rs[0].active, false);
  assert.ok(rs[0].reasons.includes("closed_day_clip"));
});

check("closed-day clip: unknown hours (null/empty) never clips", () => {
  const a = reconcileWindows([w([1, 2, 3, 4, 5, 6, 7], "15:00:00", "18:00:00")], null);
  assert.deepEqual(a[0].window.daysOfWeek, [1, 2, 3, 4, 5, 6, 7]);
  const b = reconcileWindows([w([1, 2, 3, 4, 5, 6, 7], "15:00:00", "18:00:00")], []);
  assert.deepEqual(b[0].window.daysOfWeek, [1, 2, 3, 4, 5, 6, 7]);
});

check("windowContains: identical interval → true", () => {
  assert.equal(windowContains(w([1], "15:00:00", "18:00:00"), w([1], "15:00:00", "18:00:00")), true);
});
check("windowContains: wider deal contains narrower bare → true", () => {
  assert.equal(windowContains(w([1], "14:00:00", "19:00:00"), w([1], "15:00:00", "18:00:00")), true);
});
check("windowContains: narrower deal does NOT contain wider bare → false", () => {
  assert.equal(windowContains(w([1], "15:00:00", "17:00:00"), w([1], "15:00:00", "18:00:00")), false);
});
check("windowContains: until-close handling (null end = end of day)", () => {
  assert.equal(windowContains(w([1], "21:00:00", null), w([1], "21:00:00", null)), true);
  // a bounded deal ending 23:00 cannot cover an until-close bare.
  assert.equal(windowContains(w([1], "21:00:00", "23:00:00"), w([1], "21:00:00", null)), false);
});
check("windowContains: all-day deal contains a bounded bare; bounded deal does NOT contain all-day bare", () => {
  assert.equal(windowContains(w([1], null, null, true), w([1], "15:00:00", "18:00:00")), true);
  assert.equal(windowContains(w([1], "15:00:00", "18:00:00"), w([1], null, null, true)), false);
});

check("GOLDEN Eureka: bare 15–18 [1-7] beside Mon/Tue deals → minority covered → clipped to Wed–Sun", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6, 7], "15:00:00", "18:00:00"), offeringsKey: "" },
      { ...w([1], "15:00:00", "18:00:00"), offeringsKey: "well drink|600" },
      { ...w([2], "15:00:00", "18:00:00"), offeringsKey: "house wine|700" },
    ],
    null,
  );
  const bare = rs.find((r) => (r.window.offeringsKey ?? "") === "")!;
  assert.equal(bare.active, true);
  assert.deepEqual(bare.window.daysOfWeek, [3, 4, 5, 6, 7]);
  assert.ok(bare.reasons.includes("bare_covered_clip"));
  assert.equal(active(rs).length, 3); // clipped bare + 2 deals all live
});

check("bare window DROPPED when a strict majority of its days are covered by deals (3 of 5)", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5], "15:00:00", "18:00:00"), offeringsKey: "" },
      { ...w([1], "15:00:00", "18:00:00"), offeringsKey: "a|100" },
      { ...w([2], "15:00:00", "18:00:00"), offeringsKey: "b|200" },
      { ...w([3], "15:00:00", "18:00:00"), offeringsKey: "c|300" },
    ],
    null,
  );
  const bare = rs.find((r) => (r.window.offeringsKey ?? "") === "")!;
  assert.equal(bare.active, false);
  assert.ok(bare.reasons.includes("bare_covered_clip"));
  assert.equal(active(rs).length, 3); // only the 3 deal windows
});

check("bare window fully covered (100%) is dropped", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2], "16:00:00", "18:00:00"), offeringsKey: "" },
      { ...w([1], "16:00:00", "18:00:00"), offeringsKey: "a|100" },
      { ...w([2], "16:00:00", "18:00:00"), offeringsKey: "b|200" },
    ],
    null,
  );
  const bare = rs.find((r) => (r.window.offeringsKey ?? "") === "")!;
  assert.equal(bare.active, false);
});

check("a lone bare window (no deal windows) is never clipped — only info we have", () => {
  const rs = reconcileWindows([{ ...w([1, 2, 3, 4, 5], "15:00:00", "18:00:00"), offeringsKey: "" }], null);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].active, true);
  assert.deepEqual(rs[0].window.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(rs[0].reasons.includes("bare_covered_clip"), false);
});

check("bare NOT clipped when the overlapping deal is narrower in time (containment, not overlap)", () => {
  // deal 15–17 does not cover the bare's 17–18 → the clip pass must not fire.
  // (Pass 3 overlap-conflict still hides the bare — but for a different reason.)
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5], "15:00:00", "18:00:00"), offeringsKey: "" },
      { ...w([1, 2, 3, 4, 5], "15:00:00", "17:00:00"), offeringsKey: "a|100" },
    ],
    null,
  );
  const bare = rs.find((r) => (r.window.offeringsKey ?? "") === "")!;
  assert.equal(bare.reasons.includes("bare_covered_clip"), false);
});

check("La Marcha: bare 22:00–close [1-6] beside Fri/Sat deal → minority covered → clipped to [1-4]", () => {
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6], "22:00:00", "00:00:00"), offeringsKey: "" },
      { ...w([5, 6], "22:00:00", "00:00:00"), offeringsKey: "sangria|900" },
    ],
    null,
  );
  const bare = rs.find((r) => (r.window.offeringsKey ?? "") === "")!;
  assert.equal(bare.active, true);
  assert.deepEqual(bare.window.daysOfWeek, [1, 2, 3, 4]);
  assert.ok(bare.reasons.includes("bare_covered_clip"));
});

check("Fuji: narrow 3-6 HH survives beside 'all day' day-deals mis-encoded as 11-20 op-hours windows", () => {
  // "Taco Tuesday / Thirsty Thursday ALL DAY" deals extract as 11am-8pm clock windows that
  // CONTAIN and overlap the real bare 3-6pm happy hour. An operating-hours-wide deal window
  // must NOT suppress a distinct narrow HH — neither via bare_covered_clip nor overlap_conflict.
  // They are different offers and coexist. (Regression guard for the reconcile fix, 2026-07-10.)
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 4, 5], "15:00:00", "18:00:00"), offeringsKey: "" },
      { ...w([1], "11:00:00", "20:00:00"), offeringsKey: "streetfood|0" },
      { ...w([2], "11:00:00", "20:00:00"), offeringsKey: "taco|300" },
      { ...w([4], "11:00:00", "20:00:00"), offeringsKey: "oldfashioned|500" },
    ],
    null,
  );
  const hh = rs.find((r) => r.window.startTime === "15:00:00")!;
  assert.equal(hh.active, true);
  assert.deepEqual(hh.window.daysOfWeek, [1, 2, 4, 5]);
  assert.equal(rs.filter((r) => r.window.startTime === "11:00:00" && r.active).length, 3);
});

check("Fuji free-parse: a suspect open-ended window must not drag the real bare HH into hidden", () => {
  // Fuji's free parser emits two BARE windows from the same pages: the real [1-7] 3-6pm (plausible)
  // and a spurious [1-7] 3pm-close (suspect). Both bare + overlapping → the same-key overlap branch
  // used to hide BOTH. A suspect window can be hidden but must not suppress a plausible one.
  // (Regression guard, 2026-07-10.)
  const rs = reconcileWindows(
    [
      { ...w([1, 2, 3, 4, 5, 6, 7], "15:00:00", "18:00:00"), offeringsKey: "", suspect: false },
      { ...w([1, 2, 3, 4, 5, 6, 7], "15:00:00", null), offeringsKey: "", suspect: true },
    ],
    null,
  );
  const real = rs.find((r) => r.window.endTime === "18:00:00")!;
  const spurious = rs.find((r) => r.window.endTime === null)!;
  assert.equal(real.active, true, "the plausible 3-6pm window survives");
  assert.equal(spurious.active, false, "the suspect 3pm-close window is hidden");
  assert.ok(spurious.reasons.includes("overlap_conflict"));
});

console.log(`\n${passed} checks passed.`);
