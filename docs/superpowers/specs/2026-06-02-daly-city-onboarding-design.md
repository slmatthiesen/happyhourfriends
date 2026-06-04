# Daly City onboarding design (pilot for nested-routing-era city onboarding)

**Date:** 2026-06-02
**Status:** Approved design, pending implementation plan
**Branch:** `daly-city-onboarding`

## Goal

Onboard **Daly City, CA** as the first city under the new nested `/[state]/[city]` routing
+ release-gating model (shipped in PR #17). Daly City is the pilot that validates the
end-to-end onboarding runbook before the Central Coast markets (Five Cities, San Luis
Obispo). It is the operator's home city.

This is mostly operational: the only repo code change is one city row + a boundary
GeoJSON; everything else is running the existing seed/enrich/neighborhood pipeline. The
design's job is to pin the city-specific decisions (scope, gate, boundary, neighborhoods,
success criteria) so the runbook is unambiguous.

## Background

The codebase is multi-city-native. A city is a `cities` row carrying a `seed_config` JSONB
(`radiusKm`, `cellMeters`, `serviceLocalities`, optional `serviceBufferMeters`) plus an
optional `data/<city>-boundary.geojson`. Discovery prefers **boundary mode**: it tiles the
boundary's bbox and gates each Places result with `ST_DWithin(boundary, point, buffer)`.
The funnel is `seed:discover → seed:enrich → neighborhood imports → backfills →
scope:venues → realness review → flip status='live'`.

Post-PR-#17, public visibility is gated on `cities.status='live'`, so a city seeded in
`discovery` stays hidden until we flip it. Routes are nested: Daly City will live at
`/ca/daly-city`.

The existing high-level sketch lives in
`docs/superpowers/specs/2026-06-02-city-expansion-nested-routing-design.md` §4; this spec
supersedes it for Daly City with the decisions below.

## Non-goals

- **South San Francisco.** A distinct municipality with its own identity ("South City");
  it will be its own city later, not folded into Daly City under a composite label.
- Extractor / enrich logic changes. Known limitations (all-day specials, JS-walled menus)
  are tracked elsewhere and out of scope.
- Per-city neighborhood curation beyond the generic OSM-presence + cardinal-district
  pipeline. Recognizable-share ceilings are data-availability limits, not bugs.
- Five Cities and San Luis Obispo onboarding (separate passes after this pilot).

## Design

### 1. Identity & scope

- **City row:** slug `daly-city`, display name `Daly City`, `state = 'ca'`,
  `country = 'US'`, `default_timezone = 'America/Los_Angeles'`, `currency_code = 'USD'`,
  status starts `discovery` (hidden under the release gate until flipped `live`).
- **URL:** `/ca/daly-city`.
- **Locality gate:** `serviceLocalities: ["Daly City", "Colma"]`. Colma is a small town
  almost entirely surrounded by Daly City; much of the restaurant/bar strip locals treat
  as "Daly City" (the Serramonte / I-280 corridor) is technically in Colma. Including it
  captures the real venues; Colma is too small and cemetery-dominated to headline as its
  own market.

### 2. Boundary & discovery config

- **`data/daly-city-boundary.geojson`** — a **combined Daly City + Colma polygon**
  (union of the two municipal boundaries), sourced from OSM / Census the same way as
  existing cities. Discovery runs in boundary mode against this file, so Colma's enclave
  and the Serramonte / I-280 strip fall inside the `ST_DWithin` gate.
- **`seed_config`:**
  - `radiusKm`: ~6 (fallback tiling radius only — the boundary file drives actual tiling
    and the spatial gate; kept sane so the legacy radius path still works if the file is
    missing).
  - `cellMeters`: 3000 (standard per-tile search radius).
  - `serviceBufferMeters`: ~500 (geocode slop around the combined boundary; small per the
    operator rule to keep snap/buffer tight).
  - Centroid (`center_lat`/`center_lng`): the Daly City municipal centroid, finalized from
    the sourced boundary file rather than hardcoded from memory.

### 3. Neighborhoods

Run the standard generic pipeline (no per-city curation):
`import:osm-neighbourhoods` → `backfill:neighborhood-tiers` → `generate:cardinal-districts`
→ `backfill:neighborhoods` → `analyze:neighborhood-coverage`.

- **Expected recognizable named layer:** Westlake, Serramonte, Broadmoor, Crocker,
  Original Daly City, and Colma (surfaced as a named neighborhood inside the market).
- Cardinal districts (Downtown + N/E/S/W/Central clipped from the boundary) fill gaps to
  clear the ≥95%-assignment bar where vernacular polygons are missing.
- The recognizable share is whatever OSM/Census support — a data-availability outcome, not
  a code target.

### 4. Onboarding sequence (the runbook)

Daly City runs as the pilot. Steps marked **PAID** spend real money and (per the
environment constraints) the web-fetch steps run from the main thread, not subagents.

1. **City row + boundary** *(code/data, free)* — add Daly City to `scripts/seed-cities.ts`
   `CITIES`; add `data/daly-city-boundary.geojson`; run `seed:cities`.
2. **Discover** *(PAID — Google Places)* — `seed:discover -- --city daly-city`.
3. **Enrich** *(PAID — Anthropic web_fetch; the metered step)* —
   `seed:enrich -- --city daly-city --limit N`. Monitor `ai:spend`; set a Console cap.
4. **Neighborhoods + backfills** *(free)* — the §3 pipeline, then `backfill:timezones`,
   `backfill:venue-types`, `scope:venues` (boundary + buffer prune).
5. **Review** *(free / optionally PAID)* — `review:suspect` realness pass + spot-check;
   optional targeted `reextract:stubs --venue <id|name> --url <pdf>` for PDF / JS-walled
   menus (PAID per call).
6. **Publish** *(free)* — flip `status='live'`; the city appears at `/ca/daly-city`.

### 5. Success criteria & risks

- **Done** = Daly City live at `/ca/daly-city`, ≥95% of its venues assigned to a
  neighborhood polygon, realness-reviewed, and every applied happy-hour change carrying a
  `source_url` (PRD §13: missing → `null`; no HH → help-wanted stub; first-party data
  only; dedup on `google_place_id`).
- **Risk — modest yield (acknowledged):** Daly City is residential and many locals drink
  in San Francisco. A meaningful stub rate is an acceptable, correct outcome (genuine
  "no published HH" venues), not an extractor failure. The Colma inclusion specifically
  targets the densest real bar/restaurant strip to lift yield.
- **Risk — boundary sourcing:** the combined Daly City + Colma polygon must not bleed into
  San Francisco or South San Francisco; verify the union before discovery.

## Rollout order

1. City row + boundary GeoJSON (the one code/data change) — verifiable for free.
2. Paid discover + enrich run (operator-involved).
3. Neighborhoods + backfills + scope.
4. Realness review + flip `live`.

After Daly City validates the runbook end-to-end, repeat for Five Cities (Central Coast)
and San Luis Obispo (each its own pass; both `state='ca'`).
