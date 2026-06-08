# HH Window-Reconcile Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic per-venue gate that cleans extractor over-capture (operating-hours-as-HH, per-day fragmentation, overlapping fragments) by merging duplicate windows and hiding suspect ones — never deleting.

**Architecture:** A pure module `lib/places/windowReconcile.ts` exposes `reconcileWindows(windows, hoursJson)`. It runs in three ordered passes — merge exact duplicates → hide operating-hours windows → hide overlap-conflict survivors. It is wired into the single persist path (`persistExtractedWindows`) and exposed as a re-runnable script (`reconcile:windows`) over existing rows, mirroring `realnessGate`.

**Tech Stack:** TypeScript (strict), Drizzle ORM + postgres.js, tsx test scripts with `node:assert` (no test framework). Spec: `docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md`.

---

### Task 1: Module scaffold — types, constants, time helpers

**Files:**
- Create: `lib/places/windowReconcile.ts`
- Test: `scripts/test-window-reconcile.ts`
- Modify: `package.json` (add `test:window-reconcile`)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-window-reconcile.ts`:

```ts
/**
 * Runnable unit checks for the pure window-reconcile gate (no test framework in repo).
 * Run: npx tsx scripts/test-window-reconcile.ts — exits non-zero on any failure.
 * The gate NEVER drops data; it merges duplicate windows or flips active=false.
 * See docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md.
 */
import assert from "node:assert/strict";
import {
  durationMin,
  type ReconcileWindow,
} from "@/lib/places/windowReconcile";

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

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: FAIL — cannot find module `@/lib/places/windowReconcile`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/places/windowReconcile.ts`:

```ts
/**
 * windowReconcile — deterministic, pure-code cleanup of extractor over-capture.
 *
 * The AI extractor captures everything; this gate decides what is shown. It runs on
 * the full SET of a venue's windows (unlike per-window realnessGate) so it can merge
 * duplicates and detect overlaps. It NEVER deletes — it only unions days (merge) or
 * flips active=false (operating-hours / overlap-conflict).
 *
 * See docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md.
 */
import type { OpenPeriod } from "@/lib/geo/timezone";

export interface ReconcileWindow {
  daysOfWeek: number[]; // ISO 1..7
  startTime: string | null; // "HH:MM" or "HH:MM:SS"; null = open-ended start
  endTime: string | null; // null = until close
  allDay: boolean;
}

export type ReconcileReason = "operating_hours" | "overlap_conflict" | "merged_duplicate";

export interface ReconcileResult {
  window: ReconcileWindow; // possibly merged (days unioned)
  active: boolean;
  reasons: ReconcileReason[];
}

// Thresholds (tunable). Validated against the Spokane ground-truth venues.
export const OPERATING_HOURS_COVERAGE = 0.8;
export const OPERATING_HOURS_MIN_HOURS = 8;
export const BUSINESS_DAY_START_MAX_MIN = 11 * 60; // 11:00
export const BUSINESS_DAY_MIN_HOURS = 6;
export const OPEN_TIME_TOLERANCE_MIN = 30;

const MIN_PER_DAY = 1440;

/** Parse "HH:MM" or "HH:MM:SS" → minutes from midnight. */
export function hhmmToMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/** Duration of a window in minutes, or null when either bound is missing.
 *  end < start means it crosses midnight (e.g. 11:00 → 00:00 = 13h). */
export function durationMin(win: ReconcileWindow): number | null {
  if (win.startTime == null || win.endTime == null) return null;
  const start = hhmmToMin(win.startTime);
  let end = hhmmToMin(win.endTime);
  if (end <= start) end += MIN_PER_DAY;
  return end - start;
}
```

Add to `package.json` scripts (after `"test:realness-gate"`):

```json
    "test:window-reconcile": "tsx scripts/test-window-reconcile.ts",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: PASS — `3 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/places/windowReconcile.ts scripts/test-window-reconcile.ts package.json
git commit -m "feat(reconcile): window-reconcile module scaffold + time helpers"
```

