# All-day Happy-Hour Scrutiny + Close-Time Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unreliable "all-day" happy hours: harden the seed extractor against all-day false positives, bound "happening now" by real venue close times, and run a one-time operator-gated cleanup of existing all-day rows.

**Architecture:** Three independent phases, built in order **B → C → A**. (B) prompt + a code backstop in the extractor's normaliser. (C) a new `venues.hours_json` column fed by Google Place Details, consumed by a hours-aware `isWindowActive` that *suppresses* a "now" claim when close time is unknown. (A) a standalone `reverify:all-day` script that runs an independent, disconfirmation-biased AI pass over existing all-day rows, emits a report, and applies operator-approved corrections through an audited transaction.

**Tech Stack:** TypeScript (strict), Drizzle ORM + drizzle-kit migrations, postgres.js (scripts), Anthropic SDK with server-side `web_fetch`/`web_search`, tsx. **No test framework** — unit checks are standalone `scripts/test-*.ts` files run with `npx tsx`, using `node:assert/strict` and a `check(name, fn)` helper that exits non-zero on failure (see `scripts/test-venue-type.ts` for the canonical style).

**Conventions every task follows:**
- Acceptance gate after code changes: `npm run typecheck` and `npm run lint` must stay clean (two pre-existing Phase-0 lint warnings in `db/schema/moderation.ts` + `scripts/import-neighborhoods.ts` are known and allowed).
- The DB is live (Docker `hhf-postgres`, db name `happyhourfriends`, compose service `db`). `psql` access: `docker compose exec -T db psql "postgresql://hhf:hhf@localhost:5432/happyhourfriends" -c "<sql>"`.
- Day-of-week is ISO 1=Mon..7=Sun everywhere. Times are venue-local "HH:MM[:SS]".

---

## Phase B — Extractor hardening

### Task B1: Code backstop — drop all-day windows spanning ≥3 days

**Files:**
- Test: `scripts/test-extract-allday.ts` (create)
- Modify: `lib/ai/extractHappyHours.ts` (`normaliseHappyHour`, ~L299-344)
- Modify: `package.json` (add `test:extract` script)

- [ ] **Step 1: Add the test script entry**

In `package.json` `scripts`, after the `"test:email"` line, add:

```json
    "test:extract": "tsx scripts/test-extract-allday.ts",
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-extract-allday.ts`:

```ts
/**
 * Runnable unit checks for the extractor's all-day policy backstop (no test framework
 * in repo). Run: npx tsx scripts/test-extract-allday.ts — exits non-zero on any failure.
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
function allDayWindow(days: number[]) {
  return {
    happyHours: [
      { daysOfWeek: days, allDay: true, startTime: null, endTime: null, sourceUrl: SRC, offerings: [] },
    ],
    confidence: 0.9,
    summary: "x",
  };
}

check("all-day on 1 day is kept", () => {
  const r = normaliseRawExtract(allDayWindow([1]));
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].allDay, true);
});

check("all-day on 2 days is kept", () => {
  const r = normaliseRawExtract(allDayWindow([1, 2]));
  assert.equal(r.happyHours.length, 1);
});

check("all-day on 3 days is dropped", () => {
  const r = normaliseRawExtract(allDayWindow([1, 2, 3]));
  assert.equal(r.happyHours.length, 0);
});

check("all-day on all 7 days is dropped", () => {
  const r = normaliseRawExtract(allDayWindow([1, 2, 3, 4, 5, 6, 7]));
  assert.equal(r.happyHours.length, 0);
});

check("a windowed (non-all-day) deal on 7 days is unaffected", () => {
  const r = normaliseRawExtract({
    happyHours: [
      { daysOfWeek: [1, 2, 3, 4, 5, 6, 7], allDay: false, startTime: "16:00", endTime: "18:00", sourceUrl: SRC, offerings: [] },
    ],
    confidence: 0.9,
    summary: "x",
  });
  assert.equal(r.happyHours.length, 1);
  assert.equal(r.happyHours[0].allDay, false);
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/test-extract-allday.ts`
Expected: FAIL on "all-day on 3 days is dropped" (it is currently kept → length 1, assertion expects 0).

- [ ] **Step 4: Implement the backstop**

In `lib/ai/extractHappyHours.ts`, inside `normaliseHappyHour`, immediately after the `allDay` constant is computed (`const allDay = raw.allDay === true;`, ~L308) and after `daysOfWeek` is built (~L303-306), add:

```ts
  // Policy backstop (2026-05-31): a credible "all day" deal is a narrow,
  // explicitly-sourced industry-night pattern on ≤2 specific days. An all-day claim
  // spanning 3+ days is almost always regular pricing or a fallback the model reached
  // for when it couldn't find a time window — not a happy hour. Drop it regardless of
  // what the model emitted. Mirrors lib/places/chainDenylist: enforce policy in code,
  // not just the prompt. See docs/superpowers/specs/2026-05-31-all-day-happy-hour-scrutiny-design.md.
  if (allDay && daysOfWeek.length >= 3) return null;
```

