# Silicon Valley City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `silicon-valley` (Core 5 South Bay cities + Los Altos + Los Altos Hills) as a new aggregate city, taken from nothing through the paid onboarding pipeline to an operator review gate — without touching prod or flipping it live.

**Architecture:** Pure data/config onboarding on the existing multi-city-native schema (no migrations). One `cities` row whose membership is enforced by a custom single-MultiPolygon boundary GeoJSON (union of 7 OSM municipal relations) plus a `serviceLocalities` allow-list, exactly like the `five-cities` aggregate. Boundary built by a small reusable Overpass-fetch script.

**Tech Stack:** TypeScript + `tsx`, `osmtogeojson` (existing dep), Overpass API, local PostGIS (Docker), Drizzle/postgres.js, the existing `seed:cities` / `onboard:city` / neighborhood scripts.

**Spec:** `docs/superpowers/specs/2026-06-29-silicon-valley-city-design.md`

**Branch:** `feat/silicon-valley-city` (already created off `origin/main`).

**OSM relation IDs (verified via Nominatim, all admin_level boundaries in Santa Clara County, CA):**
| City | relation |
|---|---|
| Palo Alto | 1544955 |
| Mountain View | 1544956 |
| Sunnyvale | 112145 |
| Santa Clara | 2221647 |
| Cupertino | 2221709 |
| Los Altos | 1545000 |
| Los Altos Hills | 1552032 |

**Cost posture:** Tasks 1–3 and 5–6 are $0. Task 4 is the only paid step and is HARD-GATED on an explicit operator OK at the estimate (Core-5+LosAltos ~620k pop is expected to exceed one $5 run). Enrich is always `--batch`. The agent never flips the city live or pushes prod.

---

### Task 1: Build the boundary GeoJSON ($0)

Build one `data/silicon-valley-boundary.geojson` whose single feature is a MultiPolygon merging all 7 relations. **Why one merged feature:** `scripts/seed-discover.ts:746-752` reads `raw.features[0].geometry` for a FeatureCollection — only the FIRST feature. Seven separate features would silently use Palo Alto alone. This mirrors how `data/five-cities-boundary.geojson` (1 feature, MultiPolygon) and `data/daly-city-boundary.geojson` (Daly City + Colma merged) are built.

**Files:**
- Create: `scripts/build-aggregate-boundary.ts`
- Create (output): `data/silicon-valley-boundary.geojson`
- Test: `scripts/test-silicon-valley-boundary.ts`

- [ ] **Step 1: Write the reusable boundary-builder script**

Create `scripts/build-aggregate-boundary.ts`. Fetches each OSM relation's geometry from Overpass, flattens every Polygon/MultiPolygon into one MultiPolygon, writes a FeatureCollection with exactly one feature.

```typescript
/**
 * Build a single-MultiPolygon boundary GeoJSON by merging several OSM admin relations.
 * Used for aggregate cities (five-cities, silicon-valley) where one HHF "city" spans
 * multiple municipalities. Output shape matches what seed:discover expects: a
 * FeatureCollection whose FIRST (only) feature is a MultiPolygon covering every relation.
 *
 *   tsx scripts/build-aggregate-boundary.ts --slug silicon-valley \
 *     --relations 1544955,1544956,112145,2221647,2221709,1545000,1552032
 */
import { writeFileSync } from "node:fs";
import osmtogeojson from "osmtogeojson";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

const slug = arg("slug");
const relationIds = arg("relations").split(",").map((s) => s.trim()).filter(Boolean);

async function fetchRelationGeometry(id: string): Promise<number[][][][]> {
  const query = `[out:json][timeout:90];rel(${id});out geom;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} for relation ${id}`);
  const osm = await res.json();
  const gj = osmtogeojson(osm) as { features: Array<{ geometry: { type: string; coordinates: unknown } }> };
  const polys = gj.features.filter(
    (f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
  );
  if (polys.length === 0) throw new Error(`no polygon geometry for relation ${id}`);
  // Flatten every Polygon/MultiPolygon into MultiPolygon members ([rings][]).
  const members: number[][][][] = [];
  for (const f of polys) {
    if (f.geometry.type === "Polygon") members.push(f.geometry.coordinates as number[][][]);
    else for (const m of f.geometry.coordinates as number[][][][]) members.push(m);
  }
  return members;
}

const allMembers: number[][][][] = [];
for (const id of relationIds) {
  const members = await fetchRelationGeometry(id);
  console.log(`relation ${id}: ${members.length} polygon part(s)`);
  allMembers.push(...members);
}

const fc = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { slug, relations: relationIds },
      geometry: { type: "MultiPolygon", coordinates: allMembers },
    },
  ],
};
const out = `data/${slug}-boundary.geojson`;
writeFileSync(out, JSON.stringify(fc));
console.log(`✓ wrote ${out} — ${allMembers.length} total polygon part(s) from ${relationIds.length} relation(s)`);
```

