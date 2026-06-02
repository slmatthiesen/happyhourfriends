# City expansion: nested state/city routing + new markets (Daly City, Five Cities, SLO)

**Date:** 2026-06-02
**Status:** Approved design, pending implementation plan
**Branch:** `feature/city-expansion-nested-routing`

## Goal

Release three new California markets — **Daly City**, the **Five Cities (Central
Coast)** area, and **San Luis Obispo** — on the existing multi-city-native pipeline.
Before adding them, fix a foundational scaling flaw surfaced during design: city
identity is not globally unique, so same-named cities/regions across states will
collide. We are at city ~#5 of a planned ~1000; the fix is cheapest now.

The work splits into a **prerequisite refactor** (routing + identity + release gating)
and a **repeatable per-city onboarding runbook** applied to the three markets.

## Background

The codebase is already multi-city-native (see `multi-city-architecture` memory and
`CLAUDE.md`). Each city is a `cities` row carrying a `seed_config` JSONB
(`radiusKm`, `cellMeters`, `serviceLocalities`, optional `serviceBufferMeters`) and an
optional `data/<city>-boundary.geojson`. The onboarding funnel is
`seed:discover → seed:enrich → neighborhood imports → backfills → scope:venues →
realness review → push:data`.

Two gaps motivate this spec:

1. **`cities.slug` is globally unique** (the discover/seed path `ON CONFLICT (slug)`),
   and the public route is a flat `/[city]` with bare slugs (`tacoma`, `tucson`,
   `phoenix-central`, `scottsdale`). Bare names collide across states
   (`san-luis-obispo`, `five-cities` could exist in multiple states). `venues.slug` is
   already unique per `(city_id, slug)` — cities should follow the same precision.
2. **`listCities` does not filter on `cities.status`** — every city row appears on the
   landing page immediately, even mid-enrichment with zero or half-baked venues. There
   is no safe way to stage a city in prod before publishing.

## Non-goals

- International support (country segment / `/us/...`). YAGNI for a US-only product;
  the state-nested scheme leaves room to add it later.
- Per-city neighborhood curation beyond the existing generic pipeline (OSM presence +
  cardinal districts). Recognizable-share ceilings are data-availability limits, not
  bugs (see `neighborhood-recognizability-pipeline` memory).
- Changing the extractor / enrich logic. Known limitations (all-day specials,
  JS-walled menus) are tracked separately and out of scope here.

## Design

### 1. Routing & identity refactor (prerequisite, lands first)

Migrate flat `/[city]` to nested `/[state]/[city]`.

- **Routes:** move `app/[city]/*` → `app/[state]/[city]/*`. The city page, the
  `[neighborhood]` route, and the `venue/[slug]` route all move under the new nesting:
  - `/[state]/[city]`
  - `/[state]/[city]/[neighborhood]`
  - `/[state]/[city]/venue/[slug]`
- **Schema (migration):**
  - `cities.state` → `NOT NULL`; backfill existing rows (WA / AZ).
  - Replace the global unique constraint on `cities.slug` with a composite unique
    constraint on `(state, slug)`. Update the discover/seed `ON CONFLICT (slug)` paths
    to conflict-target `(state, slug)`.
  - `cities.slug` stays the **bare** city slug (e.g. `tacoma`, `daly-city`), now unique
    only within its state.
- **Link/render surface:** update every internal link builder, `listCities` /
  `CityPicker`, `sitemap.xml`, `robots.txt`, JSON-LD `url`/`@id` fields, and all
  `generateStaticParams` to emit `/[state]/[city]/...`. State slug is lowercased
  two-letter (`wa`, `az`, `ca`).
- **Redirects:** add **301** redirects in `next.config.ts` for the existing bare URLs
  (`/tacoma` → `/wa/tacoma`, `/tucson` → `/az/tucson`, `/phoenix-central` →
  `/az/phoenix-central`, `/scottsdale` → `/az/scottsdale`), plus their
  `/[neighborhood]` and `/venue/[slug]` children, so existing links/SEO don't break.
  Root `/` still redirects to a default city (now `/wa/tacoma`).
- **Re-slug existing cities:** slugs become bare names under their state
  (`tacoma`/`wa`, `tucson`/`az`, `phoenix-central`/`az`, `scottsdale`/`az`). The
  `phoenix-central` slug is retained as-is (it's a meaningful sub-area name, not a
  collision risk within AZ).

### 2. Release gating (pairs with the refactor)

- Add a `status = 'live'` filter to `listCities` and to the city/neighborhood/venue
  route handlers. A request for a non-`live` city's route 404s (or redirects to `/`).
- New cities are seeded in `status='discovery'`, moved through `enriching`, and flipped
  to `live` only after review. This enables safe staging in prod and is reusable for
  every future city.
- The `status` enum already exists (`discovery | enriching | live | paused`); this just
  starts honoring it on the read path.

