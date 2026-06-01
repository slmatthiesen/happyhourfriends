# Friendly neighborhoods: recognizability-ranked, two-tier rollup

**Date:** 2026-06-01
**Branch context:** `cluster-schema-seed-pipeline`
**Status:** Design approved, pending spec review

## Problem

Tucson's neighborhood listing shows names locals don't recognize (*Limberlost, Poets
Square, Sewell, Campbell-Grant Northeast*). The root cause is not Tucson-specific and
not just a "bad source" — it's three things compounding:

1. **The polygon layer is a mix of granularities and provenances** with no signal for
   "is this a name people actually say."
   - Tucson got the **City of Tucson / Pima County Neighborhood Association (NA)** layer:
     154 hyper-granular *administrative* polygons. Real recognizable barrios (*Sam Hughes,
     Barrio Viejo, Armory Park*) are buried among 140+ obscure registration names.
   - Phoenix/Tacoma/Scottsdale got the **OSM vernacular** layer — friendlier, but still
     mixed with giant administrative "urban village" blobs (*Camelback East* = 94 km²).
2. **Assignment picks by geometry** (smallest-polygon-wins within a snap radius). It has
   no notion of which name is recognizable.
3. **The UI only surfaces neighborhoods that have an assigned venue.** So whichever name
   assignment happens to pick is the only thing the user ever sees.

These fail in *opposite* ways per city:

- **Tucson** — only obscure micro-NAs exist at the fine scale, so the obscure name always
  wins (nothing friendlier to lose to). User sees *Limberlost*.
- **Phoenix** — the friendly polygon *exists* but loses. Verified in the live DB: **zero
  venues fall inside the OSM "Arcadia" polygon** (it's the residential core; the bars and
  restaurants on the Camelback corridor sit just outside it), so they land in the admin
  blob *Camelback East* or in *Biltmore*. The famous name is in the data and still never
  surfaces.

**Conclusion:** swapping Tucson to OSM is necessary but not sufficient — Phoenix already
*is* OSM and still shows *Camelback East*. The missing piece is a **recognizability
signal plus assignment that prefers it**, backed by a **gap-free coarse rollup** so every
venue can fall back to a broad area a local would recognize.

## Goals

- Tucson (and every city) shows neighborhood names locals actually use.
- Fully automated and scalable to ~1000 cities — **no per-city hand-authoring required**.
- Non-hallucinated: recognizability comes from real data signals, never model guessing.
- Provide the *mechanism* to refine specific marquee cities later without blocking scale.
- Preserve the existing ≥95% per-city coverage gate (PRD §3 / operator bar).

## Non-goals (YAGNI)

- LLM-generated neighborhood names as the backbone (hallucination risk — memory
  `venue-type-backfill`: name-only AI refine mislabeled The Vig). Allowed later only as a
  *verified* gap-filler; out of scope for this spec.
- Hand-authored per-city district name lists as the source of truth.
- Reworking the venue page breadcrumb beyond the optional nicety noted below.

## Design overview

A **two-tier** neighborhood model with a **recognizability score**, both derived
automatically at import:

| Concept | Meaning | Source |
|---|---|---|
| `tier = fine` | A named neighborhood (*Arcadia, Sam Hughes*) | OSM `place=neighbourhood\|quarter` |
| `tier = coarse` | A broad rollup district (*Camelback East*-sized, or a generated cardinal zone) | OSM `place=suburb\|city_district\|borough`; else generated |
| `recognizability` | Small integer score; high = "people say this" | OSM `wikidata`/`wikipedia` presence + `place` tier |

The trick: **`wikidata`/`wikipedia` presence is a free, globally-consistent, non-hallucinated
proxy for fame.** *Sam Hughes, Arcadia, Barrio Viejo, Biltmore* carry Wikipedia/Wikidata
tags in OSM; *Limberlost NA*, *Poets Square* do not. We never decide recognizability by
hand or by model.

### Layer sourcing (all automated)

1. **Fine named layer** — extend the existing `import:osm-neighborhoods` script to capture
   `wikidata`/`wikipedia`/`place` tags into the new columns. Re-import Tucson so its real
   barrios (Sam Hughes, Barrio Viejo, Armory Park — Wikipedia-backed in OSM) arrive with
   high recognizability.
2. **Coarse layer** — two sources, in priority order:
   a. OSM coarse tier (`place=suburb`/`city_district`/`borough`) where present.
   b. A **new `generate:cardinal-districts` script** that clips a gap-free set of broad
      zones from the city boundary (`data/<city>-boundary.geojson`, else `cities.bbox`)
      wherever OSM coarse coverage is absent. Zones: **Downtown + Central + North + East +
      South + West** (6). Downtown is anchored on the city center / downtown point; the
      rest are cardinal sectors clipped to the boundary. Deterministic.
3. **Tucson's 154 Pima NA polygons** — demoted to `is_fallback = true` (kept in the DB,
   dormant, reversible). They no longer surface unless independently recognizable — and
   almost none are — so *Limberlost* disappears while the OSM-re-imported *Sam Hughes*
   stays.

### Cardinal zone naming — generic default + optional per-city alias

The generated zones use generic labels (*Downtown, Central, North, East, South, West*) for
**every city by default** — zero per-city work. An **optional** per-city override lets a
marquee city rename individual zones:

- Override source: `data/<city>-cardinal-aliases.json`, e.g.
  `{ "Central": "Midtown", "North": "Foothills" }`. Unset zones keep the generic name.
- `generate:cardinal-districts` reads it if present; absent → fully generic.
- This is the "set up to fix cities later" mechanism — it scales by default and gets
  friendlier only where you opt in.

### Assignment rewrite (`lib/geo/assignNeighborhoods.ts`)