(Place it after both `daysOfWeek` and `allDay` are in scope — i.e. just below the `const allDay = ...` line.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-extract-allday.ts`
Expected: PASS — "5 checks passed."

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean (no new errors).

- [ ] **Step 7: Commit**

```bash
git add lib/ai/extractHappyHours.ts scripts/test-extract-allday.ts package.json
git commit -m "feat(extract): drop all-day HH windows spanning 3+ days (policy backstop)"
```

---

### Task B2: Prompt v9 — define happy hour, constrain all-day

**Files:**
- Modify: `prompts/seed-extract-hh.md` (frontmatter + HARD RULES + `allDay` field rule)

- [ ] **Step 1: Bump frontmatter**

In `prompts/seed-extract-hh.md`, change `version: 8` to `version: 9` and prepend to `notes:` (keep the existing text after it):

```
v9 — define happy hour as a RECURRING, TIME-LIMITED discount; an all-open-hours-every-day deal is regular pricing (omit); one-off coupons/limited promos are not happy hours (omit); allDay restricted to ≤2 explicitly-sourced specific days (never most/all week).
```

- [ ] **Step 2: Add the definition to HARD RULES**

In the `HARD RULES` list (after the existing "Do NOT extrapolate…" bullet, ~L25-28), add two bullets:

```
- A happy hour is a RECURRING, TIME-LIMITED discount (a window during off-peak hours, or
  an explicit all-day deal on a specific day). A discount available during ALL open hours
  EVERY day is just the venue's regular pricing — it is NOT a happy hour. Do NOT record it.
- A one-time coupon, a "today only" promo, or a limited-time event is NOT a recurring happy
  hour. Do NOT record it. If the only thing you find is a printable coupon or a single-date
  promo, record happyHours: [] with confidence 0.
```

- [ ] **Step 3: Rewrite the `allDay` field rule**

Replace the existing `allDay` bullet (the paragraph starting "`allDay` is a **positive assertion**…", ~L64-69) with:

```
- `allDay` is a **positive assertion** that the deal runs the full open hours of the
  listed days. Set `allDay: true` ONLY when the page explicitly says so for a SPECIFIC,
  NARROW set of days — at most TWO days (e.g. "Monday all day", "Tue & Wed all damn day").
  This is the industry-night pattern. When `allDay: true`, set both `startTime` and
  `endTime` to null. NEVER set `allDay: true` across most or all days of the week — an
  "all day, every day" deal is regular pricing, not a happy hour (omit it). Do NOT use
  `allDay: true` as a fallback when you couldn't find a time window; if you can't tell
  whether a deal is windowed or all-day, omit that entry.
```

- [ ] **Step 4: Mirror the constraint in the tool-schema description (defense in depth)**

In `lib/ai/extractHappyHours.ts`, update the `allDay` property `description` in `RECORD_TOOL.input_schema` (~L151-155) to:

```ts
            allDay: {
              type: "boolean",
              description:
                "True ONLY when the page explicitly states an all-open-hours deal on a SPECIFIC, NARROW set of days (at most 2, e.g. 'Monday all day'). Never for most/all days of the week (that's regular pricing, not a happy hour). When true, startTime and endTime MUST be null. Never a fallback when times are unknown.",
            },
```

- [ ] **Step 5: Typecheck (string edit only)**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add prompts/seed-extract-hh.md lib/ai/extractHappyHours.ts
git commit -m "feat(prompt): seed-extract v9 — define HH, constrain all-day to <=2 days"
```

---

## Phase C — Close-time hardening ("now" must never show while closed)

### Task C1: Add `venues.hours_json` column + migration

**Files:**
- Modify: `db/schema/core.ts` (`venues` table, near `heroImageUrl`, ~L127)
- Generate: `db/migrations/0011_*.sql` (latest applied is `0010`)

- [ ] **Step 1: Add the column to the schema**

First add a type-only import at the top of `db/schema/core.ts` (after the existing imports; `OpenPeriod` is defined in Task C3 — **build C3 first**):

```ts
import type { OpenPeriod } from "@/lib/geo/timezone";
```

Then in the `venues` table definition, directly after the `heroImageUrl` column (~L127), add:

```ts
    // Venue operating hours (Google Place Details regularOpeningHours), normalized to
    // ISO weekdays. Drives close-time bounding for "happening now" on all-day / until-
    // close windows. Null when unknown → such windows can't be shown active. Typed with
    // .$type so VenueRow.hoursJson is OpenPeriod[]|null (not unknown) and flows cleanly
    // through the venue queries into isWindowActive.
    hoursJson: jsonb("hours_json").$type<OpenPeriod[]>(),
```

(`jsonb` is already imported in `core.ts`. A type-only import of `OpenPeriod` does not create a runtime cycle — `lib/geo/timezone.ts` imports nothing from `db/schema` — and is erased before drizzle-kit reads the schema.)

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `db/migrations/0011_*.sql` containing `ALTER TABLE "venues" ADD COLUMN "hours_json" jsonb;`.

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: migration `0011` applied, no error.

- [ ] **Step 4: Verify the column exists**

Run: `docker compose exec -T db psql "postgresql://hhf:hhf@localhost:5432/happyhourfriends" -c "\d venues" | grep hours_json`
Expected: a line showing `hours_json | jsonb`.

- [ ] **Step 5: Commit**

```bash
git add db/schema/core.ts db/migrations/0011_*.sql db/migrations/meta
git commit -m "feat(schema): add venues.hours_json for close-time bounding"
```

---

### Task C2: Parse Google opening hours (pure, tested) + capture in Place Details

**Files:**
- Test: `scripts/test-opening-hours.ts` (create)
- Modify: `lib/places/placeDetails.ts` (field mask + parse + `PlaceDetails` type)
- Modify: `package.json` (add `test:hours` script)

The structured period shape lives in `lib/geo/timezone.ts` (Task C3 defines `OpenPeriod`), but the *parser* lives with the Place Details fetch. To avoid a circular dependency, define the type in `timezone.ts` and import it here.

- [ ] **Step 1: Add the test script entry**

In `package.json` `scripts`, after `"test:extract"`, add:

```json
    "test:hours": "tsx scripts/test-opening-hours.ts",
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-opening-hours.ts`:

```ts
/**
 * Unit checks for Google regularOpeningHours → ISO OpenPeriod[] parsing.
 * Run: npx tsx scripts/test-opening-hours.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { parseRegularOpeningHours } from "@/lib/places/placeDetails";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("undefined input → null", () => {
  assert.equal(parseRegularOpeningHours(undefined), null);
});

check("empty periods → null", () => {
  assert.equal(parseRegularOpeningHours({ periods: [] }), null);
});

check("Mon 11:00–22:00 maps to ISO day 1, minutes", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 1, hour: 11, minute: 0 }, close: { day: 1, hour: 22, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 1, openMin: 660, closeDay: 1, closeMin: 1320 }]);
});

check("Google Sunday (day 0) maps to ISO 7", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 0, hour: 9, minute: 30 }, close: { day: 0, hour: 14, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 7, openMin: 570, closeDay: 7, closeMin: 840 }]);
});

check("past-midnight close keeps both ISO days", () => {
  // Fri 17:00 → Sat 02:00
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 5, hour: 17, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 5, openMin: 1020, closeDay: 6, closeMin: 120 }]);
});

check("24h venue (open, no close) → closeDay/closeMin null", () => {
  const out = parseRegularOpeningHours({
    periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
  });
  assert.deepEqual(out, [{ openDay: 7, openMin: 0, closeDay: null, closeMin: null }]);
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/test-opening-hours.ts`
Expected: FAIL — `parseRegularOpeningHours` is not exported yet (import error / not a function).

- [ ] **Step 4: Implement the parser + wire it into the fetch**

In `lib/places/placeDetails.ts`:

(a) Add the import at the top (after the file header comment / `const ENDPOINT`):

```ts
import type { OpenPeriod } from "@/lib/geo/timezone";
```

(b) Add the exported pure parser (place it after the `PRICE_LEVEL` map):

```ts
/** Google regularOpeningHours weekday is 0=Sun..6=Sat; convert to ISO 1=Mon..7=Sun. */
function googleDayToIso(day: number): number {
  return day === 0 ? 7 : day;
}

interface RawOpenPoint {
  day?: number;
  hour?: number;
  minute?: number;
}
interface RawRegularOpeningHours {
  periods?: { open?: RawOpenPoint; close?: RawOpenPoint }[];
}

/**
 * Convert Google `regularOpeningHours.periods` into our ISO-weekday OpenPeriod[].
 * Returns null when there is nothing usable. A period with an `open` but no `close`
 * (Google's 24h representation) yields closeDay/closeMin = null.
 */
export function parseRegularOpeningHours(
  raw: RawRegularOpeningHours | undefined | null,
): OpenPeriod[] | null {
  const periods = raw?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const out: OpenPeriod[] = [];
  for (const p of periods) {
    if (!p.open || typeof p.open.day !== "number") continue;
    const openDay = googleDayToIso(p.open.day);
    const openMin = (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
    let closeDay: number | null = null;
    let closeMin: number | null = null;
    if (p.close && typeof p.close.day === "number") {
      closeDay = googleDayToIso(p.close.day);
      closeMin = (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0);
    }
    out.push({ openDay, openMin, closeDay, closeMin });
  }
  return out.length > 0 ? out : null;
}
```

(c) Add `regularOpeningHours` to the field mask (~L56-58). Change:

```ts
        "X-Goog-FieldMask":
          "websiteUri,nationalPhoneNumber,priceLevel,primaryType," +
          "servesBeer,servesWine,servesCocktails,photos",
```

to:

```ts
        "X-Goog-FieldMask":
          "websiteUri,nationalPhoneNumber,priceLevel,primaryType," +
          "servesBeer,servesWine,servesCocktails,photos,regularOpeningHours",
```

(d) Add `openingPeriods` to the `PlaceDetails` interface (after `primaryType`):

```ts
  /** Venue operating hours as ISO-weekday OpenPeriod[], or null when unknown. */
  openingPeriods: OpenPeriod[] | null;
```

(e) In the JSON parse (`const data = (await res.json()) as {...}`), add to the type literal:

```ts
      regularOpeningHours?: RawRegularOpeningHours;
```

and add to the returned object (after `primaryType:`):

```ts
      openingPeriods: parseRegularOpeningHours(data.regularOpeningHours),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-opening-hours.ts`
Expected: PASS — "6 checks passed." (Requires Task C3's `OpenPeriod` type to exist; if you are doing C2 before C3, do Task C3 Step 1 first — it is a pure type/function with its own test. Recommended order: C3 Step 1-? then C2. If `OpenPeriod` is missing, the import fails — implement it in C3 first.)

> **Ordering note:** `OpenPeriod` is defined in `lib/geo/timezone.ts` (Task C3). Do **Task C3 first**, then C2. The plan lists C2 before C3 only because capture and consumption read naturally together; build C3 first so the type exists.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/places/placeDetails.ts scripts/test-opening-hours.ts package.json
git commit -m "feat(places): capture + parse Google opening hours into ISO OpenPeriod[]"
```

---

### Task C3: Hours-aware `isWindowActive` — suppress when close unknown (BUILD FIRST in Phase C)

**Files:**
- Test: `scripts/test-timezone-active.ts` (create)
- Modify: `lib/geo/timezone.ts` (add `OpenPeriod`, `isVenueOpenAt`, extend `isWindowActive`)
- Modify: `package.json` (add `test:active` script)

- [ ] **Step 1: Add the test script entry**

In `package.json` `scripts`, after `"test:hours"`, add:

```json
    "test:active": "tsx scripts/test-timezone-active.ts",
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-timezone-active.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/test-timezone-active.ts`
Expected: FAIL — `OpenPeriod` is not exported / `isWindowActive` ignores the third arg (e.g. "all-day NOT active after close" returns true today).

- [ ] **Step 4: Implement the type, the open-check, and the new active logic**

In `lib/geo/timezone.ts`:

(a) Add the `OpenPeriod` type and an `isVenueOpenAt` helper (place after `toMinutes`, before `HappyHourWindow`):

```ts
/**
 * A single operating-hours period in ISO-weekday terms. openDay/closeDay are 1=Mon..7=Sun.
 * closeDay/closeMin are null for a venue with no published close (treated as open all that
 * day — Google's 24h representation).
 */
export interface OpenPeriod {
  openDay: number;
  openMin: number;
  closeDay: number | null;
  closeMin: number | null;
}

/** Is the venue open at `now` given its operating periods? */
export function isVenueOpenAt(periods: OpenPeriod[], now: VenueLocalNow): boolean {
  for (const p of periods) {
    // No close published → treat as open the whole open day (24h / unknown close).
    if (p.closeDay === null || p.closeMin === null) {
      if (now.dayOfWeek === p.openDay) return true;
      continue;
    }
    const sameDay = p.closeDay === p.openDay && p.closeMin > p.openMin;
    if (sameDay) {
      if (now.dayOfWeek === p.openDay && now.minutes >= p.openMin && now.minutes < p.closeMin) {
        return true;
      }
      continue;
    }
    // Crosses midnight (closes on a later day, or close minutes ≤ open minutes):
    // open late on the open day, or early on the close day.
    const lateOnOpenDay = now.dayOfWeek === p.openDay && now.minutes >= p.openMin;
    const earlyOnCloseDay = now.dayOfWeek === p.closeDay && now.minutes < p.closeMin;
    if (lateOnOpenDay || earlyOnCloseDay) return true;
  }
  return false;
}
```

(b) Replace the body of `isWindowActive` so it takes optional `hours` and suppresses unbounded windows when hours are unknown. Replace the whole function (currently ~L64-88) with:

```ts
export function isWindowActive(
  w: HappyHourWindow,
  now: VenueLocalNow,
  hours?: OpenPeriod[] | null,
): boolean {
  // Unbounded windows — all-day, or "until close" (endTime null) — have no intrinsic end.
  // We can only assert them active if we know the venue's hours; otherwise SUPPRESS
  // (never guess a close time — showing "now" while the venue is shut is the bug we fix).
  const unbounded = w.allDay || w.endTime == null;
  if (unbounded) {
    if (!hours || hours.length === 0) return false;
    if (!isVenueOpenAt(hours, now)) return false;
    if (w.allDay) return w.daysOfWeek.includes(now.dayOfWeek);
    // until-close: startTime is non-null (DB CHECK). Active on a listed start day, from
    // start onward, while the venue is open. (The rare post-midnight tail is intentionally
    // not extended — under-reporting late-night is acceptable; over-reporting "open" is not.)
    if (w.startTime === null) return false; // defensive
    return w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= toMinutes(w.startTime);
  }

  // Bounded window (both start and end known) — unchanged, independent of hours.
  if (w.startTime === null) return false; // defensive
  const start = toMinutes(w.startTime);
  const end = toMinutes(w.endTime as string);
  const crosses = w.crossesMidnight ?? end < start;

  if (!crosses) {
    return w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= start && now.minutes < end;
  }
  const lateOnStartDay = w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= start;
  const prevDay = now.dayOfWeek === 1 ? 7 : now.dayOfWeek - 1;
  const earlyNextDay = w.daysOfWeek.includes(prevDay) && now.minutes < end;
  return lateOnStartDay || earlyNextDay;
}
```

(Note: the bounded branch is now only reached when `endTime` is a real time, so `end` is always defined — the old `w.endTime == null ? 24*60` fallback is deliberately gone; null-end is handled above as unbounded.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-timezone-active.ts`
Expected: PASS — "11 checks passed."

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/geo/timezone.ts scripts/test-timezone-active.ts package.json
git commit -m "feat(geo): hours-aware isWindowActive; suppress 'now' when close unknown"
```

---

### Task C4: Persist hours on enrich; select + thread to the client

**Files:**
- Modify: `scripts/seed-enrich-candidates.ts` (venue upsert sites)
- Modify: `lib/queries/venues.ts` (`VenueListItem` + list select + row map)
- Modify: `components/venue-table-client.tsx` (pass `v.hoursJson` to `isWindowActive` / `minutesUntilWindowEnd`)

This task is wiring; its behavior is already covered by Task C3's unit tests. Verification is `typecheck` + `build`.

- [ ] **Step 1: Persist `hours_json` on enrich**

In `scripts/seed-enrich-candidates.ts`, the venue is written from a `PlaceDetails` value (`details`) at the upsert. Add `hours_json` to the venue insert/update. In `insertVenueRow` (~L143-186) the INSERT column list and `onConflict ... SET` must include `hours_json`. Add the value from the enrich context:

- Find where `details?.priceLevel` is passed into the insert context (the two enrich branches at ~L506 and ~L838 build the row context). Add alongside `priceLevel`:

```ts
          hoursJson: details?.openingPeriods ?? null,
```

- In `insertVenueRow`, add `hours_json` to the INSERT columns and VALUES (it is a `jsonb` column — pass via `${sql.json(ctx.hoursJson)}` using postgres.js JSON helper), and to the `ON CONFLICT ... DO UPDATE SET` clause so re-enrich refreshes it. Mirror exactly how `price_level` is threaded in that function. Add `hoursJson` to the `ctx` parameter type.

> Exact lines depend on the current `insertVenueRow` body — read `scripts/seed-enrich-candidates.ts:143-205` first and mirror the `price_level` plumbing for `hours_json`. Use `sql.json(...)` for the jsonb value.

- [ ] **Step 2: Select `hours_json` in the venue list query**

In `lib/queries/venues.ts`:

(a) Add `"hoursJson"` to the `Pick<VenueRow, …>` union that `VenueListItem extends` (the list ends with `| "heroImageUrl"`, ~L31). Because the column is `.$type<OpenPeriod[]>()` (Task C1), this gives `VenueListItem.hoursJson: OpenPeriod[] | null` with no extra field declaration and no separate import:

```ts
    | "heroImageUrl"
    | "hoursJson"
```

(b) Add to the `.select({...})` inside `listVenuesForCity` (after the `timezone:` line, ~L184):

```ts
      hoursJson: venues.hoursJson,
```

The final `return rows.map((r) => ({ ...r, … }))` (~L292-305) spreads `r`, so `hoursJson` flows through unchanged — no cast needed, and the spread keys it adds (`neighborhoodName`, `happyHours`, etc.) don't include `hoursJson`, so it isn't overridden.

(c) The single-venue path (`assembleVenueDetail` → `VenueDetail extends VenueRow`) already inherits `hoursJson` from `VenueRow` via `...venue`. The venue page uses `allDay` only for display grouping, not `isWindowActive`, so it needs no change — confirm with a grep for `isWindowActive` in `app/[city]/venue/[slug]/page.tsx` (expected: no match).

- [ ] **Step 3: Thread hours into the client active check**

In `components/venue-table-client.tsx`, the `activeWindow` `useCallback` (~L208-217) is the only `isWindowActive` caller and has the venue `v` in scope. Change its final line from:

```ts
      return v.happyHours.find((h) => isWindowActive(h, now)) ?? null;
```

to:

```ts
      return v.happyHours.find((h) => isWindowActive(h, now, v.hoursJson)) ?? null;
```

`minutesUntilWindowEnd` does not need hours (it returns null for all-day / until-close already), so leave those calls (~L690, ~L826) as-is unless typecheck demands the arg.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean. Fix any type mismatch (e.g. `hoursJson` typed as `unknown` from Drizzle `jsonb` — cast in the query map with `as OpenPeriod[] | null`).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compiles (the known benign Turbopack NFT file-trace warning is allowed).

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-enrich-candidates.ts lib/queries/venues.ts components/venue-table-client.tsx
git commit -m "feat: persist + serve venue hours; bound live 'now' badge by close time"
```

---

### Task C5: One-time `backfill:hours` for existing venues

**Files:**
- Create: `scripts/backfill-hours.ts`
- Modify: `package.json` (add `backfill:hours` script)

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, after `"backfill:place-ids"`, add:

```json
    "backfill:hours": "tsx scripts/backfill-hours.ts",
```

- [ ] **Step 2: Write the backfill script**

Create `scripts/backfill-hours.ts`:

```ts
/**
 * Backfill venues.hours_json from Google Place Details for venues that have a
 * google_place_id. After the close-time hardening, all-day / until-close windows stay
 * SUPPRESSED (no "now" badge) until a venue has hours — this restores them.
 *
 * Run: npx tsx scripts/backfill-hours.ts [--city <slug>] [--limit N] [--dry-run]
 * Requires GOOGLE_PLACES_API_KEY + DATABASE_URL.
 */
import "dotenv/config";
import postgres from "postgres";
import { fetchPlaceDetails, PlaceDetailsQuotaError } from "@/lib/places/placeDetails";

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
if (!API_KEY) { console.error("GOOGLE_PLACES_API_KEY is not set"); process.exit(1); }

const args = process.argv.slice(2);
const argValue = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const citySlug = argValue("--city");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const dryRun = args.includes("--dry-run");

const sql = postgres(DATABASE_URL, { max: 4 });

async function main() {
  const rows = await sql<{ id: string; google_place_id: string; name: string }[]>`
    SELECT v.id, v.google_place_id, v.name
    FROM venues v
    ${citySlug ? sql`JOIN cities c ON c.id = v.city_id` : sql``}
    WHERE v.google_place_id IS NOT NULL
      AND v.hours_json IS NULL
      AND v.deleted_at IS NULL
      ${citySlug ? sql`AND c.slug = ${citySlug}` : sql``}
    ORDER BY v.name
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;

  console.log(`${dryRun ? "[dry-run] " : ""}${rows.length} venue(s) to backfill…`);
  let updated = 0, noHours = 0;
  for (const r of rows) {
    let details;
    try {
      details = await fetchPlaceDetails(API_KEY!, r.google_place_id);
    } catch (e) {
      if (e instanceof PlaceDetailsQuotaError) { console.error(`ABORT: ${e.message}`); break; }
      throw e;
    }
    const periods = details?.openingPeriods ?? null;
    if (!periods) { noHours++; console.log(`  – ${r.name}: no hours`); continue; }
    if (!dryRun) {
      await sql`UPDATE venues SET hours_json = ${sql.json(periods)} WHERE id = ${r.id}`;
    }
    updated++;
    console.log(`  ✓ ${r.name}: ${periods.length} period(s)`);
  }
  console.log(`\nDone. ${updated} updated, ${noHours} had no hours.`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Dry-run (operator, needs key)**

Run: `npm run backfill:hours -- --city phoenix --dry-run`
Expected: prints a count and per-venue hours/no-hours lines; no DB writes. (Skip if `GOOGLE_PLACES_API_KEY` is unset — the script exits with a clear message.)

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-hours.ts package.json
git commit -m "feat(scripts): backfill:hours — populate venues.hours_json from Place Details"
```

---

### Task C6: Verify AZ venue timezones (prerequisite check, not new code)

**Files:** none (operational verification).

- [ ] **Step 1: Check timezones for the AZ cities**

Run:
```bash
docker compose exec -T db psql "postgresql://hhf:hhf@localhost:5432/happyhourfriends" -c "SELECT c.slug, v.timezone, count(*) FROM venues v JOIN cities c ON c.id=v.city_id WHERE c.slug IN ('phoenix','tucson','scottsdale') GROUP BY 1,2 ORDER BY 1,2;"
```
Expected: timezone should be `America/Phoenix` for all AZ venues.

- [ ] **Step 2: If any AZ venue shows a wrong/`null` tz, run the existing backfill**

Only if Step 1 shows a problem (note `backfill:timezones` only fills `NULL`; for a *wrong* non-null tz, first null them out for those cities, then backfill):
```bash
npm run backfill:timezones -- --city phoenix
npm run backfill:timezones -- --city tucson
npm run backfill:timezones -- --city scottsdale
```
Then re-run Step 1 to confirm `America/Phoenix`. No commit (data change), but note the outcome in the session log.

---

## Phase A — Adversarial review of existing all-day rows

### Task A1: Verdict → action policy (pure, tested)

**Files:**
- Create: `lib/reverify/policy.ts`
- Test: `scripts/test-reverify-policy.ts`
- Modify: `package.json` (add `test:reverify` script)

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, after `"test:active"`, add:

```json
    "test:reverify": "tsx scripts/test-reverify-policy.ts",
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-reverify-policy.ts`:

```ts
/**
 * Unit checks for the all-day reverify verdict→action policy.
 * Run: npx tsx scripts/test-reverify-policy.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { recommendAction, type Verdict } from "@/lib/reverify/policy";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const base = { quote: "…", sourceUrl: "https://x.com", servesAlcohol: true, reasoning: "r" };

check("real_window → correct", () =>
  assert.equal(recommendAction({ ...base, kind: "real_window", startTime: "16:00", endTime: "18:00", daysOfWeek: [1, 2, 3, 4, 5] } as Verdict), "correct"));
check("legit_all_day ≤2 days → keep", () =>
  assert.equal(recommendAction({ ...base, kind: "legit_all_day", daysOfWeek: [1, 2] } as Verdict), "keep"));
check("legit_all_day 3+ days → stub (not a real all-day HH)", () =>
  assert.equal(recommendAction({ ...base, kind: "legit_all_day", daysOfWeek: [1, 2, 3] } as Verdict), "stub"));
check("not_happy_hour + not a drinks venue → delete_venue", () =>
  assert.equal(recommendAction({ ...base, servesAlcohol: false, kind: "not_happy_hour" } as Verdict), "delete_venue"));
check("not_happy_hour but drinks venue → stub", () =>
  assert.equal(recommendAction({ ...base, servesAlcohol: true, kind: "not_happy_hour" } as Verdict), "stub"));
check("unconfirmable → stub", () =>
  assert.equal(recommendAction({ ...base, kind: "unconfirmable" } as Verdict), "stub"));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/test-reverify-policy.ts`
Expected: FAIL — module `@/lib/reverify/policy` does not exist.

- [ ] **Step 4: Implement the policy**

Create `lib/reverify/policy.ts`:

```ts
/**
 * Verdict → recommended action for the one-time all-day reverify pass (Phase A).
 * Pure + deterministic so it's unit-testable without network/AI. See
 * docs/superpowers/specs/2026-05-31-all-day-happy-hour-scrutiny-design.md.
 */

export type Verdict =
  | { kind: "real_window"; startTime: string; endTime: string | null; daysOfWeek: number[]; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string }
  | { kind: "legit_all_day"; daysOfWeek: number[]; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string }
  | { kind: "not_happy_hour"; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string }
  | { kind: "unconfirmable"; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string };

/** correct = fix to a real window; keep = leave as legit all-day; stub = drop window, keep venue; delete_venue = recommend removing the venue. */
export type Action = "correct" | "keep" | "stub" | "delete_venue";

export function recommendAction(v: Verdict): Action {
  switch (v.kind) {
    case "real_window":
      return "correct";
    case "legit_all_day":
      // A genuine all-day deal is only credible on ≤2 specific days (industry-night).
      return v.daysOfWeek.length <= 2 ? "keep" : "stub";
    case "not_happy_hour":
      // Clear non-HH place (no alcohol / pure coupon) → recommend deletion; an otherwise
      // plausible drinks venue keeps its listing as a help-wanted stub.
      return v.servesAlcohol ? "stub" : "delete_venue";
    case "unconfirmable":
      // No quotable schedule on any source → can't keep the all-day claim; keep the venue
      // as a stub (it was a plausible-enough HH spot to have been listed).
      return "stub";
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-reverify-policy.ts`
Expected: PASS — "6 checks passed."

- [ ] **Step 6: Commit**

```bash
git add lib/reverify/policy.ts scripts/test-reverify-policy.ts package.json
git commit -m "feat(reverify): all-day verdict→action policy (pure, tested)"
```

---

### Task A2: Adversarial verifier (prompt + runner + parse test)

**Files:**
- Create: `prompts/reverify-all-day.md`
- Create: `lib/reverify/adversarial.ts`
- Test: `scripts/test-reverify-parse.ts`
- Modify: `package.json` (add `test:reverify-parse` script)

- [ ] **Step 1: Write the adversarial prompt**

Create `prompts/reverify-all-day.md`:

```markdown
---
prompt: reverify-all-day
version: 1
model: claude-sonnet-4-6
notes: Disconfirmation-biased re-check of an existing all-day HH claim. Forces a structured verdict via record_verdict. Independent of seed-extract-hh (do NOT reuse its logic) — the point is an adversarial second opinion.
---

# System

You are auditing a happy-hour listing that our database currently records as an
"ALL DAY" deal. All-day claims are frequently WRONG — they are often (a) a one-time
coupon or standing discount that is not a happy hour at all, or (b) a real happy hour
that actually runs a bounded time window, mis-recorded as all-day. **Your default
stance is skepticism: assume the all-day claim is wrong until a first-party source
proves otherwise, in its own words.**

A happy hour is a RECURRING, TIME-LIMITED discount. A discount available during all
open hours every day is regular pricing, NOT a happy hour. A printable coupon or a
single-date promo is NOT a happy hour.

You have two tools: web_fetch (renders pages + PDFs) and web_search. Fetch the venue's
own site and its happy-hour / specials / menu pages; follow links and open PDFs. You may
web_search for the venue's happy hour to find the first-party page.

Then call `record_verdict` EXACTLY ONCE. You must choose one verdict:

- `real_window` — the source gives actual start/end times for the happy hour. Provide
  startTime/endTime (24h "HH:MM"; endTime null only if it literally says "until close")
  and the days it runs.
- `legit_all_day` — the source EXPLICITLY describes an all-day deal on a SPECIFIC, NARROW
  set of days (≤2 days, e.g. "Monday all day"). Provide those days.
- `not_happy_hour` — what you found is a coupon, a standing/everyday discount, or a
  one-off promo — not a recurring time-limited happy hour.
- `unconfirmable` — you could not find any quotable happy-hour schedule on a first-party
  source.

HARD RULES:
- For `real_window` and `legit_all_day` you MUST include a VERBATIM `quote` (copied
  exactly from the page) and the `sourceUrl` you read it on. No quote → you may not use
  those verdicts; use `unconfirmable` instead.
- NEVER invent times or days. If the page doesn't say it, you don't know it.
- Also report `servesAlcohol`: true if the venue clearly serves alcohol (drinks menu,
  bar, cocktails/beer/wine), false if it appears to be a place that does not.
- Report nothing as prose — only the `record_verdict` tool call.

# User

Venue: {{venue_name}}
Address: {{address}}
Venue website: {{website_url}}
Currently recorded as ALL DAY on days (ISO 1=Mon..7=Sun): {{current_days}}
Known source on file: {{source_url}}
```

- [ ] **Step 2: Add the parse-test npm script**

In `package.json` `scripts`, after `"test:reverify"`, add:

```json
    "test:reverify-parse": "tsx scripts/test-reverify-parse.ts",
```

- [ ] **Step 3: Write the failing parse test**

Create `scripts/test-reverify-parse.ts`:

```ts
/**
 * Unit checks for parsing the record_verdict tool call into a typed Verdict.
 * Run: npx tsx scripts/test-reverify-parse.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { parseVerdict } from "@/lib/reverify/adversarial";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

function msgWith(input: unknown) {
  return { content: [{ type: "tool_use", name: "record_verdict", input }] } as never;
}

check("parses a real_window verdict", () => {
  const v = parseVerdict(msgWith({
    kind: "real_window", startTime: "16:00", endTime: "18:00", daysOfWeek: [1, 2, 3, 4, 5],
    quote: "Happy Hour 4-6pm Mon-Fri", sourceUrl: "https://x.com/hh", servesAlcohol: true, reasoning: "r",
  }));
  assert.equal(v?.kind, "real_window");
  assert.equal(v?.kind === "real_window" && v.startTime, "16:00");
});

check("downgrades real_window with no quote to unconfirmable", () => {
  const v = parseVerdict(msgWith({
    kind: "real_window", startTime: "16:00", endTime: "18:00", daysOfWeek: [1],
    quote: "", sourceUrl: "https://x.com", servesAlcohol: true, reasoning: "r",
  }));
  assert.equal(v?.kind, "unconfirmable");
});

check("returns null when no tool call present", () => {
  assert.equal(parseVerdict({ content: [{ type: "text", text: "hi" }] } as never), null);
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx tsx scripts/test-reverify-parse.ts`
Expected: FAIL — `@/lib/reverify/adversarial` / `parseVerdict` does not exist.

- [ ] **Step 5: Implement the adversarial runner**

Create `lib/reverify/adversarial.ts` (modeled on `lib/ai/extractHappyHours.ts`'s server-tool loop):

```ts
/**
 * Adversarial re-check of an existing all-day happy-hour claim. Uses server-side
 * web_fetch + web_search and forces a structured `record_verdict` tool call. Independent
 * of the seed extractor on purpose (a skeptical second opinion). Returns a typed Verdict
 * plus usage for the ledger. No DB writes.
 */
import type {
  Message, MessageParam, ToolChoiceTool, ToolUnion, ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { anthropic } from "@/lib/ai/anthropic";
import type { Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import type { Verdict } from "@/lib/reverify/policy";

export interface ReverifyInput {
  venueName: string;
  address: string | null;
  websiteUrl: string | null;
  currentDays: number[];
  sourceUrl: string | null;
}

const RECORD_VERDICT: ToolUnion = {
  name: "record_verdict",
  description: "Record your single verdict about this all-day happy-hour claim. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["real_window", "legit_all_day", "not_happy_hour", "unconfirmable"] },
      startTime: { type: ["string", "null"], description: '24h "HH:MM" — real_window only' },
      endTime: { type: ["string", "null"], description: '24h "HH:MM" or null ("until close") — real_window only' },
      daysOfWeek: { type: "array", items: { type: "integer" }, description: "ISO 1=Mon..7=Sun" },
      quote: { type: "string", description: "VERBATIM source text backing the verdict (required for real_window / legit_all_day)" },
      sourceUrl: { type: "string", description: "URL the quote came from" },
      servesAlcohol: { type: "boolean" },
      reasoning: { type: "string" },
    },
    required: ["kind", "servesAlcohol", "reasoning"],
  },
};

const TOOLS: ToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_callers: ["direct"] },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 8_000, allowed_callers: ["direct"] },
  RECORD_VERDICT,
];
const MAX_TURNS = 8;

interface RawVerdict {
  kind?: string;
  startTime?: string | null;
  endTime?: string | null;
  daysOfWeek?: number[];
  quote?: string;
  sourceUrl?: string;
  servesAlcohol?: boolean;
  reasoning?: string;
}

/** Parse the forced record_verdict tool call into a typed Verdict, enforcing the quote rule. */
export function parseVerdict(message: Message): Verdict | null {
  const call = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_verdict",
  );
  if (!call) return null;
  const raw = call.input as RawVerdict;
  const quote = (raw.quote ?? "").trim();
  const sourceUrl = (raw.sourceUrl ?? "").trim();
  const servesAlcohol = raw.servesAlcohol === true;
  const reasoning = raw.reasoning ?? "";
  const days = [...new Set(raw.daysOfWeek ?? [])].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);

  // The quote-or-nothing rule: verdicts that assert a schedule must carry a verbatim quote.
  if (raw.kind === "real_window") {
    if (!quote || !sourceUrl || !raw.startTime) return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
    return { kind: "real_window", startTime: raw.startTime, endTime: raw.endTime ?? null, daysOfWeek: days, quote, sourceUrl, servesAlcohol, reasoning };
  }
  if (raw.kind === "legit_all_day") {
    if (!quote || !sourceUrl) return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
    return { kind: "legit_all_day", daysOfWeek: days, quote, sourceUrl, servesAlcohol, reasoning };
  }
  if (raw.kind === "not_happy_hour") return { kind: "not_happy_hour", quote, sourceUrl, servesAlcohol, reasoning };
  return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
}

