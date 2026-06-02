# Resolve happy-hour open-ended times to real clock times

**Date:** 2026-06-01
**Branch:** `cluster-schema-seed-pipeline`
**Status:** Design approved, pending implementation plan

## Problem

Happy-hour windows with an open-ended side render as vague text the customer can't
act on:

- `until close` (null `endTime`) → "3 PM – close"
- `open until X` (null `startTime`) → "Until 8 PM" (start hidden)
- `all day` → "Open to close"

"Close" tells the customer nothing — they don't know when the venue actually shuts.
We already store the venue's operating hours from Google Place Details
(`venues.hours_json`, an `OpenPeriod[]`), so we can substitute the real clock time.

The reason it currently says "close" is **not** laziness: a single happy-hour row covers
multiple days (`days_of_week` is a `smallint[]`, e.g. Mon–Fri in one row), but the
venue's close time can differ by day (closes 10 PM Mon–Thu, midnight Fri). A single row
can't always collapse to one clock time without being wrong on some days. This design
resolves that honestly: per-day on the detail page, today-only on the grid.

## Non-negotiables honored

- **Never invent a time.** If `hours_json` is absent, has no period for the relevant day,
  or that day's open/close is unpublished (Google's 24h representation), we fall back to
  the existing text ("close" / "Open to close"). Resolved times come straight from
  Google's `regularOpeningHours` — first-party, already stored, not guessed.
- **First-party data only.** No new data source; reads `hours_json` already on the venue.
- **A resolved concrete time always means *today*** on the grid (see §2), so there is no
  wrong-day lure — a non-today row never shows a concrete resolved time.

## Components

### 1. Resolver — `lib/geo/timezone.ts`

New pure function:

```ts
resolveBoundsForDay(
  window: HappyHourWindow,
  hours: OpenPeriod[] | null,
  isoDay: number,            // 1=Mon..7=Sun
): { startTime: string; endTime: string } | null
```

Behavior:

- Collect the operating period(s) whose `openDay === isoDay`. Use the **earliest `openMin`**
  and the **latest `closeMin`** among them (handles split lunch/dinner hours — the
  happy-hour "close" is the last close of the day).
- The window's bounded side(s) pass through unchanged; the open-ended side is substituted:
  - `allDay` → `open`–`close`
  - `until close` (null `endTime`) → `startTime`–`close`
  - `open until X` (null `startTime`) → `open`–`endTime`
- Returns `null` (caller keeps text fallback) when **any** of:
  - `hours` is null/empty,
  - no period exists for `isoDay`,
  - the resolving side's `closeMin`/`openMin` is null (unpublished / Google 24h).
- Cross-midnight close (`closeDay !== openDay`, e.g. Fri close 2 AM): return the close
  clock time on the close day (`"02:00"`); midnight → `"00:00"`. `formatTime` renders
  these as "2 AM" / "12 AM".
- Output times are `"HH:MM"` strings (minutes-since-midnight → `"HH:MM"`), shape-compatible
  with the existing `time` columns consumed by `formatWindow` / `formatTime`.

This function does **not** decide whether to use the result — callers do (the grid only
calls it for today; the detail page calls it per day in the window).

### 2. Grid — `components/venue-table-client.tsx`

**Day-aware bounds.** Extend `displayBounds(v, activeW)` to take venue-local now (`tzNow`)
and resolve against today's hours. Priority:

1. **Live window** — the window active right now, resolved to today's hours.
2. **Today's window** — a window whose `daysOfWeek` includes `tzNow.dayOfWeek` but isn't
   live yet (Option A: resolve even before it starts), resolved to today's hours.
3. **Merged summary** — the existing `windowBounds(v)` fallback when nothing runs today.

When `resolveBoundsForDay` returns null (unknown hours, etc.), fall back to the window's
raw bounds so `formatWindow` renders the current text. So a resolved concrete time on the
grid **always implies today**.

**Tiered default sort** (`sortKey === "now"`), in order:

0. Live now (`isNowOpen(v)` true)
1. Runs today (a window includes `tzNow.dayOfWeek`) but not live
2. Other days (has happy-hour rows, none today)
3. Stubs (no happy-hour rows)

Within a tier, keep the existing tiebreak (start time, then name). Promoted-row pinning at
the very top is unchanged (PRD §6.3).

**Relevance via sort + muting — no chips.** Relevance is signalled by position and
emphasis, not a per-row label:

- **Live now** — the existing happening-now pulse (`NowBadge`) already marks these; no
  extra chip.
- **Today** (tiers 0–1) — rendered at full emphasis and sorted toward the top, so "today"
  is obvious without a label.
- **Not today** (tiers 2–3) — subtle muting (reduced emphasis), **not red** ("not today"
  is not an error).

No `Now` / `Today` / next-day chip is added.

`happeningNow` and `toggleToday` filters are unchanged and remain one-tap.

### 3. Detail page — `app/[city]/venue/[slug]/page.tsx`

New formatter in `lib/format.ts`:

```ts
formatWindowByDay(
  window: { allDay; startTime; endTime; daysOfWeek },
  hours: OpenPeriod[] | null,
): { days: string; bounds: string }[]
```

- Expand `daysOfWeek`; for each day call `resolveBoundsForDay`.
- Group consecutive days that share identical resolved `(startTime, endTime)` using the
  existing `dayRuns` logic, producing one `{ days, bounds }` line per group.
- Days that don't resolve collapse into a group rendered with the current `formatWindow`
  text. Each group's `bounds` is produced by `formatWindow` over the (possibly resolved)
  bounds, so the all-day / until-close / open-until-X text rules still apply when unresolved.

Rendered per window:

```
Happy Hour
Mon–Thu   3 PM – 10 PM
Fri       3 PM – 12 AM
```

The single-line `formatWindow(h)` at `page.tsx:316` is replaced by this grouped render.
JSON-LD (`page.tsx:101`) is out of scope for this change (keeps `byDay` array as-is).

### 4. Tests

Framework confirmed during planning. Coverage:

- **Resolver** (`resolveBoundsForDay`): all-day, until-close, open-until-X; null/empty
  hours; no period for the day; unpublished open/close; split same-day hours (earliest
  open / latest close); cross-midnight close; bounded window (passes through untouched).
- **`formatWindowByDay`**: uniform days collapse to one line; varying close splits into
  groups; unresolved days fall back to text; mixed resolved + unresolved.
- **Grid tier sort**: ordering across the four tiers (live → today → other days → stubs)
  with start-time/name tiebreaks.

## Out of scope

- Refreshing stale `hours_json` (separate backfill concern; `seed:enrich` sets it only on
  first insert).
- JSON-LD `Event` time nesting changes.
- The `hours_json = null` backfill run itself (operational, not this code change).

## Files touched

- `lib/geo/timezone.ts` — add `resolveBoundsForDay`
- `lib/format.ts` — add `formatWindowByDay`
- `components/venue-table-client.tsx` — day-aware `displayBounds`, tiered sort, day chip, muting
- `app/[city]/venue/[slug]/page.tsx` — grouped per-day render
- tests for the above
