# Populate `venues.type` — design

**Date:** 2026-05-31
**Branch:** `cluster-schema-seed-pipeline`
**Status:** approved (brainstorming → ready for implementation plan)

## Problem

Every venue has `venues.type = NULL` (650/650 at time of writing, multi-city:
Tacoma + Tucson + Phoenix + Scottsdale). The grid (`venue-table-client.tsx`) renders
`—` in the Type column and the venue page omits the type badge entirely. The "Type"
sort and the type filter chips therefore do nothing useful.

The data needed to fix this already exists and is never used: `seed:discover` stores
Google Places `primary_type` and `types[]` on `seed_candidates` (`db/schema/ops.ts`),
but neither the enrich insert (`scripts/seed-enrich-candidates.ts:insertVenueRow`) nor
any backfill ever writes `venues.type`.

### Current data (local DB, 2026-05-31)

- 650 active venues, **all** `type IS NULL`.
- 581 have a candidate `primary_type`; **69** have a candidate but no `primary_type`
  *and* no `types[]` (early Tacoma + `backfill:place-ids` venues — zero Google type data).
- Observed `primary_type` distribution maps cleanly to our enum for most rows:
  `bar`, `sports_bar`, `cocktail_bar`, `brewery`, `night_club`, `gastropub`,
  `irish_pub`, `pizza_restaurant`, `lounge_bar`, `beer_garden` all have direct or
  near-direct enum targets; the long tail of `*_restaurant` / `bar_and_grill` /
  `steak_house` / `fine_dining_restaurant` / `brunch_restaurant` collapse to `restaurant`.

## Goal