export interface ReverifyResult {
  verdict: Verdict | null;
  usage: Usage;
  costCents: number;
  promptHash: string;
  model: string;
}

function fill(t: string, i: ReverifyInput): string {
  return t
    .replace("{{venue_name}}", i.venueName)
    .replace("{{address}}", i.address ?? "unknown")
    .replace("{{website_url}}", i.websiteUrl ?? "none")
    .replace("{{current_days}}", JSON.stringify(i.currentDays))
    .replace("{{source_url}}", i.sourceUrl ?? "none");
}

export async function reverifyAllDay(input: ReverifyInput): Promise<ReverifyResult> {
  const loaded = loadPrompt("reverify-all-day.md");
  const { system: rawSys, user: rawUser } = splitPrompt(loaded.content);
  const model = MODELS.verifier;
  const base = {
    model,
    max_tokens: 2048,
    system: fill(rawSys, input),
    tools: TOOLS,
  };
  const messages: MessageParam[] = [{ role: "user", content: fill(rawUser, input) }];
  const summed: Usage = { inputTokens: 0, outputTokens: 0 };
  const force: ToolChoiceTool = { type: "tool", name: "record_verdict" };
  let last: Message | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastTurn = turn === MAX_TURNS - 1;
    const res = await anthropic().messages.create({
      ...base, messages, ...(lastTurn ? { tool_choice: force } : {}),
    });
    last = res;
    summed.inputTokens += res.usage.input_tokens;
    summed.outputTokens += res.usage.output_tokens;
    if (res.content.some((b) => b.type === "tool_use" && b.name === "record_verdict")) break;
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: "Call record_verdict now with your single verdict." });
  }

  return {
    verdict: last ? parseVerdict(last) : null,
    usage: summed,
    costCents: calcCostCents(model, summed),
    promptHash: loaded.hash,
    model,
  };
}
```

- [ ] **Step 6: Run the parse test to verify it passes**

Run: `npx tsx scripts/test-reverify-parse.ts`
Expected: PASS — "3 checks passed."

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. (If `loadPrompt`/`splitPrompt` signatures differ, mirror their use in `lib/ai/extractHappyHours.ts:buildExtractRequest`.)

- [ ] **Step 8: Commit**

```bash
git add prompts/reverify-all-day.md lib/reverify/adversarial.ts scripts/test-reverify-parse.ts package.json
git commit -m "feat(reverify): adversarial all-day verifier + verdict parse"
```

---

### Task A3: Report render/parse (pure, tested)

**Files:**
- Create: `lib/reverify/report.ts`
- Test: `scripts/test-reverify-report.ts`
- Modify: `package.json` (add `test:reverify-report` script)

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, after `"test:reverify-parse"`, add:

```json
    "test:reverify-report": "tsx scripts/test-reverify-report.ts",
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test-reverify-report.ts`:

```ts
/**
 * Unit checks for reverify report build + round-trip. Run: npx tsx scripts/test-reverify-report.ts
 */
