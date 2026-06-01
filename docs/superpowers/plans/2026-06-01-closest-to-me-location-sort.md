# Closest-to-me Location Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a city-page visitor share their location to sort venues nearest-first, see each venue's distance, and tap a distance to open turn-by-turn directions — all computed client-side.

**Architecture:** Browser Geolocation API → coordinates held in React state (never sent to the server). Distance computed in-memory with haversine inside the existing all-in-memory filter/sort component (`venue-table-client.tsx`). The page stays ISR-cached because location is purely client-side, like the live "Now" badge. Pure utilities (distance, maps deep-link) are extracted and unit-tested; the existing `DirectionsButton` is refactored onto the shared maps helper.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript strict · Drizzle ORM · `tsx` standalone test scripts with `node:assert/strict` (the project's test convention — no Jest/Vitest).

---

## File structure

| File | Responsibility | New/Modified |
| --- | --- | --- |
| `lib/geo/distance.ts` | Pure `haversineMiles` + `formatDistance` + `LatLng` type | Create |
| `lib/geo/mapsLink.ts` | Pure `directionsUrl` + `isApplePlatform` deep-link helper | Create |
| `lib/geo/useGeolocation.ts` | Client hook wrapping `navigator.geolocation` | Create |
| `components/directions-button.tsx` | Refactor onto `directionsUrl` (no logic change) | Modify |
| `lib/queries/venues.ts` | Add `lat`/`lng` to select + `VenueListItem` | Modify |
| `components/venue-table-client.tsx` | Location chip, distance sort, distance labels + map links | Modify |
| `scripts/test-distance.ts` | Unit checks for distance util | Create |
| `scripts/test-maps-link.ts` | Unit checks for maps-link helper | Create |
| `package.json` | Wire `test:distance` + `test:maps-link` scripts | Modify |

**Testing note:** This project has no Jest/Vitest. Unit tests are standalone scripts run with `npx tsx scripts/test-*.ts` that use `node:assert/strict` and exit non-zero on failure (see `scripts/test-resolve-bounds.ts` for the canonical pattern). Pure utilities get these tests; the React hook and component get a typecheck + lint + build gate plus a manual smoke test, because they depend on the browser geolocation API and can't run under `tsx`.

---

## Task 1: Distance utility

**Files:**
- Create: `lib/geo/distance.ts`
- Test: `scripts/test-distance.ts`
- Modify: `package.json` (add `test:distance` script)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-distance.ts`:

```ts
/**
 * Unit checks for the distance util. Run: npx tsx scripts/test-distance.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { haversineMiles, formatDistance } from "@/lib/geo/distance";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
function approx(actual: number, expected: number, tol: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected} ± ${tol}, got ${actual}`,
  );
}

// One degree of longitude at the equator ≈ 69.09 miles.
check("1° longitude at equator ≈ 69.09 mi", () =>
  approx(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), 69.09, 0.5, "lng"));
// One degree of latitude ≈ 69.09 miles anywhere.
check("1° latitude ≈ 69.09 mi", () =>
  approx(haversineMiles({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 69.09, 0.5, "lat"));
// Identical points → 0.
check("identical points → 0 mi", () =>
  assert.equal(haversineMiles({ lat: 47, lng: -122 }, { lat: 47, lng: -122 }), 0));
// Real-world sanity: Tacoma → Seattle is ~25 miles.
check("Tacoma → Seattle ≈ 25 mi", () =>
  approx(
    haversineMiles({ lat: 47.2426, lng: -122.4597 }, { lat: 47.6062, lng: -122.3321 }),
    25.3,
    2.0,
    "tac-sea",
  ));

// formatDistance thresholds.
check("< 0.1 mi label below a tenth", () =>
  assert.equal(formatDistance(0.04), "< 0.1 mi"));
check("zero formats as < 0.1 mi", () =>
  assert.equal(formatDistance(0), "< 0.1 mi"));
check("one decimal at 0.44", () =>
  assert.equal(formatDistance(0.44), "0.4 mi"));
check("one decimal at 1.24", () =>
  assert.equal(formatDistance(1.24), "1.2 mi"));
check("whole number keeps one decimal", () =>
  assert.equal(formatDistance(2), "2.0 mi"));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-distance.ts`
Expected: FAIL — `Cannot find module '@/lib/geo/distance'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/geo/distance.ts`:

```ts
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle (haversine) distance between two points, in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "< 0.1 mi" under a tenth of a mile, otherwise one decimal e.g. "0.4 mi". */
export function formatDistance(mi: number): string {
  if (mi < 0.1) return "< 0.1 mi";
  return `${mi.toFixed(1)} mi`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-distance.ts`
Expected: PASS — `9 checks passed.`

- [ ] **Step 5: Wire the npm script**

In `package.json`, add to `scripts` (next to the other `test:*` entries):

```json
"test:distance": "tsx scripts/test-distance.ts",
```

- [ ] **Step 6: Commit**

```bash
git add lib/geo/distance.ts scripts/test-distance.ts package.json
git commit -m "feat(geo): haversine distance util + miles formatter"
```

---

## Task 2: Maps deep-link helper + DirectionsButton refactor

**Files:**
- Create: `lib/geo/mapsLink.ts`
- Test: `scripts/test-maps-link.ts`
- Modify: `package.json` (add `test:maps-link` script)
- Modify: `components/directions-button.tsx`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-maps-link.ts`:

```ts
/**
 * Unit checks for the maps deep-link helper. Run: npx tsx scripts/test-maps-link.ts
 * — exits non-zero on any failure. `isApplePlatform` reads navigator and is NOT
 * tested here (it's a thin UA wrapper exercised only in the browser).
 */
import assert from "node:assert/strict";
import { directionsUrl } from "@/lib/geo/mapsLink";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const origin = { lat: 3, lng: 4 };
const dest = { lat: 1, lng: 2 };

check("Apple directions with origin → saddr/daddr", () =>
  assert.equal(
    directionsUrl(dest, origin, true),
    "https://maps.apple.com/?saddr=3,4&daddr=1,2",
  ));
check("Google directions with origin → origin/destination", () =>
  assert.equal(
    directionsUrl(dest, origin, false),
    "https://www.google.com/maps/dir/?api=1&origin=3,4&destination=1,2",
  ));
check("Apple no origin → query", () =>
  assert.equal(directionsUrl(dest, null, true), "https://maps.apple.com/?q=1,2"));
check("Google no origin → search query", () =>
  assert.equal(
    directionsUrl(dest, null, false),
    "https://www.google.com/maps/search/?api=1&query=1,2",
  ));
check("address destination is URL-encoded", () =>
  assert.equal(
    directionsUrl({ address: "1 Main St, Tacoma" }, null, false),
    "https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Tacoma",
  ));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-maps-link.ts`
Expected: FAIL — `Cannot find module '@/lib/geo/mapsLink'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/geo/mapsLink.ts`:

```ts
import type { LatLng } from "@/lib/geo/distance";

export type MapDestination = LatLng | { address: string };

function destToken(dest: MapDestination): string {
  return "address" in dest
    ? encodeURIComponent(dest.address)
    : `${dest.lat},${dest.lng}`;
}

/**
 * Deep-link to a maps app. Apple Maps on Apple platforms, Google Maps elsewhere
 * (deep-link only — embedding a map is a v1 non-goal). With an `origin`, returns a
 * directions URL (origin → destination); without one, a search/query URL for the
 * destination only.
 */
export function directionsUrl(
  dest: MapDestination,
  origin: LatLng | null,
  isApple: boolean,
): string {
  const d = destToken(dest);
  if (isApple) {
    return origin
      ? `https://maps.apple.com/?saddr=${origin.lat},${origin.lng}&daddr=${d}`
      : `https://maps.apple.com/?q=${d}`;
  }
  return origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${d}`
    : `https://www.google.com/maps/search/?api=1&query=${d}`;
}

