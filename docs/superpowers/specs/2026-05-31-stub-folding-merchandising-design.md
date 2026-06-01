# Lead with the win, fold the rest — stub-folding & merchandising

**Date:** 2026-05-31
**Branch:** `cluster-schema-seed-pipeline`
**Status:** Approved design, ready for plan

## Problem

The city directory broadcasts how little happy-hour data we have. With ~57 venues
carrying HH data and ~22 stubs (and a larger discovered-but-not-enriched denominator
across cities), the page *reads* as half-empty even though the venues that DO have data
are good. Three places actively advertise the shortfall:

1. **Page header** (`app/[city]/page.tsx`) — `"57 venues with happy hours · 22 stubs needing help"`.
2. **Filter-bar count** (`components/venue-table-client.tsx`) — `"Showing X of Y venues — N with data · M stubs"`.
3. **Stubs pad the scroll** — stub rows sit inline in the main table with blank
   Days/Start/End/Deals/Price cells, so the list feels empty.

## Goal & guardrail

Goal: lead with the strong, true number and make stubs **opt-in** rather than in-your-face.

**Hard guardrail (operator decision: "present honestly, frame well"):** never fabricate
or truly conceal. Nothing implies HH data exists where it doesn't. Stubs remain present,
clearly labeled, and one click away — they are reframed as a crowdsourcing feature, not
hidden. This also respects the project's #1 non-negotiable (never hallucinate data).

Out of scope (explicitly deferred to another thread): the all-day-specials extractor fix
and any re-enrich / data-recovery work. This change is **presentation only** — no schema,
query, or data changes.

## Design (Approach A — "Lead with the win, fold the rest")

### 1. Page header — `app/[city]/page.tsx`

- Lead with only the strong, true count. `withHours` counts **venues**, so the copy must
  say "spots," not "happy hours":
  - **"57 happy hour spots in Tacoma"** (singular: "1 happy hour spot").
- **Remove** the `· {stubs} stubs needing help` clause from the hero entirely.
- The zero-data fallback stays exactly as-is:
  `"We're still gathering happy hours here — help us fill it in."`
- The neighborhood page header (`app/[city]/[neighborhood]/page.tsx`) needs **no change** —
  it already reads `"Happy hours in {hood}, {city}."` and never showed stub counts.

### 2. Table renders HH venues only; stubs fold below — `components/venue-table-client.tsx`

- The desktop table and the mobile card list render **only `withHours`**.
- The existing inline stub markup (the `<tr>` with `colSpan` blank columns, and the mobile
  stub card) **moves out** of the main list into a single collapsible section rendered
  directly beneath the table/cards.
- New local state: `const [showStubs, setShowStubs] = useState(false)` — collapsed by default.
- **Collapsed:** a disclosure button styled as a quiet row, e.g.
  **"＋ 22 more spots we're still confirming — know one? Help us add it"**
  (count from `stubs.length`; singular handled: "1 more spot we're still confirming").
  Hidden entirely when `stubs.length === 0`.
- **Expanded:** stubs render as a clean compact list (NOT ghost table rows), each item:
  `{name (link)} · {type label} · {neighborhood, if showNeighborhood}` followed by a
  `Help us add it →` link to `/{citySlug}/venue/{slug}#add-happy-hour`. This removes the
  blank-column eyesore while keeping every stub reachable and labeled.
- The expander toggle text flips ("Hide" affordance when expanded) and uses
  `aria-expanded` for accessibility.

### 3. Filter-bar count — `components/venue-table-client.tsx`

Current line (around the "Showing X of Y" block) is recast to lead with the HH count and
drop the inline stub number (the stub count now lives only on the expander):

- No filters: **"57 happy hour spots"**.
- Filtered: **"Showing {withHours.length} of {totalWithHours} happy hour spots"**, where
  `totalWithHours` = unfiltered count of venues with `happyHours.length > 0`.
- Singular/plural handled.

### 4. Edge cases

- **Filter leaves 0 HH venues but some stubs:** the main list shows its "No venues match
  your filters" empty state AND the stub expander still renders below — stubs never silently
  vanish. (Implementation: render the stub expander independently of the `filtered.length === 0`
  branch, keyed off the filtered `stubs` array.)
- **Filters apply to stubs too:** stubs in the expander respect the active
  neighborhood/type/tag/search filters (day/now filters naturally exclude all stubs since
  they have no HH rows — unchanged behavior).
- **City with zero venues:** unchanged — the existing `venues.length === 0` early return
  and zero-data header fallback both stay.
- **Mobile:** the fold + expander apply to the mobile card list identically.

## Verification

- `npm run typecheck` (tsc --noEmit) clean (modulo the 2 pre-existing Phase 0 issues).
- `npm run lint` clean (same pre-existing exceptions).
- `npm run build` compiles.
- Manual: `/tacoma` shows the strong header, HH-only main list, collapsed stub expander
  that opens to a clean labeled list; counts read consistently; a neighborhood page folds
  the same way.

## Files touched

- `app/[city]/page.tsx` — header copy only.
- `components/venue-table-client.tsx` — main-list filtering to HH-only, stub expander
  (state + collapsed/expanded markup, desktop + mobile), filter-bar count rewording.

No new dependencies. No migration. No data writes.
