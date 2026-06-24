# Discovery & cost backlog

Noted-but-not-built items from the 2026-06-23 discovery work (adaptive recall + the SJ/HappyHopper
gap audit). Each is independent; none blocks shipping.

## 1. `--resume` for adaptive recall (frontier checkpoint)

**Problem:** the recall pass is stateless between runs. A deeper re-run (`--max-calls` higher)
restarts from the whole-city region and re-walks the same deterministic queue order, so the first
~N calls re-cover ground the prior run already searched — results dedupe on place_id (harmless) but
the **calls are re-paid**. So a depth pass costs *more* than the incremental work it does.

**Fix:** when the per-city call cap halts a run, persist the **unvisited region frontier** (the
queued-but-unsearched regions — `collectAdaptiveRegions` already reports the count via
`onCapReached`) to a small file/DB row. Add a `--resume` flag that seeds the next run from that
frontier instead of the whole bbox → only new depth is paid, $0 overlap.

**Priority:** low. Incremental depth passes are rare; for a few known-missing venues the targeted
manual-add (Google lookup → insert candidate → `seed:enrich --batch`) is cheaper and surgical
(proved on SJ: 3 venues live for $0.07 vs a ~$2 deeper sweep).

## 2. Boundary files for RADIUS-mode cities

**Problem:** `san-jose`, `tacoma`, and `phoenix-central` have **no `data/<city>-boundary.geojson`**,
so discovery runs in RADIUS mode (a disk around the city center, not the municipal shape). That
spills into neighbor cities and misses outlying pockets — part of why SJ's gap audit found real
in-city venues uncaptured.

**Fix:** add the three boundary GeoJSONs (OSM relation → GeoJSON, as the other 10 cities have) so
they run in BOUNDARY mode (`ST_DWithin` gate) like everyone else.

**Priority:** medium — improves precision for 3 live cities.

## 3. Recall-primary + `["bar"]`-only census (discovery architecture)

**Decided 2026-06-23, designed, not built.** Drop `"restaurant"` from `INCLUDED_TYPES` (keep
`["bar"]`); recall ("happy hour" text search, already adaptive) becomes the primary HH source.
Rationale: recall is type-agnostic and already returns mostly restaurants (SJ: 114 restaurant / 17
bar) incl. bar-forward "restaurant"-typed gems (The Vig carries `bar`/`cocktail_bar` in `types[]`,
so `["bar"]` still catches it). The broad `restaurant` census was the expensive, stub-flooding part
and recall covers the HH restaurants that matter. Accepted loss: HH restaurants that are *both*
no-online-footprint *and* plain-`restaurant`-typed (small; popular = has footprint = recall finds).
Validated: recall cohort converts at 18% vs 7.4% for the broad census. Spec the exact type list
(confirm `wine_bar`/`brewery`/`brewpub` are valid `searchNearby` includedTypes; `["bar"]` already
catches sports_bar/cocktail_bar/pub/bar_and_grill/gastropub via `types[]`).

**Priority:** high (sits behind the stub-cleanup tool per operator).

## 4. Chain-level no-HH short-circuit

**Problem:** the free signal gate is a proxy, not an oracle — a chain with menu prices passes it,
the model reads it, returns conf 0.00. We paid 3 separate model calls for **Mariscos Costa Alegre
×3** locations, all 0.00. Same chain, same (no-HH) verdict, 3× the spend.

**Fix:** when a chain (same name / `chain_id`) returns no-HH at one location in a run, skip its
siblings in that run (or down-weight them). Caveat: chains *can* run per-location HH, so make it a
soft de-prioritization, not a hard drop.

**Priority:** low — small per-city savings.
