# Resolve HH Open-Ended Times Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render "until close" / "open until X" / "all day" happy-hour windows as real clock times pulled from the venue's stored Google operating hours — per-day on the venue page, today-only on the grid — and tier the grid by relevance.

**Architecture:** A pure resolver in `lib/geo/timezone.ts` (`resolveBoundsForDay`) swaps an open-ended side of a window for the venue's earliest-open / latest-close minute on a given ISO weekday, returning `null` (→ keep the existing text) when hours are unknown. A pure formatter in `lib/format.ts` (`formatWindowByDay`) groups a window's days into lines sharing identical resolved bounds, used by the venue page. The grid resolves against today only, sorts live → today → other-days, and mutes non-today rows.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19. Tests are hand-rolled `tsx` assertion scripts (`node:assert/strict`) registered in `package.json` and run via `npm run test:*` — there is no vitest/jest. UI wiring is verified with `npm run typecheck` + `npm run build` + manual dev check (the repo has no React test harness).

---

## File Structure

- `lib/geo/timezone.ts` — **modify**: add `resolveBoundsForDay` + a local `minutesToHHMM` helper. Pure; no new imports.
- `lib/format.ts` — **modify**: add `formatWindowByDay`; imports `resolveBoundsForDay` + `OpenPeriod` from `lib/geo/timezone.ts` (no cycle — `timezone.ts` does not import `format.ts`).
- `app/[city]/venue/[slug]/page.tsx` — **modify**: replace the single-line window render with grouped per-day lines.
- `components/venue-table-client.tsx` — **modify**: day-aware `displayBounds`, `runsToday` helper, tiered `"now"` sort, muting of non-today rows.
- `scripts/test-resolve-bounds.ts` — **create**: unit checks for `resolveBoundsForDay`.
- `scripts/test-format-by-day.ts` — **create**: unit checks for `formatWindowByDay`.
- `package.json` — **modify**: register `test:resolve` and `test:format-by-day`.

---

## Task 1: `resolveBoundsForDay` resolver

