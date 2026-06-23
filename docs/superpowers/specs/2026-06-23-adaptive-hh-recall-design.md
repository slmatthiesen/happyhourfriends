# Adaptive HH-recall (density-aware discovery) — design

**Date:** 2026-06-23 · **Branch:** `feat/adaptive-hh-recall`
**Origin:** Operator found The Pressroom (Yelp's #1 HH in San Jose) absent from discovery. Root
cause is systematic, not a one-off.

## Problem

Google `searchNearby` returns at most **20 results per call**. In a dense core (downtown SJ, Old
Town Scottsdale) a tile holds far more than 20 alcohol venues, so the overflow is dropped
server-side. The Nearby sweep *already* mitigates this with **saturation-driven subdivision**
(`collectAdaptive`): a tile that returns 20 splits into 4 children and re-queries, down to a floor
cell — and it logs `floorSaturated` tiles that are *still* 20 at the floor ("dense hotspot").

Two gaps remain:
1. **The subdivision floor is too coarse for ultra-dense cores** — they stay saturated at the
   smallest tile, so the overflow past 20 is still lost.
2. **The "happy hour" Text Search recall pass — the designed backstop — is non-adaptive.** It runs
   the whole-city bbox by default (≤60 results city-wide; `--sub-tile` quadrants are opt-in and
   were off for the cities already onboarded). So a dense downtown competes with the entire city
   for 60 slots and loses.

**Evidence (measured 2026-06-23):** a single "happy hour" Text Search centered on each core returns
the missing venues. Of 10 downtown-SJ HH spots the search returns, **5 are absent from our
candidates** (The Pressroom, The Continental, Poppy & Claro, Firehouse No.1, The Club On Post). Old
Town Scottsdale: **5 of 20 absent** (Pour Decisions, Old Town Tavern, Rockbar, The Grapevine, The
Montauk). ~25–50% of dense-core HH venues are dropped, in every city.

## Decision

Make the **recall pass adaptive** (saturation-recursive), mirroring the Nearby sweep. This is the
targeted, cheap lever: Text Search is `happy hour`-relevance-ranked, so recursion spends only on
the venues we care about, and it reuses the saturation pattern already proven for Nearby. We do NOT
lower the Nearby floor in this change (more expensive, captures all venue types; revisit only if
adaptive recall proves insufficient).

## Design

### 1. Saturation-recursive recall (the whole fix)

- Seed with the city bbox rectangle (BOUNDARY mode) or the radius-disk bbox (RADIUS mode).
- For each region: run the "happy hour" Text Search, paginating up to `TEXT_SEARCH_MAX_PAGES` (3 →
  ≤60 results), gated + boundary-checked + upserted exactly as today.
- **Saturation = the region returned a full 60** (all 3 pages maxed) → it is hiding more. Split into
  4 quadrants via the existing `splitRectQuadrants` and recurse.
- **Floor:** stop recursing once a region's half-diagonal is below `RECALL_FLOOR_METERS` (~450m).
  A region still saturated at the floor is logged as a dense hotspot ("N may remain"), mirroring
  Nearby's `floorSaturated` report — never silently dropped.
- **Per-city cap:** hard stop at `RECALL_MAX_CALLS` (~30 Text Search calls, ~$1). On hit, stop and
  log the queued-but-unvisited regions. Both constants flag/env-tunable.
- Net behavior: a sparse city resolves in one region (coarse, cheap); a dense metro auto-recurses
  into its cores (fine). Density-adaptive, data-driven — no hardcoded downtowns.

### 2. Reuse, not rebuild

- `collectAdaptive` already implements saturation-recursion + maxTiles cap + boundary-prune for
  **circles** (Nearby). Generalize the same control structure for **rectangles** (recall already
  has `splitRectQuadrants`): a work queue of regions, fetch → if saturated and above floor and
  under cap, enqueue 4 children; else stop. Keep one consistent recursion pattern across both
  passes rather than a second bespoke loop.
- **No change to candidate processing.** Recovered places run the IDENTICAL gate ladder
  (alcohol/type gates), boundary gate (`ST_DWithin(boundary, point, serviceBufferMeters)`), and
  `google_place_id` dedup/upsert. Only *how candidates are found* changes — same contract the
  recall pass already honors.
- **Out-of-boundary pruning:** a child region whose rect cannot reach the in-scope area is pruned
  before paying (mirrors Nearby's child-tile `ST_DWithin` prune), so we never pay to recurse into a
  dense neighbor city.

### 3. Defaults & flags

- Adaptive recall becomes the **default** recall behavior; retire the manual `--sub-tile` toggle
  (its quadrant split is subsumed by recursion). `--no-hh-recall` / `--hh-recall-only` unchanged.
- `--estimate` still prints an up-front bound: with recursion the bound is the **cap** (≤
  `RECALL_MAX_CALLS` × page-cost), printed as a worst-case so cost stays countable before spend.

### 4. Rollout / backfill ("check every city downtown")

1. Validate on **San Jose + Scottsdale** first (known gaps): `seed:discover --hh-recall-only`
   (now adaptive). Confirm The Pressroom / Pour Decisions et al. land as candidates.
2. Enrich the newly-found HH-likely candidates (high-yield — `happy hour`-matched cocktail bars,
   not the low-signal bare backlog).
3. Roll across the remaining 11 onboarded cities. ~$1/city discovery + a modest enrich each.

### 5. Testing

- **Hermetic unit test** (no network): inject a fake fetch that returns 60 for "dense" rectangles
  and <60 for sparse ones. Assert the recursion (a) subdivides only saturated regions, (b) honors
  `RECALL_FLOOR_METERS` (stops recursing at the floor), (c) honors `RECALL_MAX_CALLS` (stops and
  reports), (d) prunes out-of-boundary children. Mirror the existing Nearby `collectAdaptive`
  coverage if a test exists; add one if not.
- Register as a `test:*` script in `scripts/ci-tests.sh`.

## Risks

- **Cost on very dense metros** — bounded by the floor + per-city cap; `--estimate` prints the
  worst case; floor-saturated cores are logged for manual follow-up rather than chased uncapped.
- **Backfill enrich spend** — the new candidates are paid to enrich, but they are HH-matched
  (high-yield); validate on 2 cities before the full roll. Honors the standing "no blind sweeps"
  rule: this targets a proven, quantified recall gap.
- **Double-counting / dupes** — none; `google_place_id` upsert dedups recovered places against the
  Nearby pool and prior runs (idempotent re-run).

## Out of scope

- Lowering the Nearby subdivision floor (revisit only if adaptive recall under-delivers).
- New cuisines/types in discovery; any change to the gate ladder or enrich.