Replace the current smallest-polygon ranking with recognizability-first preference. For
each venue with coordinates, pick in this order:

1. A **recognizable fine** neighborhood containing the point (`tier=fine` AND
   `recognizability ≥ BAR`), ranked by recognizability desc, then smallest area. → stores
   *Arcadia*, *Sam Hughes*.
2. Else the **coarse district** containing the point (`tier=coarse`), ranked
   OSM-coarse over generated, then smallest area. → stores the rollup (*Midtown*,
   *East Side*, *Camelback East*).
3. Else the existing **100 m tight snap** (precision/edge gaps), recognizable candidates
   first.
4. Else NULL — which the gap-free cardinal layer should prevent inside a city boundary.

**Obscure fine NAs are never assigned** — they're shadowed by their coarse parent. This is
exactly what flips Tucson from *Sewell* → *East Side* (or *Midtown* if aliased) and keeps
Phoenix's Camelback-corridor venues on *Arcadia/Biltmore* when contained, else the broad
area. The existing wide (1-mile, unambiguous) snap stays as a final coarse-only step;
review whether it's still needed once cardinal coverage is gap-free.

**Recognizability bar (`BAR`)**, tunable: a fine name may surface if it has a
Wikipedia/Wikidata tag **or** OSM `place ≥ neighbourhood` tier. Below the bar → shadowed by
coarse.

### Query / UI

- `lib/queries/venues.ts` and the neighborhood filter list already key off *assigned*
  neighborhoods, so obscure names stop appearing for free once assignment changes.
- Optional nicety (can defer to a follow-up): when a venue is on a fine neighborhood,
  show a breadcrumb `Arcadia · Midtown` (fine + its coarse parent via `parent_id`). Set
  `parent_id` during assignment/import so this is available; rendering is optional.

### Data model (migration)

Add to `neighborhoods` (next migration number after current head — verify at
implementation; do not hardcode):

- `tier text` — `'fine' | 'coarse'` (CHECK constrained). Default by source at import.
- `recognizability smallint not null default 0` — higher = more recognizable.
- Reuse existing `source` text to tag provenance: `'osm'`, `'osm_coarse'`,
  `'generated_cardinal'`, `'gis_na'` (the demoted Tucson layer).
- Reuse existing `parent_id` (fine → coarse), `is_fallback` (demoted NA layer), `in_scope`.

No column drops. Existing rows backfilled: OSM rows → infer tier from stored `place` if
available else `fine`; Tucson NA rows → `tier=fine`, `recognizability=0`,
`is_fallback=true`, `source='gis_na'`.

## Data flow

```
boundary.geojson / cities.bbox
        │
        ├─ import:osm-neighborhoods ──► fine + osm_coarse rows (recognizability from tags)
        │
        └─ generate:cardinal-districts ─► coarse generated rows (gap-free), alias-renamed
                                              │
   venues (lat/lng from seed:enrich) ── assignNeighborhoods (recognizability-ranked) ──► venues.neighborhood_id
                                              │
                              analyze:neighborhood-coverage (≥95% gate + recognizable %)
```

## Error handling / edge cases

- **City with no boundary file and no bbox** → cardinal generation skips with a clear log;
  city relies on OSM coarse only (may leave gaps → coverage gate catches it).
- **OSM coarse tier overlaps generated cardinal** → OSM coarse wins (ranked above
  generated); generated only fills true gaps. Generation should skip a cardinal zone fully
  covered by OSM coarse, or insert it and let ranking handle overlap (decide in plan;
  prefer skip-if-covered to avoid clutter).
- **Re-imported OSM duplicates an existing slug** → existing behavior: skip (never clobber).
  Demotion of Tucson NA layer is a separate, explicit UPDATE keyed on `source='gis_na'`.
- **Venue outside the city boundary** (cross-bridge, e.g. former Tides Tavern) → stays
  NULL; cardinal zones are clipped to the boundary, so this is preserved correctly.
- **Idempotency** — all three scripts and assignment must be safe to re-run (insert-if-new,
  update-only-on-diff), matching existing conventions.

## Testing

- **Unit (assignment ranking):** fixture polygons where a recognizable-fine, an
  obscure-fine, and a coarse all contain a point → assert recognizable-fine wins;
  obscure-fine-only + coarse → assert coarse wins; nothing → NULL.
- **Unit (cardinal generation):** deterministic quadrant math against a known bbox; zones
  tile the boundary with no gaps/overlaps; Downtown anchored correctly; alias map applied.
- **Idempotency:** re-running each script produces zero net changes.
- **Integration (manual, against live DB):** re-import Tucson + Phoenix, run assignment,
  verify Tucson shows *Sam Hughes/Barrio Viejo/Downtown/Midtown-or-Central* instead of
  *Limberlost/Sewell*, and Phoenix Camelback-corridor venues show *Arcadia/Biltmore* or the
  broad area — not bare *Camelback East* where a finer recognizable name applies.
- **Coverage gate:** `analyze:neighborhood-coverage` still PASSes ≥95%; add and report the
  new "% on recognizable named neighborhood" metric per city.

## Rollout

1. Migration (new columns + backfill).
2. Extend `import:osm-neighborhoods` (capture tags → tier/recognizability).
3. New `generate:cardinal-districts` (+ optional alias JSON).
4. Rewrite `assignNeighborhoods` ranking + unit tests.
5. Extend `analyze:neighborhood-coverage` with the recognizable-% metric.
6. Execute for Tucson + Phoenix; eyeball; tune `BAR`.
7. Document the pipeline in CLAUDE.md + memory.

## Open questions for spec review

- "Central" vs "Midtown" as the default center-zone label (alias can override per city
  regardless — this is only the global default).
- Whether to keep the existing 1-mile "wide unambiguous" snap once cardinal coverage is
  gap-free, or retire it.