- [ ] **Step 2: Run the builder for Silicon Valley**

Run:
```bash
pnpm tsx scripts/build-aggregate-boundary.ts --slug silicon-valley --relations 1544955,1544956,112145,2221647,2221709,1545000,1552032
```
Expected: prints 7 `relation … N polygon part(s)` lines, then `✓ wrote data/silicon-valley-boundary.geojson`. If Overpass returns 429/504, wait and re-run (idempotent — it overwrites).

- [ ] **Step 3: Write the validation test (failing first)**

Create `scripts/test-silicon-valley-boundary.ts`. Mirrors `scripts/test-daly-boundary.ts` but adds positive point-in-polygon checks for all 7 city centers and negative checks for San Jose + Menlo Park (must be OUTSIDE).

```typescript
/**
 * Validates the merged Silicon Valley boundary GeoJSON (7 OSM relations → 1 MultiPolygon).
 * Pure (no DB). Run: pnpm tsx scripts/test-silicon-valley-boundary.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pointInPolygon } from "../lib/geo/pointInPolygon";

const fc = JSON.parse(readFileSync("data/silicon-valley-boundary.geojson", "utf8"));
assert.equal(fc.type, "FeatureCollection");
assert.equal(fc.features.length, 1, "boundary MUST be a single merged feature (seed:discover reads features[0] only)");
const geom = fc.features[0].geometry;
assert.equal(geom.type, "MultiPolygon", `expected MultiPolygon, got ${geom.type}`);
assert.ok(geom.coordinates.length >= 7, `expected >=7 polygon parts, got ${geom.coordinates.length}`);

// Inside: one representative point per municipality (city centers / downtowns).
const inside: Array<[string, number, number]> = [
  ["Palo Alto", -122.1430, 37.4419],
  ["Mountain View", -122.0819, 37.3894],
  ["Sunnyvale", -122.0363, 37.3688],
  ["Santa Clara", -121.9552, 37.3541],
  ["Cupertino", -122.0322, 37.3230],
  ["Los Altos", -122.1141, 37.3852],
  ["Los Altos Hills", -122.1372, 37.3797],
];
for (const [name, lng, lat] of inside) {
  assert.ok(pointInPolygon([lng, lat], geom), `${name} center should be INSIDE the boundary`);
}

// Outside: deliberately-excluded neighbors.
const outside: Array<[string, number, number]> = [
  ["San Jose", -121.8863, 37.3382],
  ["Menlo Park", -122.1817, 37.4530],
];
for (const [name, lng, lat] of outside) {
  assert.ok(!pointInPolygon([lng, lat], geom), `${name} should be OUTSIDE the boundary`);
}

console.log(`✓ silicon-valley boundary OK — 1 feature, ${geom.coordinates.length} parts, 7 inside / 2 outside checks passed`);
```

- [ ] **Step 4: Run the test**

