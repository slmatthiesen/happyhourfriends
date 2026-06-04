# Discovery: complete-coverage tiling + bad-data gates

**Date:** 2026-06-03
**Branch:** `feat/discovery-complete-coverage`
**Status:** Design — approved pending spec review

## Problem

`seed:discover` (`scripts/seed-discover-tacoma.ts`) systematically under-discovers real
venues, and lets some unwanted ones through.

### Root cause 1 — popularity-ranked 20-result cap (the big one)

`fetchNearby` calls Google Places API (New) `places:searchNearby` with `maxResultCount: 20`
and **no `rankPreference`**, so Google defaults to **`POPULARITY`**. Each tile-circle therefore
returns only *the 20 most prominent* bars/restaurants within it — everything past the 20th
most popular is silently dropped. In dense commercial corridors (exactly where bars cluster)
this drops the most venues, and lower-profile **bars** lose the 20 slots to popular
**restaurants** (e.g. The Main Ingredient in Phoenix — a real bar — was never captured).

The reason aggregate results ever exceed 20 today is that discovery is *tiled* (3000m cells
in BOUNDARY mode): adjacent overlapping tiles each return their own popularity-20, so the
union exceeds 20 — but each dense tile still truncates.

### Root cause 2 — missing bad-data gates

- **Airport venues:** no filter at all. In-terminal restaurants/bars become candidates.
- **Strip / adult clubs:** only a *name* match exists (`cabaret`, `gentlemens club`,
  `topless` in `chainDenylist.ts`). A neutrally-named club typed `night_club` (on the
  always-allowed alcohol-signal list) slips through.
- **Casinos / resorts:** `resort_hotel` primaryType is excluded; casinos are not.

## Goals

- **Completeness first.** Capture essentially every bar/restaurant in scope. Google Places
  call cost is not a constraint (operator confirmed), so spend calls where density demands.
- **Filter bad data before any AI/enrich spend:** airport-terminal venues, strip/adult clubs,
  casinos.
- **Scale to ~1000 cities with no per-city tuning.** No hand-tuned tile sizes, no per-city
  curated airport lists.

Non-goals: changing the enrich pipeline; switching to Text Search (heavier, deferred unless
adaptive tiling proves insufficient); changing the boundary/scope model.

## Design

### 1. `rankPreference: "DISTANCE"` + adaptive density-aware subdivision

Add `rankPreference: "DISTANCE"` to the `searchNearby` request body so each call returns the
**nearest** ≤20 places to the tile center rather than the most popular.

Replace fixed-grid tiling with **adaptive quadtree subdivision** so coverage is complete
regardless of local density and self-tunes cost to density:

- Start from a base cell (radius = `cfg.cellMeters`, default 3000m), built over the boundary
  bbox (BOUNDARY mode) or the radius disk (RADIUS mode) as today.
- Query each tile with DISTANCE. **A tile that returns exactly `maxResultCount` (20) is
  treated as *saturated*** — there are ≥20 qualifying venues within its radius and the API
  truncated. Split it into **4 quadrant sub-tiles** at half the radius, offset to the
  quadrant centers, and re-query each — recursively.
- Stop subdividing a tile when it returns `< 20` results (everything in it was captured) OR
  it hits a **floor**: minimum radius ~400m **or** maximum recursion depth 4 (whichever first).
  At the floor we accept whatever the API returns and `log()` that a floor tile was still
  saturated (a genuine "this 400m circle has >20 venues" hotspot — rare, surfaced not hidden).
- A **global tile-count safety cap** (e.g. 2000 tiles/run) aborts with a clear error if
  subdivision runs away, so a bug can't silently spend unbounded Places quota.
- Sparse areas (Daly City) resolve in one pass; dense cores (downtown Phoenix, Old Town
  Scottsdale) drill down only where needed.

**Saturation detection:** `results.length === maxResultCount`. This can occasionally
over-subdivide a tile that has exactly 20 and no more — harmless (a few extra cheap calls),
and the right bias when the goal is completeness.

**De-dup:** unchanged — every result upserts on `google_place_id` (`ON CONFLICT`), so
overlapping tiles and re-queried quadrants converge idempotently. Per-result spatial/type
gates are unchanged and apply to every tile.