/** UA test for Apple platforms (same heuristic the DirectionsButton used). */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Mac/.test(navigator.userAgent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-maps-link.ts`
Expected: PASS — `5 checks passed.`

- [ ] **Step 5: Refactor DirectionsButton onto the helper**

Replace the body of `components/directions-button.tsx` with (JSX unchanged, only the `open` logic and imports change):

```tsx
"use client";

import { directionsUrl, isApplePlatform } from "@/lib/geo/mapsLink";

// Apple Maps on Apple devices, Google Maps elsewhere (PRD §6.3). We deep-link
// rather than embed a map (a v1 non-goal). Styled as a plain accent link with a
// map-pin icon to match the sibling row actions — not a filled yellow CTA.
export function DirectionsButton({ address }: { address: string }) {
  function open() {
    const url = directionsUrl({ address }, null, isApplePlatform());
    window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-cool hover:underline"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
      Directions
    </button>
  );
}
```

- [ ] **Step 6: Wire the npm script + verify typecheck**

In `package.json`, add to `scripts`:

```json
"test:maps-link": "tsx scripts/test-maps-link.ts",
```

Run: `npm run typecheck`
Expected: PASS (no new errors; the two pre-existing Phase 0 lint/type notes in `db/schema/moderation.ts` + `scripts/import-neighborhoods.ts` are unrelated).

- [ ] **Step 7: Commit**

```bash
git add lib/geo/mapsLink.ts scripts/test-maps-link.ts package.json components/directions-button.tsx
git commit -m "feat(geo): shared maps deep-link helper; refactor DirectionsButton onto it"
```

---

## Task 3: Add lat/lng to the city venue query

**Files:**
- Modify: `lib/queries/venues.ts` (interface ~line 19-43; select ~line 194-211; map ~line 313-326)

- [ ] **Step 1: Extend the VenueListItem interface**

In `lib/queries/venues.ts`, add two fields to the `VenueListItem` interface (after `minPriceCents`, around line 42):

```ts
  /** Cheapest priced offering across this venue's hours (fallback price signal). */
  minPriceCents: number | null;
  /** Venue coordinates (WGS84). Drives the client-side "Closest to me" sort. */
  lat: number | null;
  lng: number | null;
```

- [ ] **Step 2: Select lat/lng in listVenuesForCity**

In the `.select({ ... })` of `listVenuesForCity` (after `hoursJson: venues.hoursJson,`, around line 208):

```ts
      hoursJson: venues.hoursJson,
      lat: venues.lat,
      lng: venues.lng,
```

- [ ] **Step 3: Parse the numeric strings in the return map**

The `lat`/`lng` columns are `numeric` and come back from the driver as strings, so parse to numbers in the final `rows.map(...)` (around line 317-325). The explicit `lat`/`lng` keys must come AFTER `...r` so they override the spread string values:

```ts
    return {
      ...r,
      neighborhoodName: showHood ? r.neighborhoodName : null,
      neighborhoodSlug: showHood ? r.neighborhoodSlug : null,
      happyHours: byVenue.get(r.id) ?? [],
      tags: tagsByVenue.get(r.id) ?? [],
      offerings: offersByVenue.get(r.id) ?? [],
      minPriceCents: minPriceByVenue.get(r.id) ?? null,
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
    };
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS. `VenueListItem` now carries `lat`/`lng`; the spread-then-override keeps the object assignable to the interface.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/venues.ts
git commit -m "feat(queries): expose venue lat/lng on VenueListItem for distance sort"
```

---

## Task 4: Geolocation hook

**Files:**
- Create: `lib/geo/useGeolocation.ts`

- [ ] **Step 1: Write the hook**

Create `lib/geo/useGeolocation.ts`:

```ts
"use client";

import { useCallback, useState } from "react";
import type { LatLng } from "@/lib/geo/distance";

export type GeoStatus =
  | "idle"
  | "prompting"
  | "granted"
  | "denied"
  | "unavailable";

export interface UseGeolocation {
  coords: LatLng | null;
  status: GeoStatus;
  request: () => void;
  clear: () => void;
}

/**
 * Thin wrapper over the browser Geolocation API. Coordinates live only in React
 * state — never written to storage, never sent over the network. If the visitor
 * previously granted permission, `request()` resolves silently (no re-prompt).
 */
export function useGeolocation(): UseGeolocation {
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("prompting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const clear = useCallback(() => {
    setCoords(null);
    setStatus("idle");
  }, []);

  return { coords, status, request, clear };
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/geo/useGeolocation.ts
git commit -m "feat(geo): client useGeolocation hook (state-only, never persisted)"
```

---

## Task 5: Wire location into the venue table client

**Files:**
- Modify: `components/venue-table-client.tsx`

This is the integration task. Apply each edit, then run the full verification gate at the end.

- [ ] **Step 1: Add imports**

At the top of `components/venue-table-client.tsx`, add:

```tsx
import { haversineMiles, formatDistance } from "@/lib/geo/distance";
import { directionsUrl, isApplePlatform } from "@/lib/geo/mapsLink";
import { useGeolocation } from "@/lib/geo/useGeolocation";
```

- [ ] **Step 2: Add "distance" to the SortKey union**

Change the `SortKey` type (around line 28):

```tsx
type SortKey = "now" | "distance" | "startTime" | "endTime" | "name" | "neighborhood" | "type" | "price";
```

- [ ] **Step 3: Add a DistanceLink presentational component**

Add this module-level component near the other helpers (e.g. after `NowBadge`, before `VenueTableClient`):

```tsx
/**
 * Clickable distance label. Renders nothing if the venue has no coordinates.
 * The label opens turn-by-turn directions from the visitor (origin) to the venue
 * via the shared maps deep-link helper.
 */
function DistanceLink({
  origin,
  venue,
}: {
  origin: { lat: number; lng: number };
  venue: VenueListItem;
}): React.JSX.Element | null {
  if (venue.lat == null || venue.lng == null) return null;
  const dest = { lat: venue.lat, lng: venue.lng };
  const mi = haversineMiles(origin, dest);
  return (
    <a
      href={directionsUrl(dest, origin, isApplePlatform())}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-cool hover:underline"
      title={`Directions to ${venue.name}`}
    >
      {formatDistance(mi)}
    </a>
  );
}
```

- [ ] **Step 4: Instantiate the hook + auto-select the sort on grant**

Inside `VenueTableClient`, near the other `useState` declarations (after `const [showStubs, setShowStubs] = useState(false);`):

```tsx
  const geo = useGeolocation();
```

Then add an effect (near the existing `useEffect` for the minute tick) that switches to the distance sort the first time location is granted:

```tsx
  // When the visitor first shares location, default the sort to "Closest to me".
  // Fires only on the transition into "granted" (deps unchanged afterward), so a
  // later manual sort change is not overridden.
  useEffect(() => {
    if (geo.status === "granted") setSortKey("distance");
  }, [geo.status]);
```

- [ ] **Step 5: Add a location-clear handler that also reverts the sort**

Add near the other handlers (e.g. after `clearFilters`):

```tsx
  function clearLocation() {
    geo.clear();
    setSortKey((k) => (k === "distance" ? "now" : k));
  }
```

- [ ] **Step 6: Add the "distance" sort case**

In the sort `switch (sortKey)` block, add a case alongside the others (e.g. right after the `"now"` case). Reference `geo.coords` via a local captured at the top of the `useMemo` callback — add `const coords = geo.coords;` as the first line inside the `useMemo(() => { ... })` for filter+sort, then:

```tsx
        case "distance": {
          const d = (v: VenueListItem) =>
            coords && v.lat != null && v.lng != null
              ? haversineMiles(coords, { lat: v.lat, lng: v.lng })
              : Infinity;
          const ad = d(a);
          const bd = d(b);
          return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
        }
```

- [ ] **Step 7: Add geo.coords to the filter/sort useMemo deps**

In the dependency array of the filter+sort `useMemo` (currently ending `..., sortKey,`), add `geo.coords`:

```tsx
    sortKey,
    geo.coords,
  ]);
