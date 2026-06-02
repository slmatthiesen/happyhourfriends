# Closest-to-me location sort — design

**Date:** 2026-06-01
**Branch context:** `cluster-schema-seed-pipeline`
**Status:** Approved design, ready for implementation plan

## Summary

On a city page, let a visitor share their location to sort the venue list
nearest-first and see each venue's distance. The distance label doubles as a
deep-link that opens turn-by-turn directions from the visitor to the venue.
Location is computed entirely client-side and never sent to the server — a
progressive enhancement layered onto the existing in-memory filter/sort
component, leaving the ISR-cached page untouched.

## Goals

- A visitor can opt in to sharing location via a clear button in the filter bar.
- Once shared, a "Closest to me" sort orders the list nearest-first.
- Each venue row/card shows its distance (e.g. "0.4 mi").
- Clicking a distance opens a map with directions from the visitor to that venue.
- The visitor's coordinates stay in the browser — no network, no storage.

## Non-goals

- No embedded/interactive map (deep-link only, consistent with the existing v1
  non-goal in `DirectionsButton`).
- No radius/within-X-miles filter (sort only, per design decision).
- No server-side distance (PostGIS `ST_Distance`) — overkill at city scale and
  would send location to the server and break the static page cache.
- No persistence of coordinates across sessions (the browser's own permission
  grant makes re-requesting silent).

## Architecture

Client-side haversine. The browser Geolocation API yields the visitor's
coordinates into React state; distance to each venue is computed in-memory in
the same component that already does all filtering and sorting
(`components/venue-table-client.tsx`). City lists are small (tens to low
hundreds of venues), so this is instant and accurate enough. Because location is
purely client-side — like the existing live "Now" badge — the page remains
ISR-cached with no per-request work.

## Components

### 1. Data layer — `lib/queries/venues.ts`

- Add `lat` and `lng` to the `listVenuesForCity` select. The columns already
  exist on `venues` (`db/schema/core.ts:112-113`, `numeric(10,7)`); they are
  returned as strings by the driver, so parse to `number | null`.
- Extend the `VenueListItem` interface with `lat: number | null` and
  `lng: number | null`.
- No migration, no new query, no new round trip. Every venue including stubs
  carries coordinates so nearby stubs sort correctly too.

### 2. Geolocation hook — `lib/geo/useGeolocation.ts` (new, client)

Wraps `navigator.geolocation.getCurrentPosition`. Exposes:

```
{ coords: { lat: number; lng: number } | null,
  status: "idle" | "prompting" | "granted" | "denied" | "unavailable",
  request: () => void,
  clear: () => void }
```

- `status` starts `idle`; `unavailable` when `navigator.geolocation` is absent.
- `request()` sets `prompting`, then `granted` (with coords) or `denied`.
- Coordinates live only in React state — no localStorage, no network. If the
  visitor previously granted permission, `request()` resolves silently.
- `clear()` resets to `idle` and drops coordinates.

### 3. Distance utility — `lib/geo/distance.ts` (new, pure)

- `haversineMiles(a: LatLng, b: LatLng): number` — great-circle distance in
  miles (US launch market).
- `formatDistance(mi: number): string` — "< 0.1 mi" below 0.1, otherwise one
  decimal ("0.4 mi", "1.2 mi").
- Pure and fully unit-testable.

### 4. Maps deep-link — `lib/geo/mapsLink.ts` (new, pure helper + refactor)

- `directionsUrl(dest: { lat, lng } | { address }, origin: LatLng | null, isApple: boolean)`:
  Apple Maps on Apple devices, Google Maps elsewhere (same UA test as the
  current `DirectionsButton`). With an `origin`, builds a directions URL
  (`saddr/daddr` for Apple, `origin/destination` for Google); without one, falls
  back to a search/query URL by destination.
- Refactor the existing `components/directions-button.tsx` to use this helper so
  the Apple-vs-Google logic lives in one place (no duplication).

### 5. Location button + sort — `components/venue-table-client.tsx`

- A "📍 Use my location" chip in the filter bar (Row 2, next to "Happening
  now"). States:
  - **idle** → "📍 Use my location"; click calls `request()`.
  - **prompting** → "Locating…" (disabled).
  - **granted** → chip reads "📍 Near you" (active styling) with a "✕" to
    `clear()`; the Sort dropdown gains a **"Closest to me"** option and that
    becomes the active sort on first grant.
  - **denied / unavailable** → inline muted note ("Location unavailable — check
    browser permissions"); chip returns to idle.
- New `SortKey: "distance"`. The "Closest to me" `<option>` only renders when
  status is `granted`. Clearing location reverts the sort to the default "now".

### 6. Distance label + map link — `components/venue-table-client.tsx`

- When `coords` is set, each desktop row and mobile card shows
  `formatDistance(haversineMiles(coords, venue))` as an accent link.
- Venues missing `lat`/`lng` show no distance and sort to the bottom (distance
  treated as `Infinity`).
- Clicking the distance opens `directionsUrl(coords, venue)` in a new tab
  (`noopener,noreferrer`), reusing the shared maps helper.
- Stubs participate: they show distance labels and sort by distance within their
  own disclosure section when "Closest to me" is active.

## Data flow

1. Page renders server-side (ISR-cached) with venues including `lat`/`lng`.
2. Visitor clicks "📍 Use my location" → browser permission prompt.
3. On grant, coords enter React state; "Closest to me" sort activates; distances
   compute in-memory and render per row.
4. Visitor clicks a distance → maps app/site opens with directions from their
   coords to the venue.
5. Nothing leaves the browser except the visitor-initiated map deep-link.

## Sort & edge-case rules

- Distance sort is independent of promoted-row pinning (pinning applies only on
  the default "now" sort, matching existing logic).
- Missing coordinates → sort last; no distance label shown.
- Without a granted location, the UI is unchanged: no distance column, no
  "Closest to me" option. Pure progressive enhancement.
- Geolocation requires a secure context; production is HTTPS and `localhost` is
  treated as secure, so no extra caveat is needed.

## Testing

- Unit tests (pure): `haversineMiles` (known city-pair distances within
  tolerance), `formatDistance` (threshold + decimal formatting), `directionsUrl`
  (Apple vs Google URL shape, with and without origin).
- Manual smoke test for the hook + component: grant, deny, sort reorders,
  distance labels render, clicking a distance opens the correct maps URL, "✕"
  clears and reverts the sort.

## Affected files

- `lib/queries/venues.ts` — add `lat`/`lng` to select + `VenueListItem`.
- `lib/geo/useGeolocation.ts` — new hook.
- `lib/geo/distance.ts` — new pure util.
- `lib/geo/mapsLink.ts` — new pure helper.
- `components/directions-button.tsx` — refactor onto the shared helper.
- `components/venue-table-client.tsx` — location chip, distance sort, distance
  labels + map links.