The recursion is a pure tiling-strategy change; all downstream gates (closed, chain, format,
type, low-signal, boundary/locality, metro-scope cleanup) run exactly as before.

### 2. Bad-data gates

All run before any enrich/AI spend, consistent with the existing gate ordering in the
discovery loop.

**Airport (new, generic, zero-curation):** at the start of a run, issue one `searchNearby`
for `includedTypes: ["airport"]` over the city bbox/center to find airport location(s)
automatically. Store the points. In the per-result loop, drop any candidate within **1500m**
of an airport point (haversine, or `ST_DWithin` in BOUNDARY mode). The tight buffer targets
terminal/concourse venues only — real bars in the surrounding area (e.g. Tacoma's "Airport
Tavern", near but not in the airport) survive, which a name regex would wrongly kill. If the
airport lookup returns nothing, the gate is a no-op. New counter `airportSkipped`.

**Strip / adult clubs (broaden):** extend `NO_HH_FORMAT_PATTERNS` in `chainDenylist.ts` with
`strip club`, `showgirls`, `nude`, `adult`, `go go`, `burlesque` (joining existing `cabaret`,
`topless`, `gentlemens club`). `isLikelyNoHappyHourFormat` runs *before* the alcohol-signal
override, so a `night_club`-typed adult club is dropped while legit lounges/clubs are
untouched. Word-boundary matching as today (no `nude` matching "denude", etc.).

**Casinos (broaden):** add `casino` to the name-pattern gate and add `casino`/`gambling` to
the place-type excludes (`EXCLUDED_PRIMARY_TYPE` / `EXCLUDED_ANY_TYPE`). Best-effort only —
per the existing operator note, Google can't reliably flag casino/resort *restaurants* by
type, so this catches the obvious cases; the rest remain a known, documented gap. Malls
(Kierland Commons) are unaffected.

### 3. Re-run

After code lands, typechecks (`npm run typecheck`) and lints clean, and a `--dry-run` tile
count looks sane, run `seed:discover` Places-only (no enrich):
1. `--city tacoma`
2. `--city daly-city`
3. `--city phoenix`

Report candidate counts before/after per city to quantify the lift, and flag anything odd
before any enrich is considered.

## Components / files touched

- `scripts/seed-discover-tacoma.ts`
  - `fetchNearby`: add `rankPreference: "DISTANCE"`; return enough to detect saturation.
  - New adaptive subdivision driver replacing the flat `for (const tile of tiles)` loop,
    sharing the existing per-result gate block. Works in both BOUNDARY and RADIUS modes.
  - Airport-point lookup at run start + per-result airport-buffer gate + `airportSkipped`
    counter in the summary line.
  - Global tile-count cap + `log` of floor-saturated tiles.
- `lib/places/chainDenylist.ts`
  - Expand `NO_HH_FORMAT_PATTERNS` (adult-club terms + `casino`).
  - Add casino/gambling place types to `EXCLUDED_PRIMARY_TYPE` / `EXCLUDED_ANY_TYPE`.
- `scripts/test-discovery.ts`: extend to report adaptive tile count / saturation as a
  `--dry-run` so call volume is visible before spending (if it doesn't already).

## Testing

- Unit: subdivision logic (a tile returning 20 → 4 children; <20 → leaf; floor stops at depth
  4 / 400m). Pure function over a mock fetch, no live API.
- Unit: expanded denylist patterns (new adult/casino terms match; `nude` does not match
  "denude"; legit "lounge"/"club" names unaffected).
- Unit: airport buffer gate (point inside 1500m dropped; just outside kept).
- Manual `--dry-run` tile-count sanity check per city before the live run.
- `npm run typecheck` + `eslint` clean.

## Risks / open items

- **Over-subdivision cost:** bounded by the floor + global tile cap; operator accepts Places
  cost. Surfaced via dry-run before spending.
- **Saturation false-positive at floor:** a genuine >20-venues-in-400m hotspot can still
  truncate. Logged, not hidden; acceptable (extremely dense entertainment block).
- **Casino/resort recall:** acknowledged weak — type-based detection is unreliable; name +
  type gate is best-effort, not complete.
