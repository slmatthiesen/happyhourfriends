# Discovery Complete-Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `seed:discover` capture essentially every in-scope bar/restaurant (beating Google's popularity-ranked 20-result cap) and filter out airport-terminal venues, strip/adult clubs, and casinos before any AI spend.

**Architecture:** Add `rankPreference: "DISTANCE"` to the Places `searchNearby` call so each tile returns its *nearest* 20, then replace the flat tile grid with an **adaptive quadtree**: any tile that returns a saturated 20 results subdivides into 4 smaller tiles and re-queries, recursively, down to a ~400m / depth-4 floor with a global tile cap. The recursion driver and gates are pure, injectable functions in `lib/places/` (testable without the network); the script wires the real Places fetch into them. Bad-data gates: a generic airport-point lookup + 1.5km buffer, plus broadened name/type denylists.

**Tech Stack:** TypeScript (strict), `tsx` runnable check scripts with `node:assert` (the repo's testing convention — there is no vitest/jest), Google Places API (New) `places:searchNearby`, postgres.js + PostGIS.

---

## File Structure

- **Create `lib/places/discoveryTiling.ts`** — pure tiling strategy: `Tile` type, `splitTile`, constants (`MAX_RESULTS`, `MIN_RADIUS_METERS`, `MAX_DEPTH`, `DEFAULT_MAX_TILES`), and the async `collectAdaptive` driver that takes an injected `fetchTile` function. No network, no DB. One responsibility: "given seed tiles and a way to fetch one tile, collect every unique place, subdividing saturated tiles."
- **Create `lib/places/airportGate.ts`** — pure geo gate: `GeoPoint`, `haversineMeters`, `AIRPORT_BUFFER_METERS`, `isWithinAirportBuffer`. One responsibility: "is this point within the airport buffer?"
- **Modify `lib/places/chainDenylist.ts`** — extend `NO_HH_FORMAT_PATTERNS` (adult-club + casino terms) and add a casino place-type rule to `isExcludedByPlaceType` (enforced *before* the alcohol-signal override, so a casino bar is still dropped).
- **Modify `scripts/seed-discover-tacoma.ts`** — add `rankPreference: "DISTANCE"`; add `findAirports`; replace the flat tile loop with `collectAdaptive`; add the per-result airport gate + `airportSkipped` counter + floor-saturation logging.
- **Create `scripts/test-discovery-coverage.ts`** — runnable `node:assert` checks for everything in the two new lib modules plus the denylist additions (mirrors `scripts/test-discovery.ts`).

---

## Task 1: Tile type, `splitTile`, and tiling constants

**Files:**
- Create: `lib/places/discoveryTiling.ts`
- Test: `scripts/test-discovery-coverage.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-discovery-coverage.ts`:

```typescript
/**
 * Runnable checks for complete-coverage discovery: adaptive tiling, the airport
 * buffer gate, and the broadened bad-data denylists. No network.
 *
 * Run: tsx scripts/test-discovery-coverage.ts
 */
import assert from "node:assert";
import {
  splitTile,
  collectAdaptive,
  MAX_RESULTS,
  MIN_RADIUS_METERS,
  MAX_DEPTH,
  type Tile,
} from "@/lib/places/discoveryTiling";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
async function checkAsync(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`  ✓ ${name}`); }

check("splitTile returns 4 children at half radius, depth+1, offset from center", () => {
  const parent: Tile = { lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 };
  const kids = splitTile(parent);
  assert.equal(kids.length, 4, "four children");
  for (const k of kids) {
    // Child radius = r/√2 (NOT r/2) so the four child circles fully cover the parent
    // circle (the cardinal extremes sit exactly r/√2 from the nearest child center).
    assert.ok(Math.abs(k.radiusMeters - 3000 * Math.SQRT1_2) < 1, "radius shrunk by 1/√2");
    assert.equal(k.depth, 1, "depth + 1");
    assert.notEqual(k.lat, parent.lat, "lat offset from parent");
    assert.notEqual(k.lng, parent.lng, "lng offset from parent");
  }
  // The 4 children are the 4 quadrant combinations (2 distinct lats, 2 distinct lngs).
  assert.equal(new Set(kids.map((k) => k.lat)).size, 2, "two distinct child latitudes");
  assert.equal(new Set(kids.map((k) => k.lng)).size, 2, "two distinct child longitudes");
});

check("tiling constants are the agreed completeness-leaning defaults", () => {
  assert.equal(MAX_RESULTS, 20, "Google Places per-call cap");
  assert.equal(MIN_RADIUS_METERS, 400, "subdivision floor radius");
  assert.equal(MAX_DEPTH, 4, "max recursion depth");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: FAIL — `Cannot find module '@/lib/places/discoveryTiling'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/places/discoveryTiling.ts`:

```typescript
/**
 * Adaptive density-aware tiling for seed discovery.
 *
 * Google Places (New) `searchNearby` returns at most 20 results per call. Under the
 * default POPULARITY ranking those are the 20 most prominent venues in the circle —
 * so lower-profile bars in dense areas are silently dropped. We switch the caller to
 * rankPreference=DISTANCE (nearest 20) and, when a tile still comes back saturated
 * (exactly 20 = the API truncated), subdivide it into 4 smaller tiles and re-query —
 * recursively, down to a floor — so coverage is complete and self-tunes to density.
 *
 * This module is PURE + injectable: `collectAdaptive` takes a `fetchTile` function so
 * it can be unit-tested with a mock (no network). The script wires the real Places
 * fetch in.
 */

/** A search circle. `depth` tracks recursion for the subdivision floor. */
export interface Tile {
  lat: number;
  lng: number;
  radiusMeters: number;
  depth: number;
}

/** Anything with a stable Google place id; used for cross-tile de-duplication. */
export interface TilePlace {
  id?: string;
}

/** Google Places per-call result cap. A tile returning this many = saturated. */
export const MAX_RESULTS = 20;
/** Subdivision floor: never query a circle smaller than this radius. */
export const MIN_RADIUS_METERS = 400;
/** Subdivision floor: never recurse deeper than this. */
export const MAX_DEPTH = 4;
/** Safety cap on total tiles processed per run (runaway-spend backstop). */
export const DEFAULT_MAX_TILES = 2000;

/**
 * Radius of a child tile = parent radius / √2. This is the SMALLEST factor that lets 4
 * children (centered at ±radius/2 offsets) fully cover the parent CIRCLE: the parent's
 * cardinal extremes (0,±r)/(±r,0) and its center all sit exactly r/√2 from the nearest
 * child center. A naive r/2 would leave ~0.21·r uncovered arcs along the cardinal edges.
 */
function subdividedRadius(tile: Tile): number {
  return tile.radiusMeters * Math.SQRT1_2;
}

/**
 * Split a saturated tile into 4 quadrant children. Centers are offset by radius/2 in each
 * lat/lng direction; child radius = radius/√2 (see subdividedRadius) so the four child
 * circles fully cover the parent circle (overlap at the seams is harmless — de-duped on
 * place id).
 */
export function splitTile(tile: Tile): Tile[] {
  const childRadius = subdividedRadius(tile);
  const offsetM = tile.radiusMeters / 2;
  const latPerM = 1 / 111_320;
  const lngPerM = 1 / (111_320 * Math.cos((tile.lat * Math.PI) / 180));
  const dLat = offsetM * latPerM;
  const dLng = offsetM * lngPerM;
  const depth = tile.depth + 1;
  return [
    { lat: tile.lat + dLat, lng: tile.lng + dLng, radiusMeters: childRadius, depth },
    { lat: tile.lat + dLat, lng: tile.lng - dLng, radiusMeters: childRadius, depth },
    { lat: tile.lat - dLat, lng: tile.lng + dLng, radiusMeters: childRadius, depth },
    { lat: tile.lat - dLat, lng: tile.lng - dLng, radiusMeters: childRadius, depth },
  ];
}

/** True when a saturated tile is still allowed to subdivide (above the floor). */
function canSubdivide(tile: Tile): boolean {
  return tile.depth < MAX_DEPTH && subdividedRadius(tile) >= MIN_RADIUS_METERS;
}

export interface CollectAdaptiveOptions<T extends TilePlace> {
  seedTiles: Tile[];
  /** Fetch all places for one tile (≤ maxResults). Injected so tests need no network. */
  fetchTile: (tile: Tile) => Promise<T[]>;
  maxResults?: number;
  maxTiles?: number;
  /** Called when a saturated tile cannot subdivide (genuine dense hotspot at the floor). */
  onFloorSaturated?: (tile: Tile) => void;
}

/**
 * Process seed tiles, subdividing saturated ones, until every tile returns < maxResults
 * (or hits the floor). Returns a Map keyed on place id (cross-tile de-dup). Throws if the
 * tile count exceeds maxTiles so a bug can't silently burn Places quota.
 */
export async function collectAdaptive<T extends TilePlace>(
  opts: CollectAdaptiveOptions<T>,
): Promise<Map<string, T>> {
  const maxResults = opts.maxResults ?? MAX_RESULTS;
  const maxTiles = opts.maxTiles ?? DEFAULT_MAX_TILES;
  const collected = new Map<string, T>();
  const queue: Tile[] = [...opts.seedTiles];
  let processed = 0;

  while (queue.length > 0) {
    const tile = queue.shift() as Tile;
    processed++;
    if (processed > maxTiles) {
      throw new Error(
        `Adaptive tiling exceeded ${maxTiles} tiles — aborting to avoid runaway Places spend.`,
      );
    }
    const results = await opts.fetchTile(tile);
    for (const r of results) {
      if (r.id) collected.set(r.id, r);
    }
    if (results.length >= maxResults) {
      if (canSubdivide(tile)) {
        queue.push(...splitTile(tile));
      } else {
        opts.onFloorSaturated?.(tile);
      }
    }
  }
  return collected;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: PASS — `2 checks passed.` (the `collectAdaptive`/airport/denylist checks are added in later tasks).

- [ ] **Step 5: Commit**

```bash
git add lib/places/discoveryTiling.ts scripts/test-discovery-coverage.ts
git commit -m "feat(discovery): pure Tile + splitTile + tiling constants"
```

---

## Task 2: `collectAdaptive` driver behavior

**Files:**
- Modify: `lib/places/discoveryTiling.ts` (already complete from Task 1 — this task only adds tests)
- Test: `scripts/test-discovery-coverage.ts:append`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-discovery-coverage.ts`, immediately after the Task 1 `check(...)` calls and before the final `console.log`:

```typescript
// --- collectAdaptive ------------------------------------------------------------
import { haversineMeters } from "@/lib/places/airportGate"; // used by the mock below

interface MockVenue { id: string; lat: number; lng: number }

/** 30 venues scattered in a ~1.8km grid around a center. */
function makeCluster(centerLat: number, centerLng: number): MockVenue[] {
  const latPerM = 1 / 111_320;
  const lngPerM = 1 / (111_320 * Math.cos((centerLat * Math.PI) / 180));
  const out: MockVenue[] = [];
  let n = 0;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 5; j++) {
      out.push({
        id: `v${n++}`,
        lat: centerLat + (i - 2.5) * 300 * latPerM,
        lng: centerLng + (j - 2) * 300 * lngPerM,
      });
    }
  }
  return out; // 30 venues
}