```

- [ ] **Step 8: Render the "Closest to me" sort option (only when granted)**

In the Sort `<select>`, add the option right after `<option value="now">Happening now</option>`:

```tsx
              <option value="now">Happening now</option>
              {geo.status === "granted" && (
                <option value="distance">Closest to me</option>
              )}
```

- [ ] **Step 9: Add the location chip to the day-pills row (Row 2)**

In the Row 2 `<div>` (the one with the day pills + "Happening now"), append after the "Happening now" `<button>`:

```tsx
          {geo.status === "granted" ? (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-accent-cool bg-accent-cool px-2.5 py-0.5 text-xs font-medium text-white">
              <span aria-hidden="true">📍</span> Near you
              <button
                onClick={clearLocation}
                aria-label="Clear location"
                className="ml-0.5 leading-none hover:opacity-80"
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              onClick={geo.request}
              disabled={geo.status === "prompting"}
              aria-pressed={false}
              className="ml-2 rounded-full border border-border bg-bg-elevated px-2.5 py-0.5 text-xs font-medium text-text-muted transition-colors hover:border-accent-cool hover:text-text-primary disabled:opacity-60"
            >
              {geo.status === "prompting" ? "Locating…" : "📍 Use my location"}
            </button>
          )}
          {(geo.status === "denied" || geo.status === "unavailable") && (
            <span className="ml-1 text-xs text-text-muted">
              Location unavailable — check browser permissions
            </span>
          )}