---

### Task 2: Merge exact duplicates

**Files:**
- Modify: `lib/places/windowReconcile.ts`
- Test: `scripts/test-window-reconcile.ts`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test-window-reconcile.ts` before the final `console.log`:

```ts
import { mergeDuplicates } from "@/lib/places/windowReconcile"; // add to the import block at top

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
```

Move the single-line `import { durationMin, type ReconcileWindow }` to a combined import that also pulls `mergeDuplicates` (keep one import block).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: FAIL — `mergeDuplicates` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/places/windowReconcile.ts`:

```ts
function sortedUniqueDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Collapse windows with identical (startTime, endTime, allDay) into one window whose
 * days are the sorted-unique union. A collapsed group carries `merged_duplicate`.
 * Lossless: stays active; only the day arrays combine.
 */
export function mergeDuplicates(windows: ReconcileWindow[]): ReconcileResult[] {
  const groups = new Map<string, { win: ReconcileWindow; count: number }>();
  for (const win of windows) {
    const key = `${win.startTime ?? "-"}|${win.endTime ?? "-"}|${win.allDay}`;
    const g = groups.get(key);
    if (g) {
      g.win = { ...g.win, daysOfWeek: sortedUniqueDays([...g.win.daysOfWeek, ...win.daysOfWeek]) };
      g.count += 1;
    } else {
      groups.set(key, { win: { ...win, daysOfWeek: sortedUniqueDays(win.daysOfWeek) }, count: 1 });
    }
  }
  return [...groups.values()].map((g) => ({
    window: g.win,
    active: true,
    reasons: g.count > 1 ? (["merged_duplicate"] as ReconcileReason[]) : [],
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: PASS — all checks pass.

- [ ] **Step 5: Commit**

```bash
git add lib/places/windowReconcile.ts scripts/test-window-reconcile.ts
git commit -m "feat(reconcile): merge exact-duplicate windows (union days)"
```

---

### Task 3: Operating-hours filter

**Files:**
- Modify: `lib/places/windowReconcile.ts`
- Test: `scripts/test-window-reconcile.ts`

- [ ] **Step 1: Write the failing test**

Append checks (and add `isOperatingHours` to the import block):

```ts
import { isOperatingHours } from "@/lib/places/windowReconcile";
import type { OpenPeriod } from "@/lib/geo/timezone";

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
check("op-hours: start-only window starting ≈ open time is operating-hours", () => {
  const hours: OpenPeriod[] = [{ openDay: 1, openMin: 660, closeDay: 1, closeMin: 1380 }]; // 11:00–23:00
  assert.equal(isOperatingHours(w([1], "11:00:00", null), hours), true); // start ≈ open, no end
});
check("op-hours: start-only window with no hours_json is NOT operating-hours", () => {
  assert.equal(isOperatingHours(w([1], "20:00:00", null), null), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: FAIL — `isOperatingHours` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/places/windowReconcile.ts`:

```ts
/** Open-period length in minutes for ISO day `d`, or null if not published / closeless. */
function openLenForDay(d: number, hoursJson: OpenPeriod[] | null | undefined): number | null {
  if (!hoursJson) return null;
  const p = hoursJson.find((x) => x.openDay === d);
  if (!p || p.closeMin == null) return null;
  let close = p.closeMin;
  if (close <= p.openMin) close += MIN_PER_DAY; // crosses midnight
  return close - p.openMin;
}

/** Open minute-of-day for ISO day `d`, or null. */
function openMinForDay(d: number, hoursJson: OpenPeriod[] | null | undefined): number | null {
  if (!hoursJson) return null;
  const p = hoursJson.find((x) => x.openDay === d);
  return p ? p.openMin : null;
}

/**
 * True when a bounded, non-allDay window is the venue's operating hours, not a happy hour.
 * Triggers (any): hours_json ≥80% coverage on a majority of covered days; OR ≥8h duration;
 * OR business-day span (start ≤11:00 and ≥6h); OR a start-only window whose start ≈ open time.
 */
export function isOperatingHours(win: ReconcileWindow, hoursJson: OpenPeriod[] | null | undefined): boolean {
  if (win.allDay) return false; // governed by the all-day policy
  if (win.startTime == null) return false; // need at least a start
  const start = hhmmToMin(win.startTime);

  // Start-only ("open till close") whose start matches the venue's open time.
  if (win.endTime == null) {
    let near = 0;
    let total = 0;
    for (const d of win.daysOfWeek) {
      const open = openMinForDay(d, hoursJson);
      if (open == null) continue;
      total += 1;
      if (Math.abs(start - open) <= OPEN_TIME_TOLERANCE_MIN) near += 1;
    }
    return total > 0 && near * 2 >= total;
  }

  const dur = durationMin(win);
  if (dur == null) return false;
  if (dur >= OPERATING_HOURS_MIN_HOURS * 60) return true;
  if (start <= BUSINESS_DAY_START_MAX_MIN && dur >= BUSINESS_DAY_MIN_HOURS * 60) return true;

  // hours_json coverage on a majority of covered days.
  let covered = 0;
  let matches = 0;
  for (const d of win.daysOfWeek) {
    const openLen = openLenForDay(d, hoursJson);
    if (openLen == null || openLen === 0) continue;
    covered += 1;
    if (dur / openLen >= OPERATING_HOURS_COVERAGE) matches += 1;
  }
  return covered > 0 && matches * 2 >= covered;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: PASS — all checks pass.

- [ ] **Step 5: Commit**

```bash
git add lib/places/windowReconcile.ts scripts/test-window-reconcile.ts
git commit -m "feat(reconcile): operating-hours filter (hours_json + 8h + business-day-span)"
```

---

### Task 4: Overlap-conflict detection

**Files:**
- Modify: `lib/places/windowReconcile.ts`
- Test: `scripts/test-window-reconcile.ts`

- [ ] **Step 1: Write the failing test**

Append checks (add `windowsOverlap` to the import block):

```ts
import { windowsOverlap } from "@/lib/places/windowReconcile";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: FAIL — `windowsOverlap` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/places/windowReconcile.ts`:

```ts
/** Effective [start,end] minute interval; end-null → until end of day (MIN_PER_DAY). */
function interval(win: ReconcileWindow): [number, number] | null {
  if (win.startTime == null) return null; // no start → cannot position
  const start = hhmmToMin(win.startTime);
  let end = win.endTime == null ? MIN_PER_DAY : hhmmToMin(win.endTime);
  if (win.endTime != null && end <= start) end += MIN_PER_DAY; // crosses midnight
  return [start, end];
}

function shareADay(a: ReconcileWindow, b: ReconcileWindow): boolean {
  const set = new Set(a.daysOfWeek);
  return b.daysOfWeek.some((d) => set.has(d));
}

/**
 * True when two windows share a day AND their clock ranges overlap but are NOT identical.
 * Identical-time windows are merged in Task 2, so they are not treated as conflicts here.
 */
export function windowsOverlap(a: ReconcileWindow, b: ReconcileWindow): boolean {
  if (!shareADay(a, b)) return false;
  if (a.startTime === b.startTime && a.endTime === b.endTime) return false; // identical → merge, not conflict
  const ia = interval(a);
  const ib = interval(b);
  if (!ia || !ib) return false;
  return ia[0] < ib[1] && ib[0] < ia[1];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: PASS — all checks pass.

- [ ] **Step 5: Commit**

```bash
git add lib/places/windowReconcile.ts scripts/test-window-reconcile.ts
git commit -m "feat(reconcile): overlap-conflict detection"
```

---

### Task 5: `reconcileWindows` orchestrator + Spokane golden set

**Files:**
- Modify: `lib/places/windowReconcile.ts`
- Test: `scripts/test-window-reconcile.ts`

- [ ] **Step 1: Write the failing test**

Append checks (add `reconcileWindows` to the import block):

```ts
import { reconcileWindows } from "@/lib/places/windowReconcile";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: FAIL — `reconcileWindows` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/places/windowReconcile.ts`:

```ts
/**
 * Reconcile a venue's full window set. Order: (1) merge exact duplicates;
 * (2) hide operating-hours windows; (3) among still-active survivors, hide any that
 * overlap another survivor on a shared day with a different time. Pure — caller persists.
 */
export function reconcileWindows(
  windows: ReconcileWindow[],
  hoursJson?: OpenPeriod[] | null,
): ReconcileResult[] {
  const results = mergeDuplicates(windows);

  // Pass 2: operating-hours.
  for (const r of results) {
    if (isOperatingHours(r.window, hoursJson)) {
      r.active = false;
      r.reasons.push("operating_hours");
    }
  }

  // Pass 3: overlap-conflict among survivors only.
  const survivors = results.filter((r) => r.active);
  const conflicted = new Set<ReconcileResult>();
  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      if (windowsOverlap(survivors[i].window, survivors[j].window)) {
        conflicted.add(survivors[i]);
        conflicted.add(survivors[j]);
      }
    }
  }
  for (const r of conflicted) {
    r.active = false;
    r.reasons.push("overlap_conflict");
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-window-reconcile.ts`
Expected: PASS — all golden checks pass.

- [ ] **Step 5: Commit**

```bash
git add lib/places/windowReconcile.ts scripts/test-window-reconcile.ts
git commit -m "feat(reconcile): reconcileWindows orchestrator + Spokane golden set"
```

---

### Task 6: Register the test in CI

**Files:**
- Modify: `scripts/ci-tests.sh`

- [ ] **Step 1: Add the test to the suite**

In `scripts/ci-tests.sh`, in the `TESTS=(` array, add a line after `test:realness-gate`:

```bash
  test:window-reconcile
```

- [ ] **Step 2: Run the full hermetic suite**

Run: `pnpm run test:ci`
Expected: every test passes, including `test:window-reconcile`.

- [ ] **Step 3: Commit**

```bash
git add scripts/ci-tests.sh
git commit -m "test(reconcile): add window-reconcile to hermetic CI suite"
```

---

### Task 7: Wire reconcile into the persist path

**Files:**
- Modify: `lib/recover/resolveVenue.ts:58-141` (`persistExtractedWindows`)

**Context:** Currently the per-window loop calls `assessRealness` per `hh` and inserts. We add a reconcile pass FIRST that maps `extracted.happyHours` → reconciled windows, then the loop honors the reconcile verdict alongside `assessRealness`. The venue's `hoursJson` is fetched once.

- [ ] **Step 1: Add imports**

At the top of `lib/recover/resolveVenue.ts`, add to existing imports:

```ts
import { reconcileWindows, type ReconcileWindow } from "@/lib/places/windowReconcile";
```

Ensure `venues` is already imported from the schema (it is — used in the promote `update`).

- [ ] **Step 2: Fetch hoursJson + reconcile before the insert loop**

In `persistExtractedWindows`, immediately after the `aiUsageLedger` insert (line ~72) and before `let live = 0;`, insert:

```ts
  const [venueRow] = await db
    .select({ hoursJson: venues.hoursJson })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);

  const reconWindows: ReconcileWindow[] = extracted.happyHours.map((hh) => ({
    daysOfWeek: hh.daysOfWeek,
    startTime: hh.startTime,
    endTime: hh.endTime,
    allDay: hh.allDay,
  }));
  const reconResults = reconcileWindows(reconWindows, venueRow?.hoursJson ?? null);
  // Align reconcile verdicts back to source rows by identity index. reconcileWindows
  // may MERGE rows, so map each original hh to the reconciled result whose merged day-set
  // covers it and whose (start,end,allDay) match.
  function reconFor(hh: (typeof extracted.happyHours)[number]) {
    return reconResults.find(
      (r) =>
        r.window.startTime === hh.startTime &&
        r.window.endTime === hh.endTime &&
        r.window.allDay === hh.allDay,
    );
  }
```

- [ ] **Step 3: Honor the reconcile verdict in the loop**

In the loop body, replace the `isActive` computation (line ~87):

```ts
    const isActive = !verdict.suspect && !hh.suspect;
```

with:

```ts
    const recon = reconFor(hh);
    const reconActive = recon ? recon.active : true;
    const isActive = !verdict.suspect && !hh.suspect && reconActive;
```

And change the inserted `daysOfWeek` to use the merged day-set when present so merged duplicates collapse to one effective day-array (the `onConflictDoNothing` natural key dedups identical inserts):

```ts
    const days = recon ? recon.window.daysOfWeek : [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
```

(Replace the existing `const days = [...new Set(hh.daysOfWeek)]...` line.)

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/recover/resolveVenue.ts
git commit -m "feat(reconcile): apply window-reconcile gate in the persist path"
```

---

### Task 8: `reconcile:windows` re-gate script over existing rows

**Files:**
- Create: `scripts/reconcile-windows.ts`
- Modify: `package.json` (add `reconcile:windows`)

**Context:** Re-applies the gate to ALREADY-STORED `happy_hours` rows per city — merges duplicates (soft-deletes the absorbed rows, expands the kept row's days), hides operating-hours/overlap rows (`active=false`), and prints a review report. Uses the same `--city/--state` resolution as other scripts (`requireCityArgs`). Needs a live DB, so it is NOT added to the hermetic CI suite. `--apply` writes; default is a dry-run report.

- [ ] **Step 1: Write the script**

Create `scripts/reconcile-windows.ts`:

```ts
/**
 * Re-apply the deterministic window-reconcile gate to EXISTING happy_hours rows.
 *   pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa            (dry-run report)
 *   pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa --apply    (write changes)
 *
 * Merges exact-duplicate windows (keeps one, unions days, soft-deletes the rest), and
 * flips active=false on operating-hours / overlap-conflict windows. NEVER hard-deletes.
 * See docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md.
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { reconcileWindows, type ReconcileWindow } from "@/lib/places/windowReconcile";
import type { OpenPeriod } from "@/lib/geo/timezone";

const apply = process.argv.includes("--apply");

async function main() {
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [city] = await sql<{ id: string }[]>`
      SELECT id FROM cities WHERE slug = ${slug} AND lower(state) = lower(${state}) LIMIT 1`;
    if (!city) throw new Error(`No city for --city ${slug} --state ${state}`);

    const venues = await sql<{ id: string; name: string; hours_json: OpenPeriod[] | null }[]>`
      SELECT v.id, v.name, v.hours_json
      FROM venues v
      WHERE v.city_id = ${city.id} AND v.deleted_at IS NULL`;

    let hiddenTotal = 0;
    let mergedTotal = 0;
    const report: string[] = [];

    for (const v of venues) {
      const rows = await sql<
        { id: string; days_of_week: number[]; start_time: string | null; end_time: string | null; all_day: boolean; active: boolean }[]
      >`
        SELECT id, days_of_week, start_time, end_time, all_day, active
        FROM happy_hours
        WHERE venue_id = ${v.id} AND deleted_at IS NULL`;
      if (rows.length === 0) continue;

      // Map DB rows to reconcile inputs, remembering the source row id per (key).
      const idsByKey = new Map<string, string[]>();
      const inputs: ReconcileWindow[] = rows.map((r) => {
        const win: ReconcileWindow = {
          daysOfWeek: r.days_of_week,
          startTime: r.start_time,
          endTime: r.end_time,
          allDay: r.all_day,
        };
        const key = `${r.start_time ?? "-"}|${r.end_time ?? "-"}|${r.all_day}`;
        idsByKey.set(key, [...(idsByKey.get(key) ?? []), r.id]);
        return win;
      });

      const results = reconcileWindows(inputs, v.hours_json);

      for (const res of results) {
        const key = `${res.window.startTime ?? "-"}|${res.window.endTime ?? "-"}|${res.window.allDay}`;
        const ids = idsByKey.get(key) ?? [];
        if (ids.length === 0) continue;
        const [keep, ...absorbed] = ids;

        // Merge: expand the kept row's days, soft-delete absorbed duplicates.
        if (absorbed.length > 0) {
          mergedTotal += absorbed.length;
          report.push(`  MERGE  ${v.name}: ${ids.length} rows ${key} → 1 (days ${res.window.daysOfWeek.join(",")})`);
          if (apply) {
            await sql`UPDATE happy_hours SET days_of_week = ${res.window.daysOfWeek}, updated_at = now() WHERE id = ${keep}`;
            await sql`UPDATE happy_hours SET deleted_at = now(), active = false, updated_at = now() WHERE id = ANY(${absorbed})`;
          }
        }

        // Hide: operating-hours / overlap-conflict.
        if (!res.active) {
          hiddenTotal += 1;
          report.push(`  HIDE   ${v.name}: ${key} [${res.reasons.join(",")}]`);
          if (apply) {
            await sql`UPDATE happy_hours SET active = false, updated_at = now() WHERE id = ${keep}`;
          }
        }
      }
    }

    console.log(report.join("\n"));
    console.log(
      `\n${apply ? "APPLIED" : "DRY-RUN"} for '${slug}/${state}': ${mergedTotal} duplicate row(s) merged, ${hiddenTotal} window(s) hidden.`,
    );
    if (!apply) console.log("Re-run with --apply to write.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Add to `package.json` scripts (after `"reextract:stubs:free"` or near the other ops scripts):

```json
    "reconcile:windows": "tsx scripts/reconcile-windows.ts",
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 3: Dry-run against Spokane**

Run: `pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa`
Expected: report lists MERGE for Swinging Doors, HIDE (operating_hours) for Lantern's long windows, HIDE (overlap_conflict) for Bigfoot — and a `DRY-RUN … N merged, M hidden` summary. No DB writes.

- [ ] **Step 4: Verify against the DB after a real apply**

Run: `pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa --apply`
Then:

```bash
PGPASSWORD=hhf docker compose exec -T db psql -U hhf -d happyhourfriends -c "
select v.name, count(*) filter (where h.active and h.deleted_at is null) live
from venues v join cities c on c.id=v.city_id
join happy_hours h on h.venue_id=v.id
where c.slug='spokane' and c.state='WA' and v.name in ('South Perry Lantern','The Swinging Doors','Bigfoot Pub & Eatery')
group by v.name order by v.name;"
```
Expected: Lantern 1 live, Swinging Doors 1 live, Bigfoot 0 live (stub).

- [ ] **Step 5: Commit**

```bash
git add scripts/reconcile-windows.ts package.json
git commit -m "feat(reconcile): reconcile:windows re-gate script over existing rows"
```

---

## Rollout (after the plan is implemented — not a code task)

1. `pnpm run test:ci` green.
2. `pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa` (review), then `--apply`.
3. Apply operator ground-truth via the audited path (Nectar offerings; 1919 → Sunday all-day; Bigfoot → every day 16:00–19:00 + 5 offerings; Crazy Train stays stub; Garland → Mon all-day 15:00–21:00 + Tue–Fri 15:00–17:00), each with its source URL.
4. Operator eyeballs the review state → flip Spokane `status='live'`.
5. Commit/PR the Spokane onboarding (city row + boundary + 180s poll change) alongside the gate.
```
