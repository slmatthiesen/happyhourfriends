# Tucson ward fallback — design

**Date:** 2026-05-30
**Branch:** `cluster-schema-seed-pipeline`
**Status:** approved (approach A)

## Problem

Tucson venues are under-assigned to neighborhoods: 114 of 188 (60.6%) vs Phoenix 99.5%
and Tacoma 98%. Root cause is **data coverage, not a code bug** — Tucson's 154 polygons
are residential *neighborhood associations* (Pima County GIS) that do not tile the city,
so commercial venues on arterials fall in the gaps. Measured: of the 74 unassigned venues,
0 are within the 100m snap; avg distance to the nearest polygon is 1,454m (max 4,754m).
The assignment logic (`ST_DWithin(100m)` snap in `lib/geo/assignNeighborhoods.ts`) is
working correctly.

## Goal

Close the coverage gap by layering Tucson's 6 council **wards** (coarse, gap-free) *under*
the associations as a strict fallback: a venue keeps its precise association where one is in
range, and falls back to its ward otherwise. Operator previously deferred this; now approved.

## Key constraint (why a flat import is wrong)

Of the 114 currently-assigned venues, 89 are *contained* in their association (distance 0)
but **25 are snap-assigned** (1–100m, not inside the polygon). Those 25 venues are inside a
ward (distance 0). If wards were imported as ordinary polygons, the `ST_Distance ASC`
primary sort would flip all 25 from their association name to a generic "Ward N" — a
regression against the operator preference for association names where covered. So wards
must rank as a **strict fallback**, used only when no association is within snap range.

## Approach A — `is_fallback` flag (chosen)

### 1. Schema (migration, drizzle-kit generated → next number 0009)
Add to `db/schema/core.ts` `neighborhoods`:
```ts
isFallback: boolean("is_fallback").notNull().default(false),
```
`boolean` import added if not present. Generate with `npm run db:generate` (drizzle-kit),
then `npm run db:migrate`. Do not hand-author the SQL.

### 2. Assignment ranking (`lib/geo/assignNeighborhoods.ts`)
Add `n.is_fallback` to the `DISTINCT ON` projection and make it the **first** ORDER BY key:
```
ORDER BY vv.id,
         n.is_fallback ASC,                 -- fine polygons beat fallback wards, always
         ST_Distance(...) ASC,
         (n.parent_id IS NOT NULL) DESC,
         ST_Area(n.polygon::geography) ASC
```
Effect: any non-fallback association within `SNAP_METERS` outranks any ward, regardless of
distance. A ward is chosen only when no association is within snap. For cities with no
fallback rows (Phoenix, Tacoma), `is_fallback` is constant `false` → ranking is byte-for-byte
the prior behavior. No-op there.

### 3. Importer (`scripts/import-neighborhoods.ts`)
Add a boolean `--fallback` flag (presence = true). Thread it into the INSERT and the
`ON CONFLICT DO UPDATE` set list so re-imports keep the flag. Default false (existing imports
unaffected).

### 4. Data (`data/tucson-wards.geojson`, committed)
Fetch the 6 wards from Pima County GIS:
`https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/Boundaries2/MapServer/3/query`
`?where=1=1&outFields=Label&outSR=4326&f=geojson` (main thread only — ArcGIS 403s WebFetch;
use curl). Native SR is 2868; request `outSR=4326`. **Strip PII**: keep only the `Label`
property ("Ward 1".."Ward 6"); drop `NAME` (council member), `PHONE`, `ADDRESS`, `URL`, etc.
Commit the cleaned FeatureCollection.

### 5. Import command
```
npm run import:neighborhoods -- --city tucson \
  --geojson ./data/tucson-wards.geojson --name-prop Label --fallback \
  --source "Pima County GIS — Wards, City of Tucson" \
  --source-url "https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/Boundaries2/MapServer/3"
```
Upserts 6 rows on `(city_id, slug)` (slugs `ward-1`..`ward-6`) and re-runs `assignNeighborhoods`.

## Expected outcome (to verify post-import)
- 89 contained venues: keep association (association dist 0, ranked above ward). No change.
- 25 snapped venues: keep association (fallback ranked below it). No change.
- ~74 unassigned: pick up their containing ward, **except** venues outside Tucson city limits
  (the 4.7km outliers), which correctly stay NULL.
- Phoenix/Tacoma: unchanged (verify a re-run of `backfill:neighborhoods` reassigns 0).

## Out of scope (YAGNI)
- No friendlier ward names than "Ward N" (operator accepted coarse names as the fallback).
- No ward fallback for Phoenix/Tacoma (already gap-free).
- No change to `SNAP_METERS`.

## Verification
- `npm run typecheck` + `eslint` clean (allowing the 2 pre-existing Phase 0 issues).
- DB query: Tucson assigned count rises from 114 toward ~188 minus true out-of-city outliers;
  none of the prior 114 association assignments changed to a ward.
- Spot-check: a few of the previously-25 snapped venues still show their association.