Run: `pnpm tsx scripts/test-silicon-valley-boundary.ts`
Expected: `✓ silicon-valley boundary OK — …`. If a city center fails INSIDE, the relation set or Overpass output is wrong; if San Jose passes INSIDE, a wrong relation got merged. Fix the relation list and re-run Steps 2 + 4.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-aggregate-boundary.ts scripts/test-silicon-valley-boundary.ts data/silicon-valley-boundary.geojson
git commit -m "feat(silicon-valley): merged OSM boundary for 7 South Bay municipalities"
```

---

### Task 2: Register the city row ($0)

**Files:**
- Modify: `scripts/seed-cities.ts` (append one entry to the `CITIES` array, before the closing `]`)

- [ ] **Step 1: Compute the boundary bbox center for `centerLat`/`centerLng`**

Run:
```bash
pnpm tsx -e "const fc=require('fs').readFileSync('data/silicon-valley-boundary.geojson','utf8');let a=90,b=-90,c=180,d=-180;const w=(x)=>{if(typeof x[0]==='number'){c=Math.min(c,x[0]);d=Math.max(d,x[0]);a=Math.min(a,x[1]);b=Math.max(b,x[1]);return}x.forEach(w)};w(JSON.parse(fc).features[0].geometry.coordinates);console.log('centerLat',((a+b)/2).toFixed(4),'centerLng',((c+d)/2).toFixed(4))"
```
Expected: a center near `centerLat 37.39 centerLng -122.06`. Use the printed values in Step 2.

- [ ] **Step 2: Add the city block**

Add to the `CITIES` array in `scripts/seed-cities.ts` (use the exact center from Step 1):

```typescript
  {
    // Silicon Valley, CA — aggregate of 7 South Bay municipalities (2026-06-29). Merged OSM
    // relations: Palo Alto 1544955, Mountain View 1544956, Sunnyvale 112145, Santa Clara
    // 2221647, Cupertino 2221709, Los Altos 1545000, Los Altos Hills 1552032. San Jose is
    // deliberately excluded (standalone city's worth of venues; widen later as its own scope).
    // data/silicon-valley-boundary.geojson drives real tiling/gate; radiusKm is fallback only.
    slug: "silicon-valley",
    name: "Silicon Valley",
    state: "CA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    centerLat: 37.39,
    centerLng: -122.06,
    seedConfig: {
      radiusKm: 14,
      cellMeters: 3000,
      serviceLocalities: [
        "Palo Alto",
        "Mountain View",
        "Sunnyvale",
        "Santa Clara",
        "Cupertino",
        "Los Altos",
        "Los Altos Hills",
        "Stanford",
      ],
      serviceBufferMeters: 500,
    },
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes (no errors). Fixes any trailing-comma / type issues before seeding.

- [ ] **Step 4: Seed the city (idempotent)**

Run: `pnpm run seed:cities`
Expected: completes without error; output lists/inserts `silicon-valley`.

- [ ] **Step 5: Verify the row exists in `discovery` status**

Run:
```bash
pnpm tsx scripts/db-query.ts "SELECT slug, name, state, status FROM cities WHERE slug='silicon-valley'"
```
Expected: one row, `status='discovery'` (invisible — renders nowhere until operator go-live).

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-cities.ts
git commit -m "feat(silicon-valley): register city row (status=discovery)"
```

---

### Task 3: Estimate + cost gate ($0 — STOP for operator OK)

**Files:** none (read-only preview).

- [ ] **Step 1: Run the $0 estimate**

Run: `pnpm tsx scripts/onboard-city.ts --city silicon-valley --state CA --estimate`
Expected: prints boundary-pruned tile count + worst-case HH-recall call count + a dollar estimate. No paid call is made.

- [ ] **Step 2: Report and STOP**

Report to the operator: tile count, estimated discovery $ , HH-recall $, and total. **Do NOT run the paid onboard.** Core-5+LosAltos is expected to exceed one $5 run, and the spend rule (memory `feedback_city_run_autonomy_spend_gate`) is: quote the estimate, proceed only if <$5, STOP and get explicit OK if ≥$5. Also sum any other in-flight paid jobs into the quote (memory `feedback_concurrent-paid-jobs-combined-total`). Wait for explicit operator approval before Task 4.

---

### Task 4: Paid onboard run (PAID — only after Task 3 approval)

**Files:** none (writes venues/HH to the local DB; `--debug-drops` writes a drops JSON).

- [ ] **Step 1: Run onboard:city (one paid pipeline)**

Run: `pnpm tsx scripts/onboard-city.ts --city silicon-valley --state CA --yes --debug-drops`
This runs discover (Nearby + HH recall) → enrich `--batch` → regate → combo-cuisine drop → city summary. `--yes` is required for non-interactive agent runs. It does NOT flip the city live or touch prod. Expected: completes with a city summary (candidates, venues, confirmed-HH, hidden, stubs).

- [ ] **Step 2: Verify discovery sanity**

Run:
```bash
pnpm tsx scripts/db-query.ts "SELECT count(*) AS venues, count(*) FILTER (WHERE status='live') AS live FROM venues v JOIN cities c ON c.id=v.city_id WHERE c.slug='silicon-valley'"
```
Expected: a plausible metro count (order ~700–1200 venues). If it's ~100, boundary/locality filtering is wrong — investigate before spending more.

- [ ] **Step 3: Verify out-of-scope drops**

Open `docs/silicon-valley-discovery-drops.json` (written by `--debug-drops`). Confirm San Jose / Menlo Park / Campbell / Milpitas candidates appear in the drop list with an out-of-boundary or wrong-locality reason. Spot-check 3–5 dropped names.

- [ ] **Step 4: Commit any artifacts**

```bash
git add docs/silicon-valley-discovery-drops.json
git commit -m "chore(silicon-valley): discovery drop log"
```

---

### Task 5: Neighborhood pipeline ($0, except none paid)

`onboard:city` does NOT import neighborhoods — enrich only assigns to existing polygons. Run the OSM neighborhood pipeline for the new city.

**Files:** none (DB writes + reads).

- [ ] **Step 1: Import OSM neighbourhoods**

Run: `pnpm run import:osm-neighborhoods -- --city silicon-valley --state CA`
Expected: inserts neighbourhood/quarter/suburb polygons for the metro.

- [ ] **Step 2: Backfill tiers**

Run: `pnpm run backfill:neighborhood-tiers -- --city silicon-valley --state CA`
Expected: sets `tier` + `recognizability` on the imported rows.

- [ ] **Step 3: Generate cardinal districts**

Run: `pnpm run generate:cardinal-districts -- --city silicon-valley --state CA --downtown`
Expected: clips Downtown + N/E/S/W/Central coarse districts from the boundary. (`--downtown` per memory `project_neighborhood-canonical-dedup`.)

- [ ] **Step 4: Analyze coverage**

Run: `pnpm run analyze:neighborhood-coverage -- --city silicon-valley --state CA`
Expected: reports ≥95% of venues assigned a neighborhood. If lower, that's an add-polygons gap (memory `feedback_neighborhood_coverage_via_polygons`) — note it in the review doc; do NOT widen the snap radius.

---

### Task 6: Operator review doc + handoff ($0)

**Files:**
- Create: `docs/silicon-valley-onboarding-review.md`

- [ ] **Step 1: Build the review doc**

Mirror `docs/san-luis-obispo-onboarding-review.md`: summarize live / hidden / stub / dropped counts, the cost actually spent, neighborhood coverage %, and any flagged items (wrong-city leaks, third-party sources, suspicious windows) for the operator to eyeball. Pull counts with `scripts/db-query.ts`.

- [ ] **Step 2: Commit and open the PR**

```bash
git add docs/silicon-valley-onboarding-review.md
git commit -m "docs(silicon-valley): onboarding review summary"
git push -u origin feat/silicon-valley-city
gh pr create --fill --base main
```

- [ ] **Step 3: Hand off go-live (operator-only)**

Report the review doc + PR link. **STOP.** The operator flips `status='live'` and pushes prod data — the agent never touches prod or flips a city live (memory `feedback_operator_handles_prod_deploys`).

---

## Notes for the executor

- **Paid step is Task 4 only.** Everything else is $0 and reversible. Never run Task 4 without the Task 3 operator OK.
- **Always `--debug-drops`** (memory `feedback_city_run_autonomy_spend_gate`).
- If `pnpm typecheck` flags the seed-cities edit, fix it before seeding — a bad city row poisons every downstream phase.
- After any branch switch during this work, `rm -rf .next` before `pnpm dev` (CLAUDE.md).
