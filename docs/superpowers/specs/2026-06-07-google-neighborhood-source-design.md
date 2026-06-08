# Google-name neighborhood source — design

**Date:** 2026-06-07
**Status:** approved (design); pending implementation plan
**Author:** session with operator

## Problem

Neighborhood assignment is polygon-based: `venues.neighborhood_id` is set by spatial
containment against `neighborhoods` polygons (OSM `place=neighbourhood`, city GIS, or
generated cardinal districts). This works for GIS-rich cities (Tucson: 157 fine polygons
from Pima County GIS) but degrades badly where polygon coverage is thin:

- **Oakland:** OSM returned **2** area-polygons (its neighborhoods are point-nodes, not
  areas; no easy GIS GeoJSON). Result: 112 of 164 venues lumped into a generated "North
  Oakland" cardinal district. 99.4% coverage but useless granularity — no Temescal,
  Rockridge, Uptown, Jack London, Lake Merritt.
- **Daly City (1 fine), Five Cities (4 fine):** equally thin, but acceptable because they
  are small markets where town ≈ neighborhood.

The polygon path has a chronic data-availability ceiling that no amount of source-swapping
(OSM → Census → Zillow → cardinal) fully closes.

## Why this was missed originally (lesson)

1. **The neighborhood field was never in any Google field mask.** `grep` for
   `addressComponents`/`addressDescriptor`/`sublocality` across the codebase is **empty**.
   We call Google Places for every venue at discovery, but the mask only ever grew toward
   `websiteUri` → atmosphere. Google's per-venue neighborhood name was invisible — an
   unweighable source.
2. **The model was polygon-first from the PRD, and every iteration optimized within that
   frame.** The original spec (`2026-06-01-friendly-neighborhood-recognizability-design.md`)
   poses the problem entirely as "the polygon layer is a mix of granularities / assignment
   picks by geometry," and all its sourcing options are polygon layers. Even the clever
   recognizability signal (OSM `wikidata` presence) is a workaround for polygons being the
   only source. "Is there a neighborhood name in an API we already call?" was never asked.

This is "polish the weak heuristic instead of reading the source of truth"
(`feedback_propose_structural_approach`). It stayed hidden because GIS-rich cities looked
fine, masking the gap until Oakland had neither good OSM nor easy GIS.

**Lesson to carry forward:** before building machinery to reconstruct data, check whether
an API/source we already pay for returns it directly.

## Validation (the test that motivated this)

Pulled `addressComponents` + `addressDescriptor` for 5 Oakland venues:

| Venue | `addressComponents` neighborhood |
|---|---|
| ForTheCulture Oak | Downtown Oakland (also "Old Oakland") |
| Limón | Northgate - Waverly |
| Book Society | Elmwood |
| Dimond Slice Pizza | Upper Dimond (also "Dimond District") |
| East End | none |

4 of 5 returned a real vernacular neighborhood. `addressComponents` (one clean name) is
better than `addressDescriptor` (richer but noisy — returned "Parking lot", apartment
names). **Use `addressComponents`.**

## Goals

- Make neighborhoods correct, vernacular, and consistent for every city — cheaply.
- **New cities:** $0 (the neighborhood name rides the discovery call we already pay for).
- **Existing cities:** a cheap, opt-in, per-city backfill.
- No per-city GIS hunting, no OSM-coverage dependence going forward.

## Non-goals

- Map polygons for Google-named neighborhoods (we get a name, not a shape — fine; a
  directory filter needs a name + grouping, not a polygon).
- Replacing the polygon/cardinal layers — they remain the **fallback**.
- Hand-curated per-city neighborhood lists.

## Scope

- **New cities:** capture `addressComponents` at discovery — always on, $0.
- **Backfill all 6 existing cities** (Oakland, Tucson, Phoenix, Tacoma, Daly City, Five
  Cities) via the opt-in script. Total estimated ~$10 **pending SKU verification** (see
  Cost). Operator opted to do all six since the cost is small and it keeps the model
  uniform.

## Design

### Precedence (operator-chosen: Google name primary)

`assignNeighborhoods` resolves each venue in order:

1. **Google name** — if the venue has a *real* Google neighborhood name (passes the noise
   filter) → assign to that name-only `neighborhoods` row (upsert if missing).