```

- [ ] **Step 10: Show distance under the venue name (desktop table)**

In the desktop table's Venue `<td>` (the cell with the `Link` to the venue), add the distance below the name:

```tsx
                      <td className="px-4 py-3">
                        <Link
                          href={`/${citySlug}/venue/${v.slug}`}
                          className="hover:text-accent-cool"
                        >
                          {v.name}
                        </Link>
                        {geo.coords && (
                          <div className="mt-0.5 text-xs">
                            <DistanceLink origin={geo.coords} venue={v} />
                          </div>
                        )}
                      </td>
```

- [ ] **Step 11: Show distance on the mobile card**

In the mobile card, after the type/neighborhood meta `<p>` (the one joining `labelForVenueType` and `neighborhoodName`), add:

```tsx
                  {geo.coords && (
                    <p className="mt-0.5 text-xs">
                      <DistanceLink origin={geo.coords} venue={v} />
                    </p>
                  )}
```

- [ ] **Step 12: Show distance in the stubs list**

In the stubs `<li>`, inside the first `<span>` (the one holding the venue `Link` + type/neighborhood meta), append the distance after the meta span:

```tsx
                    {geo.coords && (
                      <span className="ml-2 text-xs">
                        <DistanceLink origin={geo.coords} venue={v} />
                      </span>
                    )}
