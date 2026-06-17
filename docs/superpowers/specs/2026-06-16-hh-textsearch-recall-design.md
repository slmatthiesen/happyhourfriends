# HH-Targeted Text Search Recall Pass — Design

**Date:** 2026-06-16
**Status:** Approved in principle; validated live; pending spec review.

## Problem

Seed discovery (`scripts/seed-discover.ts`, renamed from the legacy `seed-discover-tacoma.ts`)
calls Google `searchNearby` with
`rankPreference: "DISTANCE"` and `maxResultCount: 20`. Google truncates each tile to the
nearest 20 **server-side**, before any of our gates run. In dense areas the nearest-20 fills
with whatever is physically closest (cuisine clusters), and real happy-hour anchors are
silently dropped — they never become candidates, so no client-side filter can recover them.

`MAX_DEPTH = 1` (`lib/places/discoveryTiling.ts`) caps subdivision at one level → a 1500m
floor tile for San Mateo's `cellMeters: 3000`. `MIN_RADIUS_METERS = 700` is a hard floor, so
even deeper subdivision can't fully eliminate truncation in the densest corridors.

**Concrete miss:** Jack's Restaurant & Bar (1750 S El Camino Real, San Mateo) — popular,
Mon–Fri 3–6pm happy hour, `servesCocktails` — was never returned for any tile, so absent from
both `seed_candidates` and the run's drop log.

The Places API exposes **no happy-hour field** at any SKU tier (verified). The "Happy hour
food" tag on Google Maps is a consumer-UI attribute, not in the API.

## Approach

Add a second discovery pass: Google **Text Search (New)** for `"happy hour"`, bounded to the
city, relevance-ranked. Text Search relevance for "happy hour" is built on the HH attribute +
review signals we can't read as a field — so it surfaces exactly the venues Nearby truncates.

### Live validation (2026-06-16, ~$0.12, 3 calls)

One `"happy hour"` Text Search over the San Mateo bbox returned 60 results (hit the cap):
- **Jack's Restaurant & Bar: recovered.**
- **47 of 60 net-new** vs the existing 227 candidates, overwhelmingly HH anchors with
  cocktail/beer/wine signals (cocktail bars, pubs, bar & grills, sports bars, breweries,
  steak houses, HH-running restaurants).
- A few net-new are out-of-type (sandwich/hamburger) or adjacent-town — handled by the
  existing place-type and `ST_DWithin` boundary gates.

### Why not just deeper subdivision (MAX_DEPTH 2)?

Kept as an optional general-completeness follow-up. It shrinks the truncation blind spot but
the 700m hard floor means dense corridors can still truncate, and it doesn't bias toward HH
venues. The Text Search pass is cheaper per net-new HH venue and taps Google's HH knowledge
directly. Not in scope for this spec.

## Components

### `lib/places/textSearchRecall.ts` (new, pure + injectable)
- `buildTextSearchBody(textQuery, rectangle, pageToken?)` — request body
  (`rankPreference: "RELEVANCE"`, `locationRestriction.rectangle`, `pageSize: 20`).
- `collectTextSearch({ fetchPage, queries, subRegions })` — for each query × sub-region,
  paginate `nextPageToken` to the 60-result cap, dedup by place id across the whole pass.
  `fetchPage` is injected so tests need no network (mirrors `collectAdaptive`).
- **Sub-region tiling:** the 60-result cap is per query+region. Tile the city bbox into a
  coarse grid (reuse the bbox already computed in BOUNDARY mode) so total recall exceeds 60.
  Start coarse (e.g. quadrants); cost is pennies per sub-tile.
- **Query set:** start with `["happy hour"]` (validated). Structured as a list so variants
  (`"happy hour bar"`, etc.) can be added without code change.

### `scripts/seed-discover-tacoma.ts` (wire-in)
- New `fetchTextSearchPage()` helper using the **same field mask** as `fetchNearby`, so
  recovered candidates carry `serves*` / hours / website / addressComponents identically.
- After the adaptive Nearby sweep, run the recall pass and merge results into the **same
  `collected` map** (place-id dedup). Everything downstream is unchanged: the same 7 gates
  (closed/chain/format/place-type/airport/low-signal) + the same `ST_DWithin` boundary gate +
  the same upsert. Text Search noise is filtered identically to Nearby noise.
- **Standalone mode `--hh-recall-only`:** run ONLY the recall pass (skip the Nearby sweep)
  for backfilling already-discovered cities without re-paying for Nearby. Reuses the same
  boundary load, gates, and upsert.
- Drop counts: extend the existing `recordDrop` / `--debug-drops` accounting so recall-pass
  drops are visible in the run summary.

## Data flow

```
city boundary GeoJSON → bbox → [sub-region grid]
  → Text Search "happy hour" (RELEVANCE, paginated to 60 per region)
  → merge + dedup by place id into `collected`
  → existing 7 gates → existing ST_DWithin boundary gate
  → existing upsert → seed_candidates
```

## Cost

- Text Search (New) Enterprise + Atmosphere (keeps `serves*`): **$0.04/call** ($40/1000).
- Per city: `queries × sub-regions × ≤3 pages`. Whole-bbox = 3 calls = $0.12; quadrant
  tiling ≈ 6–12 calls = **~$0.24–$0.50/city**. Negligible vs Nearby discovery ($1–2) and
  enrich (~$35).
- No local ledger for Places calls — accrues at the Google account level. Every paid run
  needs per-run operator $-OK (per cost-control rule).

## Rollout / operational sequence

1. **Build + merge** the recall pass and `--hh-recall-only` mode (unit-tested).
2. **San Mateo:** run recall (~$0.50) → ~40 net-new candidates → **enrich net-new**
   (dominant cost, operator $-OK) → gate/promote per runbook.
3. **Backfill ~9 prior cities** (Tucson, Phoenix, Scottsdale, Daly City, Five Cities, SLO,
   Oakland, Spokane, Tacoma): `--hh-recall-only` each (~$0.50, ~$4.50 total) + **enrich the
   net-new** (batched, per-batch $-OK; the real spend).

## Testing

- Unit-test `collectTextSearch` with a mock `fetchPage`: pagination stops at `nextPageToken`
  exhaustion and at the 60-cap; cross-region/cross-query dedup by place id; sub-region
  expansion.
- Unit-test `buildTextSearchBody` shape.
- No live network in tests (mirrors `discoveryTiling.test`).
- Live acceptance: `--hh-recall-only` on San Mateo recovers Jack's and reports net-new count.

## Out of scope

- Deeper Nearby subdivision (`MAX_DEPTH` bump) — optional later completeness work.
- HH-likelihood ranking/triage of candidates — separate noise-reduction concern.
- Enrich changes — net-new candidates flow through the existing enrich pipeline unchanged.

## Cleanup

`scripts/probe-hh-textsearch.ts` (the throwaway validation probe) is superseded by
`lib/places/textSearchRecall.ts` and should be deleted once the module lands.