2. **Spatial polygon** — else existing `ST_DWithin` match against polygon-backed rows.
3. **Cardinal district** — else the generated cardinal zone.
4. **NULL** — else unassigned.

Rationale: per-venue, vernacular, uniform across cities; upgrades the big cities to
current names; the fallback chain protects against Google's ~20% blanks.

### Data capture

- **Discovery** (`seed-discover-tacoma.ts`): add `places.addressComponents` to the field
  mask (no tier bump — already at atmosphere). Parse the component whose `types` include
  `neighborhood` (preferred) or `sublocality`/`sublocality_level_1` → store on
  `seed_candidates.google_neighborhood`.
- **Enrich** (`seed-enrich-candidates.ts`): carry `google_neighborhood` from candidate
  onto the venue row.
- **Backfill** (`scripts/backfill-google-neighborhoods.ts`, new): per-city, opt-in
  (`--city --state`). For each venue with a `google_place_id`, fetch an
  `addressComponents`-only Place Details (basic tier), parse + store the name, then run
  assignment. Idempotent; `--dry-run` previews; logs how many resolved.

### Neighborhood rows

For each distinct real Google name in a city, upsert a **name-only** `neighborhoods` row:
`polygon = NULL`, `tier = 'fine'`, `recognizability` = high (it's vernacular by
definition), `source = 'Google Places'`, `slug = slugify(name)` unique per city. The
`polygon` column is already nullable.

### Noise filter

Reject a Google value and fall through to spatial/cardinal when it is:
- the city name itself (e.g. "Oakland", "Tucson"),
- empty/absent,
- an obvious non-neighborhood ("Parking lot", and a small denylist we extend as we see
  them).

Normalize names (trim, collapse whitespace, consistent casing) before slugging to dedupe.

### Schema (one migration)

- `seed_candidates.google_neighborhood text` (nullable)
- `venues.google_neighborhood text` (nullable) — the raw captured name, so re-assignment
  is possible without re-hitting Google.

Storing the raw name on the venue (not just the FK) keeps assignment re-runnable and
debuggable, and lets the upsert-name-row step run idempotently.

### Components / files touched

| File | Change |
|---|---|
| `lib/places/placeDetails.ts` | parse neighborhood from `addressComponents` (shared by discovery + backfill) |
| `scripts/seed-discover-tacoma.ts` | add `addressComponents` to mask; store on candidate |
| `scripts/seed-enrich-candidates.ts` | carry `google_neighborhood` candidate → venue |
| `scripts/backfill-google-neighborhoods.ts` (new) | per-city opt-in backfill |
| `lib/geo/assignNeighborhoods.ts` | name-primary precedence + upsert name-only rows |
| `db/migrations/` | add the two columns |

## Cost

- **New cities:** $0 (rides the atmosphere discovery call).
- **Backfill:** `addressComponents`-only Place Details is Google's basic data tier — far
  below the atmosphere tier ($0.04/call) used elsewhere. Estimated ~$10 for all ~2,000
  venues. **This estimate MUST be confirmed against the actual SKU before the first
  backfill run** — the first line item of implementation is a 1-call price check, not a
  trust-the-memory number. (Prior mis-quote in this session used the atmosphere price by
  mistake; do not repeat.)

## Testing

- **Unit:** name normalization; noise filter (city-name + junk rejection); precedence
  ordering (Google > polygon > cardinal > null).
- **Integration:** rolled-back txn — seed venues with/without Google names + polygons,
  assert name-primary with polygon fallback, and that name-only rows are created once.

## Risks / open items

- **Google returns coarser-than-ideal names** for some venues (city-only handled by the
  filter; a too-broad-but-real name like "Downtown" is acceptable).
- **Name drift** (Google renames an area) → re-running backfill/discovery reconciles;
  name-only rows upsert by slug.
- **Big-city regression:** for Tucson/Phoenix/Tacoma, Google-primary may move some venues
  off their current polygon neighborhood. Mitigation: spot-check after backfill; the
  fallback preserves polygon assignment wherever Google is blank/city-only.
- **`addressDescriptor`** intentionally deferred (noisier); revisit only if
  `addressComponents` coverage proves insufficient.