**Files:**
- Modify: `lib/geo/timezone.ts` (append after `isWindowActive`, before `minutesUntilWindowEnd`)
- Test: `scripts/test-resolve-bounds.ts` (create)
- Modify: `package.json` (add `test:resolve` script)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-resolve-bounds.ts`:

```ts
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
```

Add to `package.json` `scripts` (after the existing `test:hours` line):

```json
    "test:resolve": "tsx scripts/test-resolve-bounds.ts",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:resolve`
Expected: FAIL — `resolveBoundsForDay` is not an export of `@/lib/geo/timezone` (import/type error or runtime throw).

- [ ] **Step 3: Write minimal implementation**

In `lib/geo/timezone.ts`, insert after the closing `}` of `isWindowActive` (currently line 141) and before the `minutesUntilWindowEnd` doc comment:

```ts
/** Minutes-since-midnight → "HH:MM" (24h, wraps at 1440). */
function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Resolve an open-ended window's bounds to real clock times on a given ISO weekday,
 * using the venue's operating hours. The bounded side passes through unchanged; the
 * open-ended side becomes the venue's earliest open (start) or latest close (end) that
 * day. Split lunch/dinner hours collapse to earliest-open .. latest-close. A cross-
 * midnight close returns its clock value (e.g. 02:00) but ranks later than any same-day
 * close so it wins the "latest close" pick.
 *
 * Returns null — and the caller keeps the existing "close"/"Open to close" text — when:
 *   - the window is fully bounded (nothing to resolve),
 *   - hours are absent/empty,
 *   - no operating period exists for `isoDay`, or
 *   - the side we need (open or close) is unpublished (Google's 24h representation).
 * We never invent a time we don't have.
 */
export function resolveBoundsForDay(
  w: HappyHourWindow,
  hours: OpenPeriod[] | null | undefined,
  isoDay: number,
): { startTime: string; endTime: string } | null {
  const needsOpen = w.allDay || w.startTime == null;
  const needsClose = w.allDay || w.endTime == null;
  if (!needsOpen && !needsClose) return null; // bounded — nothing to resolve

  if (!hours || hours.length === 0) return null;
  const periods = hours.filter((p) => p.openDay === isoDay);
  if (periods.length === 0) return null;

  let openMin: number | null = null;
  for (const p of periods) {
    if (openMin == null || p.openMin < openMin) openMin = p.openMin;
  }

  // Latest close that day. A cross-midnight close (different close day, or close minute
  // ≤ open minute) is later than any same-day close, so rank it +24h while keeping the
  // real clock value to return.
  let closeMin: number | null = null;
  let bestRank = -1;
  for (const p of periods) {
    if (p.closeMin == null) continue;
    const crosses = p.closeDay !== p.openDay || p.closeMin <= p.openMin;
    const rank = crosses ? p.closeMin + 1440 : p.closeMin;
    if (rank > bestRank) {
      bestRank = rank;
      closeMin = p.closeMin;
    }
  }

  if (needsOpen && openMin == null) return null;
  if (needsClose && closeMin == null) return null;

  return {
    startTime: needsOpen ? minutesToHHMM(openMin as number) : (w.startTime as string),
    endTime: needsClose ? minutesToHHMM(closeMin as number) : (w.endTime as string),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:resolve`
Expected: PASS — `10 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/geo/timezone.ts scripts/test-resolve-bounds.ts package.json
git commit -m "feat(timezone): resolveBoundsForDay — open-ended HH bounds → clock times

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `formatWindowByDay` formatter

**Files:**
- Modify: `lib/format.ts` (add import + new function at end)
- Test: `scripts/test-format-by-day.ts` (create)
- Modify: `package.json` (add `test:format-by-day` script)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-format-by-day.ts`:

```ts
/**
 * Unit checks for formatWindowByDay. Run: npx tsx scripts/test-format-by-day.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { formatWindowByDay } from "@/lib/format";
import type { OpenPeriod } from "@/lib/geo/timezone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Mon–Thu close 22:00; Fri close 02:00 (next day).
const hours: OpenPeriod[] = [
  { openDay: 1, openMin: 11 * 60, closeDay: 1, closeMin: 22 * 60 },
  { openDay: 2, openMin: 11 * 60, closeDay: 2, closeMin: 22 * 60 },
  { openDay: 3, openMin: 11 * 60, closeDay: 3, closeMin: 22 * 60 },
  { openDay: 4, openMin: 11 * 60, closeDay: 4, closeMin: 22 * 60 },
  { openDay: 5, openMin: 11 * 60, closeDay: 6, closeMin: 2 * 60 },
];

const untilClose = {
  allDay: false, startTime: "15:00", endTime: null, daysOfWeek: [1, 2, 3, 4, 5],
};
check("varying close splits into per-close groups", () =>
  assert.deepEqual(formatWindowByDay(untilClose, hours), [
    { days: [1, 2, 3, 4], bounds: "3 PM – 10 PM" },
    { days: [5], bounds: "3 PM – 12 AM" },
  ]));

check("uniform close collapses to one group", () =>
  assert.deepEqual(
    formatWindowByDay(
      { allDay: false, startTime: "15:00", endTime: null, daysOfWeek: [1, 2, 3, 4] },
      hours,
    ),
    [{ days: [1, 2, 3, 4], bounds: "3 PM – 10 PM" }],
  ));

check("no hours → single fallback group with text bounds", () =>
  assert.deepEqual(formatWindowByDay(untilClose, null), [
    { days: [1, 2, 3, 4, 5], bounds: "3 PM – close" },
  ]));

check("all-day with hours resolves open–close", () =>
  assert.deepEqual(
    formatWindowByDay(
      { allDay: true, startTime: null, endTime: null, daysOfWeek: [1] },
      hours,
    ),
    [{ days: [1], bounds: "11 AM – 10 PM" }],
  ));

check("bounded window is unchanged across its days", () =>
  assert.deepEqual(
    formatWindowByDay(
      { allDay: false, startTime: "16:00", endTime: "18:00", daysOfWeek: [1, 2] },
      hours,
    ),
    [{ days: [1, 2], bounds: "4 PM – 6 PM" }],
  ));

console.log(`\n${passed} checks passed.`);
```

Add to `package.json` `scripts` (after the `test:resolve` line):

```json
    "test:format-by-day": "tsx scripts/test-format-by-day.ts",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:format-by-day`
Expected: FAIL — `formatWindowByDay` is not an export of `@/lib/format`.

- [ ] **Step 3: Write minimal implementation**

At the top of `lib/format.ts`, add the import (the file currently has no imports):

```ts
import { resolveBoundsForDay, type OpenPeriod } from "@/lib/geo/timezone";
```

At the end of `lib/format.ts`, add:

```ts
/**
 * Render a window per day, grouping days that share identical resolved bounds. Each
 * day's open-ended side is resolved against `hours` (via resolveBoundsForDay); days
 * that can't resolve fall back to {@link formatWindow}'s text. Days are grouped by the
 * resulting bounds string so e.g. Mon–Thu (close 10 PM) and Fri (close 12 AM) become
 * two lines. Returns raw day arrays so callers choose the day formatter.
 */
export function formatWindowByDay(
  window: {
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
    daysOfWeek: number[];
  },
  hours: OpenPeriod[] | null | undefined,
): { days: number[]; bounds: string }[] {
  const days = [...new Set(window.daysOfWeek)].sort((a, b) => a - b);
  const byBounds = new Map<string, number[]>();
  const order: string[] = [];
  for (const d of days) {
    const resolved = resolveBoundsForDay(
      {
        daysOfWeek: window.daysOfWeek,
        allDay: window.allDay,
        startTime: window.startTime,
        endTime: window.endTime,
      },
      hours,
      d,
    );
    const bounds = resolved
      ? formatWindow({ allDay: false, startTime: resolved.startTime, endTime: resolved.endTime })
      : formatWindow(window);
    if (!byBounds.has(bounds)) {
      byBounds.set(bounds, []);
      order.push(bounds);
    }
    byBounds.get(bounds)!.push(d);
  }
  return order.map((bounds) => ({ days: byBounds.get(bounds)!, bounds }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:format-by-day`
Expected: PASS — `5 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts scripts/test-format-by-day.ts package.json
git commit -m "feat(format): formatWindowByDay — group HH days by resolved clock times

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Venue page per-day render

**Files:**
- Modify: `app/[city]/venue/[slug]/page.tsx:8` (import) and `:305-318` (render block)

- [ ] **Step 1: Update the import**

At `app/[city]/venue/[slug]/page.tsx:8`, change:

```ts
import { formatDays, formatDaysLong, formatPrice, formatWindow } from "@/lib/format";
```

to:

```ts
import { formatDays, formatDaysLong, formatPrice, formatWindowByDay } from "@/lib/format";
```

(`formatWindow` is only used in the block we're replacing — removing it avoids an unused import. `formatDays` stays; it's still used at line 101 for JSON-LD.)

- [ ] **Step 2: Replace the render block**

Replace the `<li>…</li>` body for each group. The current block (lines 306–321) is:

```tsx
            {groupedHours.map(({ days, rep: h }) => (
              <li
                key={h.id}
                className="rounded-lg border border-border bg-bg-surface p-4 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.45)]"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-text-primary">
                    {formatDaysLong(days)}
                  </span>
                  <span className="tabular-nums text-accent-warm">
                    {formatWindow(h)}
                  </span>
                </div>
                {h.notes && (
                  <p className="mt-1 text-sm text-text-muted">{h.notes}</p>
                )}
```

Change it to (only the `.map` callback head and the days/window `<div>` change; everything from `{h.notes && …}` onward stays exactly as-is):

```tsx
            {groupedHours.map(({ days, rep: h }) => {
              const lines = formatWindowByDay(
                { allDay: h.allDay, startTime: h.startTime, endTime: h.endTime, daysOfWeek: days },
                venue.hoursJson,
              );
              return (
              <li
                key={h.id}
                className="rounded-lg border border-border bg-bg-surface p-4 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.45)]"
              >
                <div className="space-y-1">
                  {lines.map((ln) => (
                    <div key={ln.days.join(",")} className="flex items-baseline justify-between">
                      <span className="font-medium text-text-primary">
                        {formatDaysLong(ln.days)}
                      </span>
                      <span className="tabular-nums text-accent-warm">{ln.bounds}</span>
                    </div>
                  ))}
                </div>
                {h.notes && (
                  <p className="mt-1 text-sm text-text-muted">{h.notes}</p>
                )}
```

Then, at the end of the same `.map` (currently `</li>\n            ))}` around line 360), the arrow body is now a block, so close it with `)` then `}`. Find the matching close of this `<li>` (the `))}` that ends the `groupedHours.map`) and change:

```tsx
              </li>
            ))}
```

to:

```tsx
              </li>
              );
            })}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors; the two pre-existing Phase 0 lint/type notes in `db/schema/moderation.ts` + `scripts/import-neighborhoods.ts` are unrelated and untouched).

- [ ] **Step 4: Commit**

```bash
git add "app/[city]/venue/[slug]/page.tsx"
git commit -m "feat(venue): show per-day resolved HH times on the venue page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Grid — today resolution, tiered sort, muting

**Files:**
- Modify: `components/venue-table-client.tsx` — import (`:6-10`), `displayBounds` (`:54-63`), add `runsToday` (near `:242`), `"now"` sort tier (`:338-345`), sort deps (`:381-391`), desktop row (`:719-728`) + call site (`:768`), mobile card (`:822-831`) + call site (`:858`).

- [ ] **Step 1: Extend the timezone import**

At `components/venue-table-client.tsx:6-10`, change:

```ts
import {
  isWindowActive,
  minutesUntilWindowEnd,
  venueLocalNow,
} from "@/lib/geo/timezone";
```

to:

```ts
import {
  isWindowActive,
  minutesUntilWindowEnd,
  resolveBoundsForDay,
  venueLocalNow,
  type VenueLocalNow,
} from "@/lib/geo/timezone";
```

- [ ] **Step 2: Make `displayBounds` day-aware**

Replace `displayBounds` (lines 54–63) with:

```ts
function displayBounds(
  v: VenueListItem,
  activeW: HappyHourRow | null,
  tzNow: VenueLocalNow | null,
): { allDay: boolean; startTime: string | null; endTime: string | null } {
  // Feature the live window, else a window that runs today — and resolve its open-ended
  // side to today's real clock times. A resolved concrete time therefore always means
  // "today". With nothing today (or unknown hours) fall back to the merged summary.
  const today = tzNow
    ? v.happyHours.find((h) => h.daysOfWeek.includes(tzNow.dayOfWeek))
    : undefined;
  const w = activeW ?? today ?? null;
  if (w && tzNow) {
    const resolved = resolveBoundsForDay(w, v.hoursJson, tzNow.dayOfWeek);
    if (resolved) {
      return { allDay: false, startTime: resolved.startTime, endTime: resolved.endTime };
    }
    return { allDay: w.allDay, startTime: w.startTime, endTime: w.endTime };
  }
  if (w) return { allDay: w.allDay, startTime: w.startTime, endTime: w.endTime };
  const b = windowBounds(v);
  return { allDay: b.allDay, startTime: b.start, endTime: b.end };
}
```

- [ ] **Step 3: Add a `runsToday` helper**

Immediately after the `isNowOpen` `useCallback` (ends at line 245), add:

```ts
  // True when a venue has a happy-hour window on today's venue-local weekday — drives
  // the relevance tier and row muting. Independent of whether it's live right now.
  const runsToday = useCallback(
    (v: VenueListItem): boolean => {
      const tz = v.timezone;
      if (!tz) return false;
      const now = nowByTz.get(tz);
      if (!now) return false;
      return v.happyHours.some((h) => h.daysOfWeek.includes(now.dayOfWeek));
    },
    [nowByTz],
  );
```

- [ ] **Step 4: Tier the default `"now"` sort**

Replace the `case "now":` block (lines 338–345) with:

```ts
        case "now": {
          // Relevance tiers: live now → runs today → other days. Ties break on start
          // time, then name. (Stubs render in their own section, so tier 3 is implicit.)
          const tier = (x: VenueListItem) =>
            isNowOpen(x) ? 0 : runsToday(x) ? 1 : 2;
          const at = tier(a);
          const bt = tier(b);
          if (at !== bt) return at - bt;
          const s = (aB.start ?? "99:99").localeCompare(bB.start ?? "99:99");
          return s !== 0 ? s : a.name.localeCompare(b.name);
        }
```

- [ ] **Step 5: Add `runsToday` to the sort memo deps**

In the dependency array at lines 381–391, add `runsToday` (after `isNowOpen`):

```ts
  }, [
    venues,
    search,
    selectedNeighborhoods,
    selectedDays,
    selectedTypes,
    selectedTags,
    happeningNow,
    isNowOpen,
    runsToday,
    sortKey,
  ]);
```

- [ ] **Step 6: Mute non-today desktop rows + pass `tzNow`**

In the desktop `withHours.map` callback, the `tzNow` const already exists (line 721). Add a `muted` flag right after `const live = isNowOpen(v);` (line 703):

```ts
                  const today = runsToday(v);
                  const muted = !live && !today;
```

Change the `<tr>` opening tag (lines 725–729) to append the muting class:

```tsx
                    <tr
                      key={v.id}
                      className={`border-t border-border hover:bg-row-hover${muted ? " opacity-60" : ""}`}
                      style={rowStyle}
                    >
```

Change the window cell call (line 768) from `displayBounds(v, activeW)` to:

```tsx
                        {formatWindow(displayBounds(v, activeW, tzNow))}
```

- [ ] **Step 7: Mute non-today mobile cards + pass `tzNow`**

In the mobile `withHours.map` callback, add after `const live = isNowOpen(v);` (line 808):

```ts
              const today = runsToday(v);
              const muted = !live && !today;
```

Change the card `<div>` opening (lines 828–832) to append muting:

```tsx
                <div
                  key={v.id}
                  className={`rounded-lg border border-border bg-bg-surface px-4 py-3${muted ? " opacity-60" : ""}`}
                  style={cardStyle}
                >
```

Change the window call (line 858) from `displayBounds(v, activeW)` to:

```tsx
                      {formatWindow(displayBounds(v, activeW, tzNow))}
```

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS — no new errors (the two pre-existing Phase 0 issues remain; nothing else).

- [ ] **Step 9: Commit**

```bash
git add components/venue-table-client.tsx
git commit -m "feat(grid): resolve today's HH times, tier by relevance, mute non-today

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run every relevant unit script**

Run: `npm run test:resolve && npm run test:format-by-day && npm run test:format && npm run test:active && npm run test:hours`
Expected: all PASS (the latter three confirm we didn't break existing format/timezone behavior).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: typecheck/lint clean except the two known pre-existing Phase 0 issues; `next build` compiles (a benign Turbopack NFT file-trace warning from the upload store is unrelated).

- [ ] **Step 3: Manual dev check (the grid + venue page have no React test harness)**

Run (requires Docker Postgres up + a seeded venue with `hours_json`, e.g. a Tacoma confirmed venue):

```bash
docker compose up -d
npm run dev
```

Verify at `http://localhost:3000/tacoma`:
- A venue whose happy hour runs today shows a concrete close time (e.g. "3 PM – 10 PM"), not "3 PM – close".
- A venue with `hours_json = null` still shows "… – close" (no invented time).
- Non-today venues appear muted and sorted below live/today venues; live venues keep the pulse and sort first.
- On a venue detail page with a multi-day until-close window, the card shows per-day lines (e.g. "Monday – Thursday 3 PM – 10 PM" and "Friday 3 PM – 12 AM").

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test: verify HH time resolution across grid + venue page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Resolver (§1) → Task 1. Grid day-aware bounds + tiered sort + muting, no chips (§2) → Task 4. Detail per-day grouping (§3) → Tasks 2–3. Tests (§4) → Tasks 1, 2, 5. Out-of-scope items (hours_json refresh, JSON-LD) are not touched.
- **Type consistency:** `resolveBoundsForDay(w, hours, isoDay)` and `formatWindowByDay(window, hours)` signatures match every call site (page Task 3, grid Task 4, both test scripts). `VenueLocalNow` imported as a type in the grid. `displayBounds` third arg `tzNow: VenueLocalNow | null` matches the existing `tzNow` consts at the two call sites.
- **No invented data:** every resolution path returns `null` → text fallback when hours are missing/unpublished; verified by Task 1 tests and the Task 5 manual `hours_json = null` check.