```

(Stubs are derived from the already-sorted `filtered` list, so they inherit the distance ordering automatically — no separate sort needed.)

- [ ] **Step 13: Run the full verification gate**

```bash
npm run typecheck
npm run lint
npm run build
```

Expected: typecheck PASS; lint PASS (only the two pre-existing Phase 0 issues in `db/schema/moderation.ts` + `scripts/import-neighborhoods.ts`); build compiles. If lint flags `geo.coords` in the `useMemo` deps as needing more entries, that is expected to already be satisfied — do not add unrelated deps.

- [ ] **Step 14: Manual smoke test**

Run: `npm run dev`, open `http://localhost:3000/tacoma`.
Verify:
1. "📍 Use my location" chip is visible in the filter bar.
2. Clicking it triggers the browser permission prompt.
3. On allow: chip becomes "📍 Near you ✕", Sort switches to "Closest to me", each row/card shows a distance (e.g. "0.4 mi"), and the list is ordered nearest-first.
4. Clicking a distance opens a maps URL with directions from your location to that venue (Google on non-Apple, Apple Maps on Apple devices).
5. Clicking ✕ clears the chip and reverts Sort to "Happening now"; distances disappear.
6. On deny: the "Location unavailable — check browser permissions" note shows and the chip returns to idle.

- [ ] **Step 15: Commit**

```bash
git add components/venue-table-client.tsx
git commit -m "feat(grid): 'Closest to me' location sort + per-row distance & map links"
```

---

## Self-review (completed during planning)

- **Spec coverage:**
  - Opt-in location button → Task 5 Step 9. ✓
  - "Closest to me" sort nearest-first → Task 5 Steps 2, 6, 8. ✓
  - Per-row/card distance label → Task 5 Steps 3, 10, 11, 12. ✓
  - Distance click → directions deep-link → Task 5 Step 3 (`DistanceLink` → `directionsUrl`). ✓
  - Coordinates client-only, never sent/stored → Task 4 (state-only hook). ✓
  - Data layer `lat`/`lng` on `VenueListItem`, no migration → Task 3. ✓
  - Pure utils unit-tested → Tasks 1 & 2. ✓
  - DirectionsButton de-duplicated onto shared helper → Task 2 Step 5. ✓
  - Stubs participate; missing-coords sort last → Task 5 Steps 6, 12. ✓
  - Page stays ISR-cached (no server changes touching the render path) → Tasks 3-5 add only client-side compute + two existing columns. ✓
- **Placeholder scan:** none — every code step shows complete code.
- **Type consistency:** `LatLng` defined once in `distance.ts` and imported by `mapsLink.ts` and `useGeolocation.ts`; `directionsUrl(dest, origin, isApple)` signature is consistent between the test (Task 2 Step 1), the implementation (Step 3), `DirectionsButton` (Step 5), and `DistanceLink` (Task 5 Step 3); `geo.{coords,status,request,clear}` match the `UseGeolocation` interface from Task 4.