/** Mock Places: nearest `MAX_RESULTS` venues within the tile radius (mimics the cap). */
function mockFetch(venues: MockVenue[]) {
  return async (tile: Tile): Promise<MockVenue[]> =>
    venues
      .map((v) => ({ v, d: haversineMeters(tile.lat, tile.lng, v.lat, v.lng) }))
      .filter((x) => x.d <= tile.radiusMeters)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_RESULTS)
      .map((x) => x.v);
}

await checkAsync("a single big tile truncates at the 20-result cap", async () => {
  const venues = makeCluster(47.25, -122.44);
  const oneShot = await mockFetch(venues)({ lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 });
  assert.equal(oneShot.length, MAX_RESULTS, "the flat call sees only 20 of the 30 venues");
});

await checkAsync("collectAdaptive recovers past the cap and de-dups by id", async () => {
  const venues = makeCluster(47.25, -122.44);
  const collected = await collectAdaptive<MockVenue>({
    seedTiles: [{ lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 }],
    fetchTile: mockFetch(venues),
  });
  assert.ok(collected.size > MAX_RESULTS, `recovered more than ${MAX_RESULTS} (got ${collected.size})`);
  assert.ok(collected.size <= venues.length, "never invents venues");
  // Every collected entry is a real venue (de-dup produced no garbage / no repeats).
  for (const [id, v] of collected) assert.equal(id, v.id, "map keyed on the venue's own id");
});