Every venue (full or stub, every city) shows a sensible type — never a dash.
Solution must be **scalable, not one-off** (Tacoma is city #1 of 50+) and must not
fabricate data beyond a defensible default.

## Approach — hybrid: deterministic base + AI refine

Decided during brainstorming:

1. **Type source:** Hybrid. A free, deterministic Google-type map sets a base type for
   every venue; the enrich AI may override to a finer type when the site makes it clear.
2. **Blank fallback** (no Google type data): name-keyword pass → `restaurant` default.
3. **Existing venues:** backfill from the map + heuristic now, **and** run a one-time
   cheap AI refine pass (name + Google types only, no web fetch) to upgrade obvious
   finer types immediately.

## Components

### 1. `lib/places/venueType.ts` — shared derivation (single source of truth)

Used by **both** the backfill script and the live enrich insert, so the mapping lives
in exactly one place.

- `VenueType` — the `venue_type` enum union (import/derive from the Drizzle enum).
- `GOOGLE_TYPE_MAP: Record<string, VenueType>` — explicit lookup from Google
  `primaryType` to our enum. Covers every observed value; examples:
  - `sports_bar → sports_bar`
  - `cocktail_bar`, `lounge_bar` → `cocktail_lounge`
  - `night_club` → `club`
  - `brewery`, `beer_garden` → `brewery`
  - `irish_pub`, `pub` → `pub`
  - `pizza_restaurant` → `pizzeria`
  - `gastropub` → `gastropub`
  - `bar` → `bar`
  - `wine_bar` → `wine_bar`
  - `cafe`, `coffee_shop` → `cafe`
  - all other `*_restaurant`, `bar_and_grill`, `steak_house`,
    `fine_dining_restaurant`, `brunch_restaurant`, `meal_takeaway`, etc. → `restaurant`
- `NAME_KEYWORD_RULES: Array<{ re: RegExp; type: VenueType }>` — ordered rules applied
  to the venue **name** when Google data is absent. First match wins. Examples:
  `/brew(ery|ing)|taproom/i → brewery`, `/tasting room|cellars?|winery/i → tasting_room`,
  `/\bpub\b|alehouse/i → pub`, `/cantina|tequila|saloon/i → bar`, `/lounge/i →
  cocktail_lounge`, `/pizz(a|eria)/i → pizzeria`, `/wine bar/i → wine_bar`,
  `/caf[eé]|coffee/i → cafe`, `/sports bar/i → sports_bar`.
- `deriveVenueType({ primaryType, types, name }): VenueType` — resolution order:
  1. `GOOGLE_TYPE_MAP[primaryType]` if present
  2. first `types[]` entry that hits `GOOGLE_TYPE_MAP`
  3. first matching `NAME_KEYWORD_RULES` rule
  4. `restaurant` (final default — safe majority class; never returns `null`)

  Pure, synchronous, no I/O. This is the deterministic "base" layer.
- `VENUE_TYPE_LABELS: Record<VenueType, string>` — human-friendly **display** labels
  (the stored enum keys are machine values; the UI never shows the raw key or a
  `_`-replaced key). Final label set:

  | enum key | label | | enum key | label |
  |---|---|---|---|---|
  | `restaurant` | Restaurant | | `gastropub` | Gastropub |
  | `bar` | Bar | | `club` | Club |
  | `sports_bar` | Sports Bar | | `cafe` | Café |
  | `pub` | Pub | | `hotel_bar` | Hotel |
  | `dive_bar` | Dive | | `pizzeria` | Pizzeria |
  | `wine_bar` | Wine Bar | | `cocktail_lounge` | Cocktails |
  | `brewery` | Brewery | | `other` | Venue |
  | `tasting_room` | Taproom | | | |

  `labelForVenueType(type: VenueType | null): string` — returns the label, or `""`
  for null (so a still-NULL row renders blank, not "Venue"). The map is exhaustive
  over the enum (a TS `Record<VenueType,…>` makes a missing key a compile error).

### 2. `scripts/backfill-venue-types.ts` — one-time + repeatable backfill

`npm run backfill:venue-types -- [--city <slug>] [--no-ai] [--dry-run]`
(add the npm script to `package.json`).

- **Phase 1 — deterministic (always runs):** for each venue (any status, incl. stubs)
  in scope, `LEFT JOIN seed_candidates` on `google_place_id`, call `deriveVenueType`
  with the candidate's `primary_type`/`types` and the venue name, and `UPDATE
  venues SET type = …`. Idempotent (re-running is a no-op when nothing changed).
- **Phase 2 — AI refine (default on; `--no-ai` skips):** a single cheap classification
  pass using **name + Google `types` only, no web fetch**, constrained to the enum,
  to upgrade obvious finer types (`dive_bar`, `hotel_bar`, `sports_bar`,
  `cocktail_lounge`, `gastropub`). Writes the AI value only when the model is confident
  *and* it differs from the Phase-1 base. Records spend to `ai_usage_ledger`
  (`lib/ai/ledger.ts`), is budget-gated, and **fails safe** to the deterministic base
  (also skips with a log line when `ANTHROPIC_API_KEY` is unset — never blocks Phase 1).
  Prefer the Batch API path already used by enrichment for cost if practical; a simple
  Haiku loop is acceptable.
- `--dry-run` prints the before/after type distribution and writes nothing.

### 3. Forward-only enrich integration (the hybrid path for new venues)

- `lib/ai/extractHappyHours.ts`:
  - Add an optional `venueType` property (enum-constrained string, nullable) to the
    `record_happy_hours` tool schema.
  - Add `venueType?: VenueType | null` to `ExtractResult` and parse it in
    `parseRecordedExtract`.
- `prompts/seed-extract-hh.md`: instruct the model to set `venueType` only when the
  site/menu makes the category clear (e.g. an explicit "dive bar", "hotel bar",
  "brewery taproom"); otherwise leave it null. Do not fabricate.
- `lib/ai/enrichBatchState.ts` (`PrepContext`): add `primaryType: string | null` and
  `types: string[] | null` so the base can be derived at insert time. Populate them
  where `PrepContext` is built (from the candidate row).
- `scripts/seed-enrich-candidates.ts`:
  - Compute `base = deriveVenueType(ctx)`; final type = a confident extractor
    `venueType` if present, else `base`.
  - Pass the final type into `insertVenueRow`; add `type` to the venue `INSERT`
    column list and to the `ON CONFLICT … DO UPDATE` set so re-enrich keeps it fresh.

### 4. User-suggested type edits (moderated, like any other field)

A user must be able to change a venue's type the same way they correct any other
field — via the existing unified "report a change" flow
(`components/submit/report-change.tsx`, `targetType:"intent"`), not a new UI. The
free-text note ("this is actually a pub") is parsed by the interpreter into a concrete
`update_venue` change, fans out a child `edit_submissions` row, runs the normal
classify→verify path, and the operator applies it (children never auto-apply).

The apply path already supports it — `type` is in the engine's `VENUE_FIELDS`
allowlist (`lib/apply/engine.ts`) and Postgres' `venue_type` enum is the hard
validation backstop (an invalid value is rejected at write). The gaps to close:

- `lib/ai/interpreter.ts`:
  - Add `type` to the `update_venue` field list in the `record_changes` tool
    description (currently "name/address/phone/websiteUrl/otherUrl/status").
  - Include the current `type` in `venueStateJson` so the model can target it and
    avoid no-op proposals.
  - Constrain the proposed value to the enum: enumerate the valid `venue_type` values
    in the tool description / `prompts/interpret-submission.md`, and **validate the
    `after.type` against the enum before creating the child submission** (drop /
    coerce to `other` rather than emit an invalid value).
- No engine change required (allowlist + DB enum already cover it).

This means the *same* `deriveVenueType` seeds the base, the enrich AI refines it, and
a human can override either through the moderated edit pipeline — one field, three
consistent write paths.

### 5. Schema / display

- **No migration.** `venues.type` column and the `venue_type` enum already exist and
  already include the finer values (`dive_bar`, `tasting_room`, `hotel_bar`,
  `cocktail_lounge`, `gastropub`, etc.).
- **Display now uses labels, not `_`-replacement.** Replace every
  `v.type.replace(/_/g, " ")` site with `labelForVenueType(v.type)`:
  - `components/venue-table-client.tsx` — the Type column cells (desktop + mobile
    cards), the type **filter chips** (chip text = label, value = enum key), and the
    type-sort comparator (sort by label for intuitive ordering).
  - `app/[city]/venue/[slug]/page.tsx` — the header type badge.
  Once `type` is non-null the badge/filter/sort start working; a still-NULL row
  renders blank (no dash, no "Venue").

## Data flow

```
seed:discover ─► seed_candidates.primary_type / types[]
                          │
        ┌─────────────────┴─────────────────┐
        ▼ (existing venues)                   ▼ (new venues, enrich)
backfill:venue-types                    seed-enrich-candidates
  Phase 1: deriveVenueType ─► venues.type   deriveVenueType (base)
  Phase 2: AI refine (opt-out) ─► upgrade     + confident extractor venueType
                                              ─► venues.type at INSERT
                          │
              user "report a change" (free text)
                          │  interpreter → update_venue {type}
                          │  → child edit_submission → classify/verify → operator apply
                          ▼
        grid + venue page render labelForVenueType(type)  (no dash)
```

## Error handling

- `deriveVenueType` always returns a value (never null) — display can never regress to
  a dash for a row that ran through it.
- AI refine (backfill Phase 2 and enrich override) fails safe to the deterministic base
  on any error / low confidence / missing key. AI never *lowers* coverage.
- Backfill is idempotent and `--dry-run`-able.

## Testing

- Table-driven unit test for `deriveVenueType` covering: every observed Google
  `primary_type` → expected enum; `types[]` fallback when `primaryType` is null;
  each name-keyword rule; and the `restaurant` default for no-signal input.
- Unit assertion that `VENUE_TYPE_LABELS` is exhaustive over the enum and
  `labelForVenueType(null) === ""`.
- Interpreter test: a "make this a pub" note maps to an `update_venue` change with
  `after.type === "pub"`; an unmappable/invalid type is dropped (not emitted as a
  bad enum value).
- `--dry-run` distribution check on the live DB before the real write.
- Gates: `tsc --noEmit`, `eslint`, `next build` all clean.

## Out of scope / YAGNI

- No enum changes (existing values suffice).
- No re-discovery or web-fetch for the existing-venue refine pass (name + types only).
- No new UI for type edits — they ride the existing "report a change" flow.
- Display change is limited to swapping `_`-replacement for the label map; no new
  markup, layout, or components.
- No backfill of `types[]` for the 69 zero-Google-type venues — name keywords + default
  cover them.

## Non-negotiables honored

- **No fabricated data:** the only "invented" value is a defensible `restaurant`
  default for venues with no signal; AI is forbidden from guessing finer types without
  evidence. No external aggregator sources touched.
- **Scalable, not one-off:** one shared `deriveVenueType`, driven by Google data already
  collected per city; the backfill takes `--city` and works for every market.
