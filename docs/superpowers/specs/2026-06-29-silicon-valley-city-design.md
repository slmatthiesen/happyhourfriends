# Silicon Valley city — onboarding design (2026-06-29)

Add `silicon-valley` as a new aggregate city before the San Francisco launch. One city
row spanning the Core-5 South Bay tech municipalities + Los Altos, following the existing
`five-cities` multi-municipality precedent.

## Decisions (locked)

- **Scope:** Core 5 — Palo Alto, Mountain View, Sunnyvale, Santa Clara, Cupertino —
  **plus Los Altos + Los Altos Hills** (folded in to keep the boundary polygon contiguous;
  without them there is a donut hole in the middle of the union).
- **Identity:** name `Silicon Valley`, slug `silicon-valley`, state `CA`, timezone
  `America/Los_Angeles`, currency USD. Slug is permanent (canonical URLs / SEO).
- **Excluded:** San Jose, Campbell, Los Gatos, Milpitas, Menlo Park, Redwood City. San Jose
  is a standalone city's worth of venues; the wider Peninsula/South Bay can be added later
  as its own scope expansion. Naming caveat accepted: locals also associate "Silicon Valley"
  with San Jose, but the recognizable label wins and scope can widen later without a slug change.

## Architecture (no schema changes)

This is a pure data/config onboarding — multi-city-native schema already supports it. No
migrations. The aggregate-city pattern is identical to `five-cities`: a single `cities` row
whose membership is enforced by (a) a custom boundary GeoJSON and (b) a `serviceLocalities`
allow-list in `seed_config`.

### Components

1. **Boundary GeoJSON** — `data/silicon-valley-boundary.geojson`
   - Union of 7 OSM municipal relations: Palo Alto, Mountain View, Sunnyvale, Santa Clara,
     Cupertino, Los Altos, Los Altos Hills.
   - Metro-scope (not strict municipal limits) per memory `discovery-radius-undercovers-city`.
   - Drives discovery tiling, the insert gate, venue scoping, and cardinal districts.
   - Sourced + unioned in the main thread (OSM relation fetch is a web fetch; subagents can't).

2. **City row** — new entry in the `CITIES` array of `scripts/seed-cities.ts`
   - `centerLat`/`centerLng` = boundary bbox center (fallback only; boundary drives tiling).
   - `seedConfig`:
     - `cellMeters: 3000`
     - `serviceBufferMeters: 500`
     - `serviceLocalities: ["Palo Alto", "Mountain View", "Sunnyvale", "Santa Clara",
       "Cupertino", "Los Altos", "Los Altos Hills", "Stanford"]`
       (Stanford venues geocode to their own locality but sit on Palo Alto's edge — keep them.)
   - `radiusKm` is a fallback only (boundary GeoJSON drives real tiling/gate).
   - Inserted idempotently via `pnpm run seed:cities`.

## Onboarding flow (runbook-aligned)

Follows `docs/new-city-runbook.md`. The city stays `status='discovery'` (invisible) until
the operator flips it live — nothing is public until then.

1. **Phase 1 — register ($0):** boundary GeoJSON + city row + `seed:cities`.
2. **Estimate ($0):** `onboard:city --estimate` → report boundary-pruned tile count + dollar
   estimate **before any paid call** (per memory `feedback_report_tile_count_before_discovery`).
3. **Cost gate ($5):** Core-5+LosAltos (~620k pop) is expected to land around **$5–8 total**
   (Google discover + HH recall + free-first `--batch` enrich) — likely *over* a single $5
   run. STOP at the estimate and get explicit operator OK before the paid `onboard:city` run
   (per memory `feedback_city_run_autonomy_spend_gate`). Enrich is always `--batch`.
4. **Paid onboard:** `onboard:city` runs discover → enrich `--batch` → regate →
   combo-cuisine drop → city summary behind one confirm, then stops at the review gate.
   `--debug-drops` is non-optional.
5. **Neighborhoods (separate phase):** `import:osm-neighbourhoods` → `backfill:neighborhood-tiers`
   → `generate:cardinal-districts` → `analyze:neighborhood-coverage`.
6. **Operator review + go-live:** build the live/hidden/stubs/drops review doc; operator flips
   `status='live'` and pushes prod data. **Agent never touches prod or flips live.**

## Crossover

No currently-onboarded city overlaps this scope (San Jose is *not* seeded), so the
boundary-based crossover drop has nothing to remove here. Global-unique `google_place_id` +
`city_id`-never-reassigned still protect against any future neighbor claim. The 7-municipality
union is internal to this one city, so there is no intra-scope crossover to defend.

## Success criteria

- City row exists with `status='discovery'`; renders nowhere yet.
- `data/silicon-valley-boundary.geojson` loads as a valid single (multi)polygon covering all
  7 municipalities with no interior donut hole.
- `onboard:city --estimate` returns a sane tile count + cost for ~620k pop before any spend.
- After the paid run: candidate count is plausible for the metro (order ~700–1200), the
  expected out-of-scope localities (San Jose, Menlo Park, Campbell, Milpitas) were dropped,
  `--debug-drops` written, and the reconcile gate leaves a believable confirmed-HH count.
- `pnpm typecheck` green (seed-cities edit).

## Out of scope

- No schema/migration changes.
- No widening to San Jose / full South Bay (future scope-expansion, separate spec).
- No prod deploy or go-live flip (operator-only).
- Images / OG work (back-burner per memory).