await checkAsync("onFloorSaturated fires (not subdivide) for a saturated floor tile", async () => {
  let floorHits = 0;
  let fetches = 0;
  const collected = await collectAdaptive<MockVenue>({
    // A tile already AT the floor (depth = MAX_DEPTH).
    seedTiles: [{ lat: 47.25, lng: -122.44, radiusMeters: MIN_RADIUS_METERS, depth: MAX_DEPTH }],
    fetchTile: async () => {
      fetches++;
      return Array.from({ length: MAX_RESULTS }, (_, i) => ({ id: `f${i}`, lat: 0, lng: 0 }));
    },
    onFloorSaturated: () => { floorHits++; },
  });
  assert.equal(fetches, 1, "floor tile is queried once and NOT subdivided");
  assert.equal(floorHits, 1, "floor saturation reported");
  assert.equal(collected.size, MAX_RESULTS, "its results are still collected");
});

await checkAsync("maxTiles guard throws on runaway subdivision", async () => {
  await assert.rejects(
    collectAdaptive<MockVenue>({
      seedTiles: [{ lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 }],
      // Always saturated with the SAME 20 ids → keeps subdividing until the cap trips.
      fetchTile: async () => Array.from({ length: MAX_RESULTS }, (_, i) => ({ id: `x${i}`, lat: 0, lng: 0 })),
      maxTiles: 3,
    }),
    /exceeded 3 tiles/,
    "aborts before runaway Places spend",
  );
});
```

Also change the bottom of the file so async checks are awaited. Replace the final line `console.log(\`\n${passed} checks passed.\`);` with a wrapping `main()`:

```typescript
// (wrap everything above in an async main if not already — see Step 3 note)
```

- [ ] **Step 2: Run tests to verify they fail / structure issue surfaces**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: FAIL — top-level `await` requires the checks to run inside an async function, and `airportGate` does not exist yet (`Cannot find module '@/lib/places/airportGate'`). This drives Task 3 and the async-main refactor in Step 3.

- [ ] **Step 3: Restructure the test file to await async checks**

The runnable-check files use top-level statements; `await` needs an async context. Wrap the whole body of `scripts/test-discovery-coverage.ts` in an async `main()` and call it. Concretely, the file becomes:

```typescript
/**
 * Runnable checks for complete-coverage discovery: adaptive tiling, the airport
 * buffer gate, and the broadened bad-data denylists. No network.
 *
 * Run: tsx scripts/test-discovery-coverage.ts
 */
import assert from "node:assert";
import {
  splitTile,
  collectAdaptive,
  MAX_RESULTS,
  MIN_RADIUS_METERS,
  MAX_DEPTH,
  type Tile,
} from "@/lib/places/discoveryTiling";
import { haversineMeters } from "@/lib/places/airportGate";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
async function checkAsync(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`  ✓ ${name}`); }

async function main() {
  // ... all the check(...) and await checkAsync(...) calls from Tasks 1–2 (and 3–4) ...
  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Move the Task 1 `check(...)` calls and the Task 2 `await checkAsync(...)` calls inside `main()`. Keep the `import { haversineMeters }` at top level (it stays unresolved until Task 3).

- [ ] **Step 4: Confirm it still fails only on the missing airport module**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: FAIL — `Cannot find module '@/lib/places/airportGate'` (resolved in Task 3). The tiling logic itself is correct; only the missing import blocks it.

- [ ] **Step 5: Commit (test only — passes after Task 3)**

```bash
git add scripts/test-discovery-coverage.ts
git commit -m "test(discovery): collectAdaptive recovery, floor, and runaway-guard cases"
```

---

## Task 3: Airport buffer gate

**Files:**
- Create: `lib/places/airportGate.ts`
- Test: `scripts/test-discovery-coverage.ts:append` (inside `main()`)

- [ ] **Step 1: Write the failing test**

Append these checks inside `main()` in `scripts/test-discovery-coverage.ts`, after the Task 2 checks:

```typescript
// --- airport gate ---------------------------------------------------------------
{
  const { isWithinAirportBuffer, AIRPORT_BUFFER_METERS } = await import("@/lib/places/airportGate");
  // SEA-TAC airport point.
  const seatac = [{ lat: 47.4480, lng: -122.3088 }];

  check("isWithinAirportBuffer drops a point inside the buffer", () => {
    // ~200m north of the airport point — clearly inside 1500m.
    assert.equal(isWithinAirportBuffer(47.4498, -122.3088, seatac), true);
  });
  check("isWithinAirportBuffer keeps a point outside the buffer (Airport Tavern case)", () => {
    // Tacoma's Airport Tavern is ~10km from SEA-TAC — well outside 1500m.
    assert.equal(isWithinAirportBuffer(47.2100, -122.4600, seatac), false);
  });
  check("isWithinAirportBuffer is a no-op when no airports are known", () => {
    assert.equal(isWithinAirportBuffer(47.4498, -122.3088, []), false);
  });
  check("AIRPORT_BUFFER_METERS is the agreed 1500m", () => {
    assert.equal(AIRPORT_BUFFER_METERS, 1500);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: FAIL — `Cannot find module '@/lib/places/airportGate'` (the top-level `import { haversineMeters }` also still fails).

- [ ] **Step 3: Write minimal implementation**

Create `lib/places/airportGate.ts`:

```typescript
/**
 * Airport-terminal exclusion for seed discovery. In-terminal restaurants/bars aren't
 * the local spots we feature. Detection is generic + zero-curation: the discovery run
 * looks up airport place points via the Places API, then drops any candidate within a
 * tight buffer of one. The buffer is deliberately small (terminal/concourse footprint)
 * so a real bar NEAR an airport — e.g. Tacoma's "Airport Tavern", ~10km from SEA-TAC —
 * is NOT dropped, which a name regex on "airport" would wrongly do.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Tight buffer: terminal/concourse footprint only, not the surrounding area. */
export const AIRPORT_BUFFER_METERS = 1500;

/** Great-circle distance in metres. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * True when (lat,lng) is within `bufferMeters` of any known airport point. Empty
 * `airports` → always false (gate is a no-op when the lookup found nothing).
 */
export function isWithinAirportBuffer(
  lat: number,
  lng: number,
  airports: GeoPoint[],
  bufferMeters: number = AIRPORT_BUFFER_METERS,
): boolean {
  return airports.some((a) => haversineMeters(lat, lng, a.lat, a.lng) <= bufferMeters);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: PASS — all Task 1–3 checks pass (count printed, e.g. `10 checks passed.`).

- [ ] **Step 5: Commit**

```bash
git add lib/places/airportGate.ts scripts/test-discovery-coverage.ts
git commit -m "feat(discovery): airport-terminal buffer gate (pure, 1500m)"
```

---

## Task 4: Broaden denylists — adult clubs + casinos

**Files:**
- Modify: `lib/places/chainDenylist.ts:82-113` (`NO_HH_FORMAT_PATTERNS`) and `lib/places/chainDenylist.ts:231-250` (`isExcludedByPlaceType`)
- Test: `scripts/test-discovery-coverage.ts:append` (inside `main()`)

- [ ] **Step 1: Write the failing test**

Append inside `main()` in `scripts/test-discovery-coverage.ts`, after the Task 3 checks:

```typescript
// --- broadened denylists --------------------------------------------------------
{
  const { isLikelyNoHappyHourFormat, isExcludedByPlaceType } = await import("@/lib/places/chainDenylist");

  check("adult-club name patterns are dropped", () => {
    assert.equal(isLikelyNoHappyHourFormat("Dreamgirls Strip Club"), true);
    assert.equal(isLikelyNoHappyHourFormat("Showgirls"), true);
    assert.equal(isLikelyNoHappyHourFormat("Club Nude"), true);
    assert.equal(isLikelyNoHappyHourFormat("Pink Pony Cabaret"), true); // existing pattern still works
  });
  check("'nude' does not match the substring inside 'denude' / legit names", () => {
    assert.equal(isLikelyNoHappyHourFormat("Denude Spa"), false);
    assert.equal(isLikelyNoHappyHourFormat("The Tavern Lounge"), false); // lounge intentionally allowed
  });
  check("casino name pattern is dropped", () => {
    assert.equal(isLikelyNoHappyHourFormat("Emerald Queen Casino"), true);
  });
  check("casino place type is dropped even with an alcohol-signal primary type", () => {
    // A casino's bar would otherwise be KEPT by the alcohol-signal override; the casino
    // type rule runs first so the operator's "never include casinos" rule wins.
    assert.equal(isExcludedByPlaceType("bar", ["bar", "casino"]), true);
    assert.equal(isExcludedByPlaceType("casino", ["casino"]), true);
  });
  check("a normal bar is still kept", () => {
    assert.equal(isExcludedByPlaceType("bar", ["bar", "restaurant"]), false);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: FAIL — the casino/adult assertions fail (`Emerald Queen Casino` not yet dropped; `["bar","casino"]` not yet excluded).

- [ ] **Step 3: Write minimal implementation**

In `lib/places/chainDenylist.ts`, extend `NO_HH_FORMAT_PATTERNS` (currently ending with the adult-entertainment block `"cabaret", "gentlemens club", "topless"`). Replace that trailing block:

```typescript
  // Adult entertainment — even when they have HH, operator doesn't want them featured.
  "cabaret",
  "gentlemens club",
  "topless",
  "strip club",
  "showgirls",
  "nude",
  "go go",
  "burlesque",
  // Casinos — operator rule: never feature casinos (name signal; the place-type gate
  // in isExcludedByPlaceType is the stronger backstop).
  "casino",
];
```

Then in `isExcludedByPlaceType`, add the casino type rule **before** the alcohol-signal override so a casino's bar is still dropped. The function currently begins:

```typescript
export function isExcludedByPlaceType(
  primaryType: string | null | undefined,
  types: string[] | null | undefined,
): boolean {
  const t = types ?? [];
  // No type signal at all (e.g. curated-page candidates) → keep; can't judge.
  if (!primaryType && t.length === 0) return false;

  // Alcohol-signal override: a real bar/brewery/pub is never dropped.
  if (primaryType && ALCOHOL_SIGNAL_PRIMARY.has(primaryType)) return false;
```

Insert the casino rule between the "no type signal" guard and the alcohol override:

```typescript
  const t = types ?? [];
  // No type signal at all (e.g. curated-page candidates) → keep; can't judge.
  if (!primaryType && t.length === 0) return false;

  // Casino rule (operator: never feature casinos) — runs BEFORE the alcohol override so a
  // casino's in-house bar is still dropped. Best-effort: a casino restaurant that Google
  // does NOT tag with the casino type can still slip through (documented limitation).
  if (primaryType === "casino" || t.includes("casino")) return true;

  // Alcohol-signal override: a real bar/brewery/pub is never dropped.
  if (primaryType && ALCOHOL_SIGNAL_PRIMARY.has(primaryType)) return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: PASS — all checks pass (e.g. `15 checks passed.`).

- [ ] **Step 5: Commit**

```bash
git add lib/places/chainDenylist.ts scripts/test-discovery-coverage.ts
git commit -m "feat(discovery): drop adult clubs (broadened) + casinos (name + type)"
```

---

## Task 5: Wire DISTANCE ranking, adaptive tiling, and the airport gate into the script

**Files:**
- Modify: `scripts/seed-discover-tacoma.ts`

This task has no unit test (it's the network/DB integration glue — the repo has no live-API test harness). It is verified by typecheck + lint (Task 6) and the `--dry-run`/live runs (Tasks 6–7).

- [ ] **Step 1: Add imports**

At the top of `scripts/seed-discover-tacoma.ts`, alongside the existing `@/lib/places/chainDenylist` import, add:

```typescript
import {
  collectAdaptive,
  type Tile,
} from "@/lib/places/discoveryTiling";
import {
  isWithinAirportBuffer,
  type GeoPoint,
} from "@/lib/places/airportGate";
```

- [ ] **Step 2: Add `rankPreference: "DISTANCE"` to `fetchNearby`**

In `fetchNearby` (around line 253), add `rankPreference` to the request `body`:

```typescript
  const body = {
    includedTypes: INCLUDED_TYPES,
    excludedPrimaryTypes: EXCLUDED_PRIMARY_TYPES,
    maxResultCount: 20,
    // DISTANCE (not the default POPULARITY): return the NEAREST 20 to the tile center,
    // not the 20 most prominent. Combined with adaptive subdivision of saturated tiles,
    // this is what makes coverage complete (lower-profile bars stop losing the 20 slots
    // to popular restaurants). DISTANCE requires a circular locationRestriction (we have one).
    rankPreference: "DISTANCE",
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
  };
```

- [ ] **Step 3: Add the airport lookup function**

Add this function near `fetchNearby` (e.g. after it, before `extractVenueNames`):

```typescript
/**
 * Find airport points near the city so the discovery gate can drop in-terminal venues.
 * One Places call for includedTypes:["airport"] over a circle around the city center.
 * Generic + zero-curation: no per-city airport list. Radius is capped at Google's 50km
 * Nearby max; a metro's primary airport is essentially always within 50km of center.
 * Returns [] on any error (the gate then becomes a no-op).
 */
async function findAirports(
  apiKey: string,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): Promise<GeoPoint[]> {
  const body = {
    includedTypes: ["airport"],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: centerLat, longitude: centerLng },
        radius: Math.min(radiusMeters, 50_000),
      },
    },
  };
  try {
    const res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`  [airport] lookup HTTP ${res.status} — airport gate disabled this run`);
      return [];
    }
    const data = (await res.json()) as { places?: { location?: { latitude?: number; longitude?: number } }[] };
    return (data.places ?? [])
      .map((p) => p.location)
      .filter((l): l is { latitude: number; longitude: number } => l?.latitude != null && l?.longitude != null)
      .map((l) => ({ lat: l.latitude, lng: l.longitude }));
  } catch (err) {
    console.warn(`  [airport] lookup failed — airport gate disabled this run:`, err);
    return [];
  }
}
```

- [ ] **Step 4: Replace the flat tile loop with adaptive collection + post-collection gating**

The current code (around lines 447–619) builds `tiles`, logs the mode, then runs `for (const tile of tiles) { fetchNearby; for (const place of places) { ...gates + upsert... } }`. Replace from where `tiles` is first declared through the end of that outer `for` loop with the following. **Keep** the `useBoundary`/bbox tile-seed generation exactly as-is — only the *consumption* changes (the seed `{lat,lng}[]` is mapped to `Tile[]`, fed to `collectAdaptive`, then gated).

Concretely:

(a) After the existing seed-tile generation that assigns `tiles` (both the BOUNDARY and RADIUS branches that set `tiles = ...`), add the airport lookup and the adaptive collection. Replace the `for (const tile of tiles) { ... }` block (the entire outer loop, including its inner `for (const place of places)` body and the trailing `await new Promise((r) => setTimeout(r, 40));`) with:

```typescript
    // Airport points (for the in-terminal exclusion gate). One Places call; [] on error.
    const airports = await findAirports(placesKey, lat, lng, COVERAGE_METERS);
    console.log(
      airports.length > 0
        ? `  Airport gate: ${airports.length} airport point(s) found; dropping candidates within 1500m.`
        : `  Airport gate: no airports found near center — gate is a no-op this run.`,
    );

    // Adaptive collection: each seed tile is queried by NEAREST-20; a tile that returns a
    // saturated 20 subdivides into 4 smaller tiles and re-queries, down to the floor.
    const seedTiles: Tile[] = tiles.map((t) => ({
      lat: t.lat,
      lng: t.lng,
      radiusMeters: CELL_METERS,
      depth: 0,
    }));
    let floorSaturated = 0;
    let tilesFetched = 0;
    const collected = await collectAdaptive<PlaceResult>({
      seedTiles,
      fetchTile: async (tile) => {
        let places: PlaceResult[];
        try {
          places = await fetchNearby(placesKey, tile.lat, tile.lng, tile.radiusMeters);
        } catch (err) {
          console.error(`  ERROR @ ${tile.lat.toFixed(3)},${tile.lng.toFixed(3)}:`, err);
          return [];
        }
        tilesFetched++;
        await new Promise((r) => setTimeout(r, 40)); // gentle throttle (unchanged cadence)
        return places;
      },
      onFloorSaturated: () => { floorSaturated++; },
    });
    console.log(
      `  Adaptive tiling: ${tilesFetched} tile fetches → ${collected.size} unique places` +
        (floorSaturated > 0 ? `; ${floorSaturated} floor tile(s) still saturated (dense hotspot)` : ``),
    );

    // Gate + upsert every unique place. (Same gate ladder as before, now run once per
    // deduped place instead of once per tile-result.)
    for (const place of collected.values()) {
      if (!place.id || !place.displayName?.text) {
        placesSkipped++;
        continue;
      }

      const name = place.displayName.text;
      const address = place.formattedAddress ?? null;
      const pLat = place.location?.latitude ?? null;
      const pLng = place.location?.longitude ?? null;

      if (isExcludedByBusinessStatus(place.businessStatus)) {
        closedSkipped++;
        continue;
      }
      if (isDenylistedChain(name)) {
        chainsSkipped++;
        continue;
      }
      if (isLikelyNoHappyHourFormat(name)) {
        formatsSkipped++;
        continue;
      }
      if (isExcludedByPlaceType(place.primaryType, place.types)) {
        typesSkipped++;
        continue;
      }

      // Airport-terminal gate: drop candidates within 1500m of a known airport point.
      if (pLat != null && pLng != null && isWithinAirportBuffer(pLat, pLng, airports)) {
        airportSkipped++;
        continue;
      }

      const priceLevelNum = place.priceLevel
        ? (PRICE_LEVEL[place.priceLevel] ?? null)
        : null;
      if (isLowSignalCandidate(place.userRatingCount, place.websiteUri, priceLevelNum)) {
        lowSignalSkipped++;
        continue;
      }

      // Service-area gate (unchanged: BOUNDARY = ST_DWithin buffer; RADIUS = locality+haversine).
      let inArea: boolean;
      if (useBoundary) {
        if (pLat == null || pLng == null) {
          inArea = false;
        } else {
          const [{ within }] = await sql<{ within: boolean }[]>`
            SELECT ST_DWithin(
              g::geography,
              ST_SetSRID(ST_MakePoint(${pLng}, ${pLat}), 4326)::geography,
              ${SERVICE_BUFFER_METERS}
            ) AS within
            FROM _seed_boundary
          `;
          inArea = within;
        }
      } else {
        const inLocality = SERVICE_LOCALITIES.some((loc) =>
          new RegExp(`,\\s*${loc},\\s*${stateCode}`).test(address ?? ""),
        );
        const inRadius =
          pLat != null && pLng != null
            ? haversineKm(lat, lng, pLat, pLng) <= SERVICE_RADIUS_KM
            : false;
        inArea = inLocality && inRadius;
      }
      if (!inArea) {
        outOfArea++;
        continue;
      }

      try {
        const priceLevel = priceLevelNum;
        const types = place.types ?? null;
        await sql`
          INSERT INTO seed_candidates
            (city_id, name, google_place_id, address, lat, lng, source_url,
             primary_type, types, website_url, rating, user_rating_count,
             price_level, business_status)
          VALUES
            (${city.id}, ${name}, ${place.id}, ${address},
             ${pLat != null ? String(pLat) : null},
             ${pLng != null ? String(pLng) : null}, ${"google_places"},
             ${place.primaryType ?? null}, ${types}, ${place.websiteUri ?? null},
             ${place.rating ?? null}, ${place.userRatingCount ?? null},
             ${priceLevel}, ${place.businessStatus ?? null})
          ON CONFLICT (google_place_id) DO UPDATE SET
            name             = EXCLUDED.name,
            address          = EXCLUDED.address,
            lat              = EXCLUDED.lat,
            lng              = EXCLUDED.lng,
            primary_type     = EXCLUDED.primary_type,
            types            = EXCLUDED.types,
            website_url      = EXCLUDED.website_url,
            rating           = EXCLUDED.rating,
            user_rating_count = EXCLUDED.user_rating_count,
            price_level      = EXCLUDED.price_level,
            business_status  = EXCLUDED.business_status,
            updated_at = now()
        `;
        placesInserted++;
      } catch (err) {
        console.warn(`  WARN upsert failed for ${name}:`, err);
        placesSkipped++;
      }
    }
```

(b) Add the `airportSkipped` counter to the counter declarations (near line 444, alongside `lowSignalSkipped`):

```typescript
    let airportSkipped = 0;
```

(c) Add `airportSkipped` to the summary log (the `console.log` around line 621):

```typescript
    console.log(
      `Google Places: ${placesInserted} in-area upserts, ${outOfArea} out-of-area dropped, ` +
        `${chainsSkipped} chains dropped, ${formatsSkipped} buffet/AYCE dropped, ` +
        `${typesSkipped} place-type dropped, ${closedSkipped} closed dropped, ` +
        `${airportSkipped} airport dropped, ${lowSignalSkipped} low-signal dropped, ` +
        `${placesSkipped} skipped.`,
    );
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-discover-tacoma.ts
git commit -m "feat(discovery): DISTANCE ranking + adaptive tiling + airport gate in seed:discover"
```

---

## Task 6: Verify (typecheck, lint, full test run, dry-run tile count)

**Files:** none (verification only)

- [ ] **Step 1: Run the coverage checks**

Run: `npx tsx scripts/test-discovery-coverage.ts`
Expected: PASS — all checks pass; final line `N checks passed.`

- [ ] **Step 2: Run the pre-existing discovery checks (no regression)**

Run: `npx tsx scripts/test-discovery.ts`
Expected: PASS — `6 checks passed.` (Task changes don't touch `siteTriage`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no new errors (the repo has two pre-existing Phase 0 lint-only issues; `tsc` should be clean).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS — no new errors beyond the two pre-existing ones noted in CLAUDE.md (`db/schema/moderation.ts`, `scripts/import-neighborhoods.ts`).

- [ ] **Step 5: Commit (if any lint/type fixups were needed)**

```bash
git add -A
git commit -m "chore(discovery): typecheck + lint clean"
```

(If Steps 3–4 were already clean, skip this commit.)

---

## Task 7: Live re-discovery — Tacoma, Daly City, Phoenix

**Files:** none (operational; run by the main thread, which has network + DB access)

> Requires `GOOGLE_PLACES_API_KEY` and `DATABASE_URL` in `.env`, and Docker Postgres up
> (`docker compose up -d`). Places-only — **no AI enrich cost.** Capture before/after
> candidate counts to quantify the lift.

- [ ] **Step 1: Record baseline candidate counts**

Run (psql via the app's DATABASE_URL, or a one-off query script):

```bash
npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`SELECT c.slug, count(*) n FROM seed_candidates s JOIN cities c ON c.id=s.city_id WHERE c.slug IN ('tacoma','daly-city','phoenix') GROUP BY c.slug ORDER BY c.slug\`; console.log(r); await sql.end();"
```

Expected: prints current counts per city. Note them.

- [ ] **Step 2: Discover Tacoma**

Run: `npm run seed:discover -- --city tacoma`
Expected: the new log lines — `Airport gate: N airport point(s) …`, `Adaptive tiling: M tile fetches → K unique places`, and the summary with `… airport dropped …`. Sanity-check `M` (tile fetches) is bounded (well under 2000) and `K` exceeds the prior raw count.

- [ ] **Step 3: Discover Daly City**

Run: `npm run seed:discover -- --city daly-city`
Expected: similar logs; far fewer tiles (sparse city). Confirm it completes without the tile-cap error.

- [ ] **Step 4: Discover Phoenix**

Run: `npm run seed:discover -- --city phoenix`
Expected: more tiles than the small cities (dense core subdivides), still under the 2000 cap. Confirm The Main Ingredient is now captured:

```bash
npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`SELECT name, primary_type FROM seed_candidates s JOIN cities c ON c.id=s.city_id WHERE c.slug='phoenix' AND name ILIKE '%main ingredient%'\`; console.log(r); await sql.end();"
```

Expected: at least one row for The Main Ingredient.

- [ ] **Step 5: Report the lift + spot-check exclusions**

Re-run the Step 1 count query and report before→after per city. Spot-check that no airport-terminal venues / strip clubs / casinos slipped through:

```bash
npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`SELECT c.slug, s.name, s.primary_type FROM seed_candidates s JOIN cities c ON c.id=s.city_id WHERE c.slug IN ('tacoma','daly-city','phoenix') AND (s.name ILIKE '%casino%' OR s.name ILIKE '%strip%' OR s.name ILIKE '%showgirl%' OR 'casino' = ANY(s.types)) ORDER BY c.slug\`; console.log(r.length ? r : 'none — clean'); await sql.end();"
```

Expected: `none — clean`. Report results to the operator; do NOT run `seed:enrich` (separate, paid, operator-gated decision).

---

## Self-Review

**Spec coverage:**
- DISTANCE ranking → Task 5 Step 2. ✓
- Adaptive quadtree subdivision (saturation → 4 children → floor) → Tasks 1–2 (logic) + Task 5 Step 4 (wiring). ✓
- 400m / depth-4 floor + 2000-tile cap → Task 1 constants + Task 2 guard tests. ✓
- Floor-saturation logging → Task 1 `onFloorSaturated` + Task 5 Step 4 log line. ✓
- Airport lookup + 1.5km buffer gate → Task 3 (pure) + Task 5 Step 3 (`findAirports`) + Step 4 (gate). ✓
- Adult-club broadening + casino name/type → Task 4. ✓
- Re-run Tacoma/Daly City/Phoenix with before/after counts → Task 7. ✓
- Dry-run/visibility before spend → Task 7 Step 1 baseline + the `tilesFetched` log gives call volume on the first real run (no separate dry-run flag added — the bounded tile count + cap make a dedicated dry-run unnecessary; YAGNI). Documented divergence from the spec's optional `--dry-run` note.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `Tile` (lat,lng,radiusMeters,depth) used identically in Tasks 1, 2, 5. `collectAdaptive<PlaceResult>` — `PlaceResult` already has `id?: string`, satisfying `TilePlace`. `GeoPoint` (lat,lng) consistent in Tasks 3 + 5. `isWithinAirportBuffer(lat,lng,airports,buffer?)` signature matches call site. `MAX_RESULTS`/`MIN_RADIUS_METERS`/`MAX_DEPTH` names consistent. ✓

**Note on the `--dry-run` divergence:** the spec mentioned extending `test-discovery.ts` for a dry-run tile count. On reflection that script tests `siteTriage`, not discovery, and the adaptive driver's `tilesFetched` log already surfaces call volume on the first run while the 2000-tile cap prevents runaway spend. Adding a separate dry-run mode is unnecessary (YAGNI); dropped deliberately.
