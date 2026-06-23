# Adaptive HH-recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "happy hour" Text Search recall pass saturation-recursive so dense cores (downtown SJ, Old Town Scottsdale) stop dropping ~25–50% of their HH venues to Google's per-region result cap.

**Architecture:** Add a region-shape-agnostic adaptive engine (`collectAdaptiveRegions`) alongside the existing circle-based `collectAdaptive`. Wire the recall pass through it with rectangle split + a metric floor + a per-city call cap. Recovered places run the unchanged gate/boundary/dedup path — only *finding* changes.

**Tech Stack:** TypeScript, Google Places API v1 (`places:searchText`), postgres.js + PostGIS, `node:assert` hermetic tests (the repo's `test:*` script convention).

Spec: `docs/superpowers/specs/2026-06-23-adaptive-hh-recall-design.md`.

---

## File Structure

- `lib/places/discoveryTiling.ts` — **modify**: add the generic `collectAdaptiveRegions<R,T>` engine next to `collectAdaptive`. Pure + injectable.
- `scripts/test-discovery-tiling.ts` — **create**: hermetic tests for `collectAdaptiveRegions` (recursion, floor, call-cap). No network.
- `scripts/seed-discover.ts` — **modify**: add rect-geometry helpers + `RECALL_FLOOR_METERS`/`RECALL_MAX_CALLS`, refactor `collectHhRecall` to drive the engine, retire `--sub-tile`, update the estimate + logging.
- `scripts/test-recall-rect.ts` — **create**: hermetic tests for the pure rect helpers (`rectHalfDiagonalMeters`, `canSubdivideRect`).
- `scripts/ci-tests.sh` — **modify**: register the two new test scripts.
- `package.json` — **modify**: add the two `test:*` script entries.

---

## Task 1: Generic region-adaptive engine

**Files:**
- Modify: `lib/places/discoveryTiling.ts` (append after `collectAdaptive`, ~line 125)
- Test: `scripts/test-discovery-tiling.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-discovery-tiling.ts`:

```typescript
/**
 * test-discovery-tiling — hermetic checks for the adaptive region engine that drives the
 * saturation-recursive HH recall (dense cores subdivide; sparse regions don't). No network.
 * Run: tsx scripts/test-discovery-tiling.ts
 */
import assert from "node:assert/strict";
import { collectAdaptiveRegions } from "@/lib/places/discoveryTiling";

let passed = 0;
function check(name: string, fn: () => Promise<void> | void) {
  const r = fn();
  if (r instanceof Promise) return r.then(() => { passed++; console.log(`  ✓ ${name}`); });
  passed++; console.log(`  ✓ ${name}`);
}

// A region is a [start,end) integer interval; "dense" = width > 1 saturates (split in half).
interface Reg { lo: number; hi: number }
const splitRegion = (r: Reg): Reg[] => {
  const mid = Math.floor((r.lo + r.hi) / 2);
  return [{ lo: r.lo, hi: mid }, { lo: mid, hi: r.hi }];
};
const canSubdivide = (r: Reg): boolean => r.hi - r.lo > 1; // floor = width 1

async function main() {
  await check("sparse region (width 1) fetched once, never split", async () => {
    const seen: Reg[] = [];
    const { collected, calls } = await collectAdaptiveRegions<Reg, { id?: string }>({
      seedRegions: [{ lo: 0, hi: 1 }],
      fetchRegion: async (r) => { seen.push(r); return { places: [{ id: "a" }], saturated: false, calls: 1 }; },
      splitRegion, canSubdivide,
    });
    assert.equal(seen.length, 1);
    assert.equal(calls, 1);
    assert.deepEqual([...collected.keys()], ["a"]);
  });

  await check("saturated region recurses until width-1 floor, then logs floorSaturated", async () => {
    const floor: Reg[] = [];
    const { calls } = await collectAdaptiveRegions<Reg, { id?: string }>({
      seedRegions: [{ lo: 0, hi: 4 }],
      // Every region is saturated → it recurses down to width-1 leaves (4 of them).
      fetchRegion: async () => ({ places: [{ id: "x" }], saturated: true, calls: 1 }),
      splitRegion, canSubdivide,
      onFloorSaturated: (r) => floor.push(r),
    });
    // width4 → 2×width2 → 4×width1. 1 + 2 + 4 = 7 fetches; 4 width-1 leaves are floor-saturated.
    assert.equal(calls, 7);
    assert.equal(floor.length, 4);
  });

  await check("maxCalls cap stops the run and reports remaining", async () => {
    let capRemaining = -1;
    const { calls } = await collectAdaptiveRegions<Reg, { id?: string }>({
      seedRegions: [{ lo: 0, hi: 8 }],
      fetchRegion: async () => ({ places: [], saturated: true, calls: 1 }),
      splitRegion, canSubdivide,
      maxCalls: 3,
      onCapReached: (remaining) => { capRemaining = remaining; },
    });
    assert.ok(calls <= 3 + 1, `calls ${calls} should not blow past the cap by more than one region`);
    assert.ok(capRemaining > 0, "should report queued regions left unvisited");
  });

  await check("de-dupes places across regions by id", async () => {
    const { collected } = await collectAdaptiveRegions<Reg, { id?: string }>({
      seedRegions: [{ lo: 0, hi: 2 }],
      fetchRegion: async () => ({ places: [{ id: "dup" }], saturated: true, calls: 1 }),
      splitRegion, canSubdivide,
    });
    assert.deepEqual([...collected.keys()], ["dup"]);
  });

  console.log(`\n${passed} checks passed.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-discovery-tiling.ts`
Expected: FAIL — `collectAdaptiveRegions` is not exported from `@/lib/places/discoveryTiling`.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/places/discoveryTiling.ts` (after `collectAdaptive`, end of file):

```typescript
// ---------------------------------------------------------------------------
// Region-shape-agnostic adaptive engine (drives the saturation-recursive HH recall).
// `collectAdaptive` above is the circle-specific Nearby variant; this generalizes the
// same control structure to ANY region (e.g. lat/lng rectangles for Text Search): fetch
// a region, and if it came back saturated AND is still above its floor AND we're under the
// call cap, split it and recurse. Pure + injectable so it unit-tests with no network.
// ---------------------------------------------------------------------------

export interface RegionFetchResult<T extends TilePlace> {
  places: T[];
  /** The region returned MORE than one fetch could surface (truncated) — subdivide it. */
  saturated: boolean;
  /** API calls this region's fetch consumed (Text Search paginates → up to N per region). */
  calls: number;
}

export interface CollectAdaptiveRegionsOptions<R, T extends TilePlace> {
  seedRegions: R[];
  /** Fetch all places for one region (deduped upstream by id). Injected for tests. */
  fetchRegion: (region: R) => Promise<RegionFetchResult<T>>;
  /** Split a saturated region into smaller children. */
  splitRegion: (region: R) => R[];
  /** True when a saturated region is still allowed to subdivide (above the floor). */
  canSubdivide: (region: R) => boolean;
  /** Cost cap: stop once cumulative fetch calls reach this. Default Infinity. */
  maxCalls?: number;
  /** Called when a saturated region cannot subdivide (genuine dense hotspot at the floor). */
  onFloorSaturated?: (region: R) => void;
  /** Called when maxCalls halts the run, with the number of queued regions left unvisited. */
  onCapReached?: (remaining: number) => void;
}

/**
 * Process seed regions, subdividing saturated ones until each returns un-saturated (or hits
 * the floor or the call cap). Returns the deduped place map + total calls made.
 */
export async function collectAdaptiveRegions<R, T extends TilePlace>(
  opts: CollectAdaptiveRegionsOptions<R, T>,
): Promise<{ collected: Map<string, T>; calls: number }> {
  const maxCalls = opts.maxCalls ?? Infinity;
  const collected = new Map<string, T>();
  const queue: R[] = [...opts.seedRegions];
  let calls = 0;

  while (queue.length > 0) {
    if (calls >= maxCalls) {
      opts.onCapReached?.(queue.length);
      break;
    }
    const region = queue.shift() as R;
    const r = await opts.fetchRegion(region);
    calls += r.calls;
    for (const p of r.places) {
      if (p.id) collected.set(p.id, p);
    }
    if (r.saturated) {
      if (opts.canSubdivide(region)) queue.push(...opts.splitRegion(region));
      else opts.onFloorSaturated?.(region);
    }
  }
  return { collected, calls };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-discovery-tiling.ts`
Expected: PASS — `4 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/places/discoveryTiling.ts scripts/test-discovery-tiling.ts
git commit -m "feat(discovery): generic region-adaptive engine (collectAdaptiveRegions)"
```

---

## Task 2: Rectangle geometry helpers + floor

**Files:**
- Modify: `scripts/seed-discover.ts` (add helpers near `splitRectQuadrants`, ~line 387; constants near `TEXT_SEARCH_MAX_PAGES`, ~line 365)
- Test: `scripts/test-recall-rect.ts` (create)

The pure helpers must be `export`ed from `seed-discover.ts` so the test can import them. (The file already exports pure helpers used by other tests — follow that pattern.)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-recall-rect.ts`:

```typescript
/**
 * test-recall-rect — hermetic checks for the recall rectangle floor math (no network).
 * Run: tsx scripts/test-recall-rect.ts
 */
import assert from "node:assert/strict";
import { rectHalfDiagonalMeters, canSubdivideRect } from "@/scripts/seed-discover";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

// A ~1.1km × ~1.1km box near lat 37.33 (downtown SJ): half-diagonal ≈ 780m.
const sjBox = { low: { latitude: 37.330, longitude: -121.900 }, high: { latitude: 37.340, longitude: -121.888 } };

check("rectHalfDiagonalMeters is positive and in the expected order of magnitude", () => {
  const m = rectHalfDiagonalMeters(sjBox);
  assert.ok(m > 500 && m < 1500, `half-diagonal ${m} out of expected range`);
});

check("canSubdivideRect: a box whose CHILD would stay above the floor may split", () => {
  // Child half-diagonal = parent/2 ≈ 390m; with a 450m floor the child is BELOW floor → cannot split.
  assert.equal(canSubdivideRect(sjBox, 450), false);
});

check("canSubdivideRect: a large box (child above floor) may split", () => {
  const big = { low: { latitude: 37.30, longitude: -121.95 }, high: { latitude: 37.40, longitude: -121.85 } };
  // ~11km box → half-diagonal ~7.8km → child ~3.9km ≥ 450m floor → can split.
  assert.equal(canSubdivideRect(big, 450), true);
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm tsx scripts/test-recall-rect.ts`
Expected: FAIL — `rectHalfDiagonalMeters`/`canSubdivideRect` not exported.

- [ ] **Step 3: Write minimal implementation**

In `scripts/seed-discover.ts`, add the constants after `TEXT_SEARCH_MAX_PAGES` (~line 365):

```typescript
/** Recall subdivision floor: never recurse a region whose CHILD half-diagonal would be below
 *  this (~downtown-block scale). Env-tunable. */
const RECALL_FLOOR_METERS = Number(process.env.RECALL_FLOOR_METERS) || 450;
/** Per-city recall cost cap: stop after this many Text Search calls (~$0.03 each → ~$1). The
 *  adaptive recursion would otherwise scale with density without bound. Env-tunable. */
const RECALL_MAX_CALLS = Number(process.env.RECALL_MAX_CALLS) || 30;
```

Add the helpers right after `splitRectQuadrants` (~line 387):

```typescript
/** Approx meters of HALF the rectangle's diagonal — the region's "radius" for the floor test. */
export function rectHalfDiagonalMeters(r: LatLngRect): number {
  const midLat = (r.low.latitude + r.high.latitude) / 2;
  const dLatM = (r.high.latitude - r.low.latitude) * 111_320;
  const dLngM = (r.high.longitude - r.low.longitude) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.hypot(dLatM, dLngM) / 2;
}

/** True when a saturated region may still subdivide: its CHILD (half-size) stays at/above the
 *  floor. Mirrors discoveryTiling.canSubdivide for circles. */
export function canSubdivideRect(r: LatLngRect, floorMeters = RECALL_FLOOR_METERS): boolean {
  return rectHalfDiagonalMeters(r) / 2 >= floorMeters;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm tsx scripts/test-recall-rect.ts`
Expected: PASS — `3 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-discover.ts scripts/test-recall-rect.ts
git commit -m "feat(discovery): recall rectangle floor helpers"
```

---

## Task 3: Saturation-aware single-region fetch + boundary prune

**Files:**
- Modify: `scripts/seed-discover.ts` (replace `collectHhRecall`, ~lines 418-449)

A region's fetch keeps the existing pagination but now reports whether it was **truncated** (saturated) and how many calls it spent, and prunes out-of-boundary child regions before paying (mirrors the Nearby child-tile `ST_DWithin` prune).

- [ ] **Step 1: Write the implementation** (this is an internal refactor exercised by Task 5's full run + the engine test from Task 1; no new unit test — the network fetch isn't hermetic)

In `scripts/seed-discover.ts`, replace the whole `collectHhRecall` function (~lines 418-449) with `fetchRecallRegion`:

```typescript
/**
 * Fetch ONE recall region: run each "happy hour" query, paginate to the page cap, merge unique
 * places into `into`. Reports `saturated` (a query hit the page cap with MORE pages available →
 * the region holds >cap venues, subdivide it) and `calls` (cost). Out-of-boundary regions are
 * pruned at $0 so we never pay to recurse into a neighbour city (mirrors the Nearby prune).
 */
async function fetchRecallRegion(
  apiKey: string,
  region: LatLngRect,
  into: Map<string, PlaceResult>,
  opts: { prune?: (region: LatLngRect) => Promise<boolean> },
): Promise<{ places: PlaceResult[]; saturated: boolean; calls: number }> {
  if (opts.prune && (await opts.prune(region))) {
    return { places: [], saturated: false, calls: 0 };
  }
  const fresh: PlaceResult[] = [];
  let calls = 0;
  let saturated = false;
  for (const q of HH_RECALL_QUERIES) {
    let pageToken: string | undefined;
    let page = 0;
    do {
      const data = await fetchTextSearchPage(apiKey, q, region, pageToken);
      calls++;
      for (const p of data.places ?? []) {
        if (!p.id) continue;
        if (!into.has(p.id)) fresh.push(p);
        into.set(p.id, p);
      }
      pageToken = data.nextPageToken;
      page++;
      await new Promise((r) => setTimeout(r, 40));
    } while (pageToken && page < TEXT_SEARCH_MAX_PAGES);
    // Loop ended with a pageToken still in hand = there were more results past our page cap.
    if (pageToken) saturated = true;
  }
  return { places: fresh, saturated, calls };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: it will FAIL only at the now-orphaned `collectHhRecall` call site (fixed in Task 4). `fetchRecallRegion` itself must type-clean. If other errors appear, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-discover.ts
git commit -m "feat(discovery): saturation-aware single-region recall fetch + boundary prune"
```

---

## Task 4: Drive recall through the adaptive engine; retire --sub-tile

**Files:**
- Modify: `scripts/seed-discover.ts` — import (~line 41), recall-region setup (~line 741), estimate print (~lines 796-801), the recall invocation (~lines 868-871), and the `--sub-tile` arg/usage (~lines 65, 76, 88, 107-109).

- [ ] **Step 1: Add the engine import**

In the `@/lib/places/discoveryTiling` import block (~line 41-45), add `collectAdaptiveRegions`:

```typescript
import {
  collectAdaptive,
  collectAdaptiveRegions,
  MAX_DEPTH,
  type Tile,
} from "@/lib/places/discoveryTiling";
```

- [ ] **Step 2: Replace the recall-region setup**

Find (~line 741):

```typescript
    const recallRegions: LatLngRect[] = args.subTile ? splitRectQuadrants(recallRect) : [recallRect];
```

Replace with a single seed region (recursion handles density now):

```typescript
    // Recall is adaptive: seed with the whole recall rectangle; saturated regions self-subdivide
    // into dense cores (downtown). `splitRectQuadrants` is now the engine's splitRegion, not a
    // one-shot opt-in.
    const recallSeedRegions: LatLngRect[] = [recallRect];
```

- [ ] **Step 3: Replace the estimate print**

Find (~lines 796-801), the block that computes `plannedRecallCalls` and prints `HH recall plan`. Replace the `plannedRecallCalls` expression and print with a cap-based worst case:

```typescript
      // Adaptive recall cost is bounded by the per-city call cap, not a fixed region count.
      const plannedRecallCalls = RECALL_MAX_CALLS;
      console.log(
        `  HH recall plan (adaptive): "${HH_RECALL_QUERIES.join('", "')}" — saturated regions ` +
          `subdivide to a ~${RECALL_FLOOR_METERS}m floor, capped at ${RECALL_MAX_CALLS} Text Search ` +
          `call(s) (~$${(RECALL_MAX_CALLS * 0.03).toFixed(2)})…`,
      );
```

(If `plannedRecallCalls` is summed into a total-estimate elsewhere, keep the variable name so that arithmetic is unchanged.)

- [ ] **Step 4: Replace the recall invocation**

Find (~lines 868-871):

```typescript
    if (recallEnabled) {
      const { calls, added } = await collectHhRecall(placesKey, recallRegions, collected);
      console.log(`  HH recall: ${calls} Text Search call(s) → ${added} unique place(s) added to the pool.`);
    }
```

Replace with the adaptive drive:

```typescript
    if (recallEnabled) {
      const before = collected.size;
      let floorSaturated = 0;
      let capRemaining = 0;
      const prune = useBoundary
        ? async (region: LatLngRect): Promise<boolean> => {
            const [{ within }] = await sql<{ within: boolean }[]>`
              SELECT ST_DWithin(
                g::geography,
                ST_MakeEnvelope(${region.low.longitude}, ${region.low.latitude},
                                ${region.high.longitude}, ${region.high.latitude}, 4326)::geography,
                ${SERVICE_BUFFER_METERS}
              ) AS within
              FROM _seed_boundary
            `;
            return !within; // prune (true) when the region cannot reach the in-scope boundary
          }
        : undefined;
      const { calls } = await collectAdaptiveRegions<LatLngRect, PlaceResult>({
        seedRegions: recallSeedRegions,
        fetchRegion: (region) => fetchRecallRegion(placesKey, region, collected, { prune }),
        splitRegion: splitRectQuadrants,
        canSubdivide: (region) => canSubdivideRect(region),
        maxCalls: RECALL_MAX_CALLS,
        onFloorSaturated: () => { floorSaturated++; },
        onCapReached: (remaining) => { capRemaining = remaining; },
      });
      const added = collected.size - before;
      console.log(
        `  HH recall (adaptive): ${calls} Text Search call(s) → ${added} unique place(s) added` +
          (floorSaturated > 0 ? `; ${floorSaturated} floor region(s) still saturated (dense hotspot — some may remain)` : ``) +
          (capRemaining > 0 ? `; ⚠ hit the ${RECALL_MAX_CALLS}-call cap with ${capRemaining} region(s) unvisited (raise RECALL_MAX_CALLS to go deeper)` : ``),
      );
    }
```

- [ ] **Step 5: Retire `--sub-tile`**

Remove `subTile` from the args interface (~line 65), the recognised-flags list (~line 76), the usage string (~line 88), and the `subTile: argv.includes("--sub-tile")` line (~line 109). If `splitRectQuadrants` now has no other caller besides the engine wiring, that's fine — it stays (used as `splitRegion`). Grep to confirm no remaining `args.subTile` / `--sub-tile` references:

Run: `grep -n "subTile\|sub-tile\|collectHhRecall\|recallRegions\b" scripts/seed-discover.ts`
Expected: no matches (all replaced).

- [ ] **Step 6: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-discover.ts
git commit -m "feat(discovery): drive HH recall through the adaptive engine; retire --sub-tile"
```

---

## Task 5: Register tests, full green

**Files:**
- Modify: `package.json` (scripts block), `scripts/ci-tests.sh` (TESTS array)

- [ ] **Step 1: Add the package.json test scripts**

In `package.json` scripts, near the other `test:*` entries, add:

```json
    "test:discovery-tiling": "tsx scripts/test-discovery-tiling.ts",
    "test:recall-rect": "tsx scripts/test-recall-rect.ts",
```

- [ ] **Step 2: Register in ci-tests.sh**

In `scripts/ci-tests.sh`, add to the `TESTS=(...)` array (near the other discovery/tiling entries):

```bash
  test:discovery-tiling
  test:recall-rect
```

- [ ] **Step 3: Run the two new suites**

Run: `pnpm test:discovery-tiling && pnpm test:recall-rect`
Expected: both print `N checks passed.`

- [ ] **Step 4: Typecheck + lint + full hermetic suite**

Run: `pnpm typecheck && pnpm exec eslint scripts/seed-discover.ts lib/places/discoveryTiling.ts scripts/test-discovery-tiling.ts scripts/test-recall-rect.ts && pnpm test`
Expected: typecheck clean; eslint 0 errors; `✓ all NN hermetic test suites passed.`

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/ci-tests.sh
git commit -m "test(discovery): register adaptive-recall hermetic suites"
```

---

## Task 6: Validate on real cities (operational — not committed code)

This is a runbook step run by the operator/agent with `$`-approval, NOT a code change.

- [ ] **Step 1: Dry-run estimate on San Jose**

Run: `pnpm seed:discover --city san-jose --state ca --hh-recall-only --estimate`
Expected: prints the adaptive recall plan + the `≤ RECALL_MAX_CALLS` cap. No spend.

- [ ] **Step 2: Live recall on San Jose + Scottsdale (the known-gap cities)**

Run: `pnpm seed:discover --city san-jose --state ca --hh-recall-only`
then: `pnpm seed:discover --city scottsdale --state az --hh-recall-only`
Expected: the log reports new unique places added. Confirm the known misses now exist as candidates:

```sql
SELECT name FROM seed_candidates sc JOIN cities c ON c.id=sc.city_id
WHERE c.slug='san-jose' AND sc.name ILIKE '%pressroom%';   -- expect 1 row
```

- [ ] **Step 3: Enrich the newly-found HH-likely candidates**, then roll the remaining 11 cities once SJ/Scottsdale confirm. (Standard enrich flow; out of scope for this plan's code.)

---

## Self-Review

- **Spec coverage:** §1 saturation-recursion → Tasks 1+3+4. §2 reuse/no-rebuild → Task 1 (generic engine; Nearby left intact per "out of scope: don't restructure working code"). §2 boundary prune → Task 3/4 `prune`. §3 defaults/flags (retire --sub-tile, estimate) → Task 4. §4 rollout/backfill → Task 6. §5 testing → Tasks 1,2,5. Floor + cap constants → Task 2. All covered.
- **Placeholders:** none — every code step shows complete code; commands have expected output.
- **Type consistency:** `collectAdaptiveRegions` signature (Task 1) matches its call site (Task 4): `seedRegions`, `fetchRegion`, `splitRegion`, `canSubdivide`, `maxCalls`, `onFloorSaturated`, `onCapReached`. `RegionFetchResult` (`places`/`saturated`/`calls`) matches `fetchRecallRegion`'s return (Task 3). `rectHalfDiagonalMeters`/`canSubdivideRect` (Task 2) used in Task 4's `canSubdivide`. `LatLngRect`, `PlaceResult`, `splitRectQuadrants`, `SERVICE_BUFFER_METERS`, `_seed_boundary`, `useBoundary` all pre-exist in seed-discover.ts.
- **Note:** Task 3's `fetchRecallRegion` is exercised live (Task 5 full run / Task 6), not a hermetic unit (it makes network calls) — the recursion logic IS hermetically tested via the injectable engine in Task 1.