### 3. Repeatable per-city onboarding runbook

The durable artifact — documented in the repo (e.g. `docs/onboard-city-runbook.md`) and
run for each new city and every future one:

1. **City row** — add to `scripts/seed-cities.ts` with `state`, `timezone`, centroid,
   and `seed_config` (`radiusKm`, `cellMeters`, `serviceLocalities`, optional
   `serviceBufferMeters`); run `seed:cities`. Status starts `discovery`.
2. **Boundary** — add `data/<city>-boundary.geojson` (municipal boundary, or a combined
   multi-town polygon for Five Cities), sourced from OSM/Census. Discovery prefers
   boundary mode + buffer over the radius circle.
3. **Discover** — `seed:discover -- --city <slug>` (Google Places; denylist / junk
   type / locality / boundary gated → `seed_candidates`).
4. **Enrich** — `seed:enrich -- --city <slug> --limit N` (Place Details gate → Haiku
   `web_fetch` extractor → venues + `happy_hours`; likely-HH spots with no published
   times stay as help-wanted stubs). Monitor `ai:spend`; set a Console cap.
5. **Neighborhoods** — `import:osm-neighbourhoods` → `backfill:neighborhood-tiers` →
   `generate:cardinal-districts` → `backfill:neighborhoods` →
   `analyze:neighborhood-coverage` (target ≥95% assignment via polygons). For Five
   Cities, the five towns form the recognizable named layer.
6. **Backfills / scope** — `backfill:timezones`, `backfill:venue-types`,
   `scope:venues` (boundary + buffer prune).
7. **Review** — `review:suspect` (realness gate), spot-check, optional targeted
   `reextract:stubs --venue <id|name> --url <pdf>` for JS-walled / PDF menus.
8. **Publish** — flip status to `live`; `push:data` to prod.

### 4. The three specific markets

All three are California (`state = ca`).

- **Daly City** — `/ca/daly-city`, slug `daly-city`, display `Daly City`,
  `America/Los_Angeles`. Standard single city. Tight municipal boundary + small buffer;
  locality gate `["Daly City"]`. The SF / Colma / South San Francisco border is dense,
  so the boundary gate is load-bearing (cf. Scottsdale vs Phoenix). Risk flagged: may
  return thin — many locals drink in SF — but it ships regardless (operator's city).
- **Five Cities (Central Coast)** — `/ca/five-cities`, slug `five-cities`, display
  `Five Cities (Central Coast)`, `America/Los_Angeles`. Combined market. Combined
  boundary covering Pismo Beach, Grover Beach, Arroyo Grande, Oceano, and Shell Beach;
  locality gate lists all five (Shell Beach is part of Pismo Beach). The five towns are
  the recognizable neighborhood layer. Display name carries the regional hint so
  out-of-towners recognize it; slug stays `five-cities`.
- **San Luis Obispo** — `/ca/san-luis-obispo`, slug `san-luis-obispo`, display
  `San Luis Obispo`, `America/Los_Angeles`. Standard single city; own boundary +
  `["San Luis Obispo"]` gate. Distinct from Five Cities so the two don't read as
  overlapping (SLO is also "Central Coast" — hence the explicit separation).

**Sequence:** Daly City first as the pilot (validates the refactor end-to-end on one
city), then Five Cities, then San Luis Obispo.

### 5. Testing & verification

- Unit tests: `(state, slug)` uniqueness behavior; the bare-URL → nested 301 redirect
  map; state-slug normalization.
- `tsc --noEmit`, `eslint`, `next build` all clean (modulo the two pre-existing Phase 0
  lint issues).
- Verify the full pipeline end-to-end on Daly City before onboarding the other two.
- PRD §13 non-negotiables hold: never hallucinate data (missing → `null`, no HH → stub),
  ISO day-of-week, venue-local times, dedup on `google_place_id`, every applied change
  carries a `source_url`. First-party data only — no competitor-aggregator sources.

## Risks & open items

- **Redirect completeness:** the 301 map must cover city, neighborhood, and venue
  children for all four existing cities, or inbound links 404. Tested explicitly.
- **`state` backfill:** existing rows must get correct, canonical two-letter states
  before the `NOT NULL` + composite-unique migration applies.
- **Daly City yield:** may be thin; acceptable, crowdsourcing fills gaps.
- **Five Cities boundary sourcing:** needs a combined multi-polygon; verify it doesn't
  bleed into San Luis Obispo's gate.
- **Prod migration ordering:** the routing/identity migration and re-slug must land and
  be verified on prod before any new city flips to `live`.

## Rollout order

1. Routing & identity refactor + release gating (one PR) — verified, redirects tested,
   merged, migrated on prod.
2. Daly City onboarding (pilot) — runbook end-to-end, flip to `live`.
3. Five Cities (Central Coast) onboarding.
4. San Luis Obispo onboarding.