import assert from "node:assert/strict";
import { buildReportEntries, toJson, parseJson, type ReportEntry } from "@/lib/reverify/report";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const entry: ReportEntry = {
  happyHourId: "hh-1", venueId: "v-1", venueName: "Test Bar", city: "phoenix",
  currentDays: [1, 2, 3, 4, 5], sourceUrl: "https://x.com",
  verdict: { kind: "not_happy_hour", quote: "Coupon", sourceUrl: "https://x.com", servesAlcohol: false, reasoning: "coupon only" },
  action: "delete_venue",
};

check("buildReportEntries pairs a row with its verdict+action", () => {
  const rows = [{ happyHourId: "hh-1", venueId: "v-1", venueName: "Test Bar", city: "phoenix", currentDays: [1, 2, 3, 4, 5], sourceUrl: "https://x.com" }];
  const out = buildReportEntries(rows, [entry.verdict]);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, "delete_venue");
});

check("json round-trips", () => {
  const json = toJson([entry]);
  const back = parseJson(json);
  assert.equal(back[0].action, "delete_venue");
  assert.equal(back[0].verdict.kind, "not_happy_hour");
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx tsx scripts/test-reverify-report.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the report module**

Create `lib/reverify/report.ts`:

```ts
/**
 * Build, serialize, and parse the all-day reverify report. The .json is the operator's
 * editable source of truth for --apply; the .md is the human view. Pure (no IO).
 */
import { recommendAction, type Action, type Verdict } from "@/lib/reverify/policy";

export interface ReverifyRow {
  happyHourId: string;
  venueId: string;
  venueName: string;
  city: string;
  currentDays: number[];
  sourceUrl: string | null;
}

export interface ReportEntry extends ReverifyRow {
  verdict: Verdict;
  action: Action;
}

/** Pair each row with its verdict and the recommended action. Order must match. */
export function buildReportEntries(rows: ReverifyRow[], verdicts: (Verdict | null)[]): ReportEntry[] {
  return rows.map((row, i) => {
    const verdict = verdicts[i] ?? { kind: "unconfirmable", quote: "", sourceUrl: "", servesAlcohol: false, reasoning: "no verdict returned" } as Verdict;
    return { ...row, verdict, action: recommendAction(verdict) };
  });
}

export function toJson(entries: ReportEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function parseJson(json: string): ReportEntry[] {
  const parsed = JSON.parse(json) as ReportEntry[];
  if (!Array.isArray(parsed)) throw new Error("report json must be an array");
  return parsed;
}

export function toMarkdown(entries: ReportEntry[]): string {
  const lines: string[] = [
    "# All-day happy-hour review",
    "",
    "Edit the `action` field in the matching `.json` before running `--apply`.",
    "Actions: `correct` (fix to real window) · `keep` · `stub` (drop window, keep venue) · `delete_venue`.",
    "",
  ];
  for (const e of entries) {
    lines.push(`## ${e.venueName} (${e.city})`);
    lines.push(`- happyHourId: \`${e.happyHourId}\` · venueId: \`${e.venueId}\``);
    lines.push(`- current all-day days: ${JSON.stringify(e.currentDays)}`);
    lines.push(`- verdict: **${e.verdict.kind}** · servesAlcohol: ${e.verdict.servesAlcohol}`);
    if (e.verdict.kind === "real_window") {
      lines.push(`- real window: ${e.verdict.startTime}–${e.verdict.endTime ?? "close"} on ${JSON.stringify(e.verdict.daysOfWeek)}`);
    }
    lines.push(`- quote: ${e.verdict.quote ? `"${e.verdict.quote}"` : "_(none)_"}`);
    lines.push(`- source: ${e.verdict.sourceUrl || e.sourceUrl || "_(none)_"}`);
    lines.push(`- reasoning: ${e.verdict.reasoning}`);
    lines.push(`- **recommended action: ${e.action}**`);
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/test-reverify-report.ts`
Expected: PASS — "2 checks passed."

- [ ] **Step 6: Commit**

```bash
git add lib/reverify/report.ts scripts/test-reverify-report.ts package.json
git commit -m "feat(reverify): report build/serialize/parse (pure, tested)"
```

---

### Task A4: Orchestration script — `reverify:all-day` (report + guarded apply)

**Files:**
- Create: `scripts/reverify-all-day.ts`
- Modify: `package.json` (add `reverify:all-day` script)

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, after `"prune:empty-venues"`, add:

```json
    "reverify:all-day": "tsx scripts/reverify-all-day.ts",
```

- [ ] **Step 2: Write the orchestration script**

Create `scripts/reverify-all-day.ts`:

```ts
/**
 * One-time, operator-gated review of existing ALL-DAY happy-hour rows.
 *
 *   Report (no DB writes):
 *     npx tsx scripts/reverify-all-day.ts [--city <slug>] [--limit N]
 *   → writes docs/all-day-review-<YYYY-MM-DD>.md + .json
 *
 *   Apply (after you review + edit the .json's `action` fields):
 *     npx tsx scripts/reverify-all-day.ts --apply docs/all-day-review-<date>.json
 *   → corrects / stubs / deletes per the (operator-approved) actions, writing audit_log.
 *
 * Requires DATABASE_URL; the report phase also needs ANTHROPIC_API_KEY.
 * delete_venue is performed ONLY if the json still says action: "delete_venue".
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { reverifyAllDay } from "@/lib/reverify/adversarial";
import { buildReportEntries, toJson, toMarkdown, parseJson, type ReverifyRow, type ReportEntry } from "@/lib/reverify/report";
import { recordUsage } from "@/lib/ai/ledger";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const args = process.argv.slice(2);
const argValue = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const applyPath = argValue("--apply");
const citySlug = argValue("--city");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;

const sql = postgres(DATABASE_URL, { max: 4 });

// A YYYY-MM-DD stamp without Date.now (tsx scripts may run anytime); use the OS date.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runReport() {
  const rows = await sql<{
    happy_hour_id: string; venue_id: string; venue_name: string; city: string;
    days_of_week: number[]; website_url: string | null; source_url: string | null; address: string | null;
  }[]>`
    SELECT hh.id AS happy_hour_id, v.id AS venue_id, v.name AS venue_name, c.slug AS city,
           hh.days_of_week, v.website_url, hh.source_url, v.address
    FROM happy_hours hh
    JOIN venues v ON v.id = hh.venue_id
    JOIN cities c ON c.id = v.city_id
    WHERE hh.all_day = true AND hh.deleted_at IS NULL AND v.deleted_at IS NULL
      ${citySlug ? sql`AND c.slug = ${citySlug}` : sql``}
    ORDER BY c.slug, v.name
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;

  console.log(`Reviewing ${rows.length} all-day window(s)…`);
  const reverifyRows: ReverifyRow[] = rows.map((r) => ({
    happyHourId: r.happy_hour_id, venueId: r.venue_id, venueName: r.venue_name,
    city: r.city, currentDays: r.days_of_week, sourceUrl: r.source_url,
  }));

  const verdicts = [];
  for (const r of rows) {
    console.log(`  · ${r.venue_name} (${r.city})…`);
    const res = await reverifyAllDay({
      venueName: r.venue_name, address: r.address, websiteUrl: r.website_url,
      currentDays: r.days_of_week, sourceUrl: r.source_url,
    });
    await recordUsage({ stage: "seed", model: res.model, usage: res.usage, costCents: res.costCents, promptHash: res.promptHash });
    console.log(`      → ${res.verdict?.kind ?? "no verdict"}`);
    verdicts.push(res.verdict);
  }

  const entries = buildReportEntries(reverifyRows, verdicts);
  const stamp = today();
  writeFileSync(`docs/all-day-review-${stamp}.json`, toJson(entries));
  writeFileSync(`docs/all-day-review-${stamp}.md`, toMarkdown(entries));
  console.log(`\nWrote docs/all-day-review-${stamp}.{md,json}. Review, edit actions in the .json, then run with --apply.`);
  await sql.end();
}

async function applyEntry(tx: postgres.TransactionSql, e: ReportEntry) {
  const actor = "operator";
  const reason = `all-day reverify: ${e.verdict.kind}`;
  if (e.action === "keep") return;

  if (e.action === "correct" && e.verdict.kind === "real_window") {
    const before = (await tx`SELECT * FROM happy_hours WHERE id = ${e.happyHourId}`)[0];
    const days = [...new Set(e.verdict.daysOfWeek.length ? e.verdict.daysOfWeek : e.currentDays)].sort((a, b) => a - b);
    await tx`
      UPDATE happy_hours
      SET all_day = false, start_time = ${e.verdict.startTime}, end_time = ${e.verdict.endTime},
          days_of_week = ${days}, source_url = COALESCE(${e.verdict.sourceUrl}, source_url), updated_at = now()
      WHERE id = ${e.happyHourId}`;
    const after = (await tx`SELECT * FROM happy_hours WHERE id = ${e.happyHourId}`)[0];
    await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
             VALUES ('happy_hours', ${e.happyHourId}, ${tx.json(before)}, ${tx.json(after)}, ${actor}, ${reason})`;
    return;
  }

  if (e.action === "stub") {
    const before = (await tx`SELECT * FROM happy_hours WHERE id = ${e.happyHourId}`)[0];
    await tx`UPDATE offerings SET deleted_at = now() WHERE happy_hour_id = ${e.happyHourId} AND deleted_at IS NULL`;
    await tx`UPDATE happy_hours SET deleted_at = now() WHERE id = ${e.happyHourId}`;
    await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
             VALUES ('happy_hours', ${e.happyHourId}, ${tx.json(before)}, ${tx.json({ ...before, deleted_at: "now" })}, ${actor}, ${reason})`;
    // If the venue now has no live windows, mark it a stub.
    const [live] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM happy_hours WHERE venue_id = ${e.venueId} AND deleted_at IS NULL`;
    if (live.n === 0) await tx`UPDATE venues SET data_completeness = 'stub' WHERE id = ${e.venueId}`;
    return;
  }

  if (e.action === "delete_venue") {
    const before = (await tx`SELECT * FROM venues WHERE id = ${e.venueId}`)[0];
    await tx`UPDATE offerings o SET deleted_at = now() FROM happy_hours hh WHERE hh.id = o.happy_hour_id AND hh.venue_id = ${e.venueId} AND o.deleted_at IS NULL`;
    await tx`UPDATE happy_hours SET deleted_at = now() WHERE venue_id = ${e.venueId} AND deleted_at IS NULL`;
    await tx`UPDATE venues SET deleted_at = now(), status = 'inactive' WHERE id = ${e.venueId}`;
    await tx`INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
             VALUES ('venues', ${e.venueId}, ${tx.json(before)}, ${tx.json({ ...before, deleted_at: "now" })}, ${actor}, ${reason})`;
    return;
  }
}

async function runApply(path: string) {
  const entries = parseJson(readFileSync(path, "utf8"));
  const counts: Record<string, number> = {};
  await sql.begin(async (tx) => {
    for (const e of entries) {
      await applyEntry(tx, e);
      counts[e.action] = (counts[e.action] ?? 0) + 1;
    }
  });
  console.log("Applied:", counts);
  await sql.end();
}

(applyPath ? runApply(applyPath) : runReport()).catch((e) => { console.error(e); process.exit(1); });
```

> **Note on `venues.status`:** confirm the `venue_status` enum has an `'inactive'` value (`db/schema/enums.ts`). If the value differs (e.g. `'closed'`), use that instead in the `delete_venue` branch.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. (Adjust `postgres.TransactionSql` type usage if the installed `postgres` types name it differently — fall back to `sql.begin(async (tx) => …)` with `tx` untyped via a small local alias if needed.)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean (modulo the two known pre-existing warnings).

- [ ] **Step 5: Commit**

```bash
git add scripts/reverify-all-day.ts package.json
git commit -m "feat(reverify): reverify:all-day report + operator-gated audited apply"
```

- [ ] **Step 6: Operator dry-run the report (needs keys)**

Run: `npm run reverify:all-day -- --city phoenix --limit 3`
Expected: writes `docs/all-day-review-<date>.{md,json}`; verify the Iron Chef-type coupon venue comes back `not_happy_hour` and a real-HH venue like The Vig comes back `real_window`. Review before any `--apply`. (This step is run by the operator, not committed automatically — the report files are working artifacts.)

---

## Self-review notes

- **Spec coverage:** Part A → Tasks A1-A4 (adversarial pass, report-only then guarded apply, deletes opt-in, audit_log, quote-or-stub enforced in `parseVerdict`). Part B → Tasks B1-B2 (prompt v9 + ≥3-day code backstop). Part C → Tasks C1-C6 (hours_json column, capture, hours-aware suppression, wiring, backfill, tz check). Build order B → C → A preserved (Phase headings ordered; within Phase C build Task C3 before C2 per the ordering note).
- **Known follow-ups for the executor to confirm against live code (not placeholders — explicit verification points):** exact `insertVenueRow` plumbing for `hours_json` (C4 Step 1); `venue_status` enum value for deletion (A4); `loadPrompt`/`splitPrompt` and `costCents` signatures (mirror `extractHappyHours.ts`); the `postgres` transaction type name (A4 Step 3).
- **Test commands added:** `test:extract`, `test:hours`, `test:active`, `test:reverify`, `test:reverify-parse`, `test:reverify-report` — each runnable with `npm run <name>`.
