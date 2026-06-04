# Daly City Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. **Inline (main-thread) execution is required** — several steps need outbound web fetches (boundary GeoJSON, OSM neighborhoods) and the discover/enrich steps cost real money; background subagents cannot do web fetches or be trusted with spend. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Onboard Daly City, CA (`/ca/daly-city`) end-to-end — city row + combined Daly City/Colma boundary, then the existing discover → enrich → neighborhoods → review → go-live funnel — as the pilot for nested-routing-era city onboarding.

**Architecture:** One small code change (a `cities` row in `scripts/seed-cities.ts`) plus a sourced boundary GeoJSON drive the entire existing pipeline. Discovery runs in boundary mode (tiles the combined Daly City + Colma polygon, gates results with `ST_DWithin` + a `["Daly City","Colma"]` locality filter). Everything downstream (enrich, neighborhoods, scope, review) is existing scripts keyed on the city slug.

**Tech Stack:** Next.js 16, Drizzle + postgres.js, PostGIS, Google Places API (New), Anthropic web_fetch extractor. Boundary sourced from OSM Nominatim (`polygon_geojson=1`) via `curl`. Tests follow the repo convention (standalone `tsx` scripts, `node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-06-02-daly-city-onboarding-design.md`.

---

## Cost & safety notes (read before executing)

- **PAID steps:** Task 5 (`seed:discover`, Google Places) and Task 6 (`seed:enrich`, Anthropic web_fetch) spend real money. Per `[[feedback_verify_cost_before_claiming_free]]`, do NOT treat dry-runs as free, and confirm spend + set a Console cap before running. The plan PAUSES for operator go/no-go before Task 5.
- **Local DB is shared** across worktrees (the `hhf-postgres` container). Writes here affect the main checkout's dev DB too — expected.
- Use ONLY `DATABASE_URL` (local `:5432`). NEVER write to `PROD_DATABASE_URL` (`:5433`, a prod tunnel).
- Work in the worktree `/Users/stevenmatthiesen/Personal/happyhourfriends/.worktrees/daly-city` (branch `daly-city-onboarding`).

---

## File Structure

**Modify:**
- `scripts/seed-cities.ts` — add `serviceBufferMeters?` to the `SeedConfig` interface; add the Daly City entry to `CITIES`.
- `docs/superpowers/specs/2026-06-02-daly-city-onboarding-design.md` — correct the boundary filename to the slug-matched `data/daly-city-boundary.geojson`.

**Create:**
- `data/daly-city-boundary.geojson` — combined Daly City + Colma municipal polygon (sourced).
- `scripts/test-daly-boundary.ts` — validates the sourced boundary (parses, is Polygon/MultiPolygon, bbox sits in the Daly City/Colma lat-lng window).

**No new app code.** Everything else is running existing npm scripts keyed on `--city daly-city`.

---

## Task 1: Correct the spec's boundary filename

**Files:** Modify `docs/superpowers/specs/2026-06-02-daly-city-onboarding-design.md`

- [ ] **Step 1: Fix the filename references**

The spec says `data/daly-city-ca-boundary.geojson`, but the discover + cardinal-districts scripts read `data/<slug>-boundary.geojson` and the slug is `daly-city`. Replace every occurrence of `daly-city-ca-boundary.geojson` with `daly-city-boundary.geojson` in that spec file (there are 2: §2 and the §3/non-goals references — grep to be sure: `grep -n "daly-city-ca-boundary" docs/superpowers/specs/2026-06-02-daly-city-onboarding-design.md`).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-02-daly-city-onboarding-design.md
git commit -m "docs(daly): correct boundary filename to slug-matched daly-city-boundary.geojson"
```

---

## Task 2: Add the Daly City city row to seed-cities.ts

**Files:** Modify `scripts/seed-cities.ts`

- [ ] **Step 1: Add `serviceBufferMeters` to the `SeedConfig` interface**

Find the `SeedConfig` interface and add an optional buffer field after `serviceLocalities`:

```ts
interface SeedConfig {
  /** Search + locality radius from the city centroid, in km. */
  radiusKm: number;
  /** Per-tile search radius in metres. 3000 is a sensible default. */
  cellMeters: number;
  /** Place must list one of these as its locality. Filters out neighboring towns. */
  serviceLocalities: string[];
  /** Boundary-mode only: metres of buffer around the municipal boundary that still
   *  counts as in-area (geocode slop). Discover falls back to its own default if omitted. */
  serviceBufferMeters?: number;
}
```

- [ ] **Step 2: Add the Daly City entry to the `CITIES` array**

Append this object to the `CITIES` array (after the last existing entry, `scottsdale`). The centroid is a placeholder that Task 4 finalizes from the sourced boundary — leave a clear marker:

```ts
  {
    // Daly City, CA — pilot for nested-routing-era onboarding. Combined Daly City + Colma
    // market (Colma is a tiny enclave; its restaurant/280 strip reads as "Daly City" to
    // locals). Boundary mode via data/daly-city-boundary.geojson drives discovery; the
    // locality gate drops SF / South SF / Brisbane / Pacifica. South SF is a separate
    // future city, NOT folded in here. See spec 2026-06-02-daly-city-onboarding-design.md.
    slug: "daly-city",
    name: "Daly City",
    state: "CA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    // CENTROID PLACEHOLDER — finalized in Task 4 from the sourced boundary's ST_Centroid.
    centerLat: 37.6879,
    centerLng: -122.4702,
    seedConfig: {
      radiusKm: 6, // fallback only; data/daly-city-boundary.geojson drives real tiling/gate
      cellMeters: 3000,
      serviceLocalities: ["Daly City", "Colma"],
      serviceBufferMeters: 500,
    },
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (no new errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-cities.ts
git commit -m "feat(seed): add Daly City (ca/daly-city) city row + Daly+Colma seed config"
```

---

## Task 3: Source the combined Daly City + Colma boundary GeoJSON

**Files:** Create `data/daly-city-boundary.geojson`

- [ ] **Step 1: Fetch each municipal polygon from OSM Nominatim**

Nominatim returns a polygon with `polygon_geojson=1`. Fetch Daly City and Colma separately (a descriptive User-Agent is required by Nominatim policy):

```bash
cd /Users/stevenmatthiesen/Personal/happyhourfriends/.worktrees/daly-city
UA="happyhourfriends-onboarding/1.0 (steven.matthiesen@gmail.com)"
curl -s -H "User-Agent: $UA" \
  "https://nominatim.openstreetmap.org/search?q=Daly+City%2C+California&polygon_geojson=1&format=json&limit=1&addressdetails=0" \
  -o /tmp/daly.json
sleep 1.5  # Nominatim rate limit: max ~1 req/sec
curl -s -H "User-Agent: $UA" \
  "https://nominatim.openstreetmap.org/search?q=Colma%2C+California&polygon_geojson=1&format=json&limit=1&addressdetails=0" \
  -o /tmp/colma.json
echo "Daly type:";  npx tsx -e "const d=require('/tmp/daly.json'); console.log(d[0]?.display_name, '|', d[0]?.geojson?.type)"
echo "Colma type:"; npx tsx -e "const d=require('/tmp/colma.json'); console.log(d[0]?.display_name, '|', d[0]?.geojson?.type)"
```
Expected: Daly City resolves to a `MultiPolygon`/`Polygon` whose `display_name` is "Daly City, San Mateo County, California, …"; Colma to "Colma, San Mateo County, California, …". If either resolves to a point/wrong place, STOP — adjust the query (e.g. append "San Mateo County") and re-fetch; do NOT proceed with a wrong polygon.

- [ ] **Step 2: Combine the two geometries into one FeatureCollection and write the file**

Write a one-off node/tsx snippet that builds a `FeatureCollection` with each city as a `Feature` (the discover script reads the file's geometries into a temp PostGIS table and unions them via its bbox + `ST_DWithin` gate, so two features is fine):

```bash
cd /Users/stevenmatthiesen/Personal/happyhourfriends/.worktrees/daly-city
npx tsx -e "
import { writeFileSync } from 'node:fs';
const daly = require('/tmp/daly.json')[0];
const colma = require('/tmp/colma.json')[0];
if (!daly?.geojson || !colma?.geojson) throw new Error('missing geometry');
const fc = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Daly City', source: 'osm-nominatim' }, geometry: daly.geojson },
    { type: 'Feature', properties: { name: 'Colma',     source: 'osm-nominatim' }, geometry: colma.geojson },
  ],
};
writeFileSync('data/daly-city-boundary.geojson', JSON.stringify(fc));
console.log('wrote data/daly-city-boundary.geojson with', fc.features.length, 'features');
"
```

- [ ] **Step 3: Write the validation test**

Create `scripts/test-daly-boundary.ts`:

```ts
/**
 * Validates the sourced Daly City + Colma boundary GeoJSON. Run: npx tsx scripts/test-daly-boundary.ts
 * Pure (no DB): parses, checks geometry types, and that the bbox sits in the Daly City /
 * Colma lat-lng window (catches a wrong-place geocode before we spend on discovery).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fc = JSON.parse(readFileSync("data/daly-city-boundary.geojson", "utf8"));
assert.equal(fc.type, "FeatureCollection");
assert.equal(fc.features.length, 2, "expected Daly City + Colma");

// Collect every coordinate to compute a bounding box.
let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
function walk(coords: unknown): void {
  if (typeof coords[0] === "number") {
    const [lng, lat] = coords as [number, number];
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    return;
  }
  for (const c of coords as unknown[]) walk(c);
}
for (const f of fc.features) {
  assert.ok(["Polygon", "MultiPolygon"].includes(f.geometry.type), `bad geom type ${f.geometry.type}`);
  walk(f.geometry.coordinates);
}

// Daly City + Colma sit roughly within 37.64–37.71 N, -122.51–-122.42 W. Assert the
// bbox is inside a slightly padded window — a San Francisco or wrong-state polygon fails.
assert.ok(minLat > 37.6 && maxLat < 37.73, `lat out of range: ${minLat}..${maxLat}`);
assert.ok(minLng > -122.55 && maxLng < -122.40, `lng out of range: ${minLng}..${maxLng}`);

console.log(`✓ boundary OK — bbox lat ${minLat.toFixed(4)}..${maxLat.toFixed(4)}, lng ${minLng.toFixed(4)}..${maxLng.toFixed(4)}`);
```

- [ ] **Step 4: Run the validation**

Run: `npx tsx scripts/test-daly-boundary.ts`
Expected: `✓ boundary OK — bbox lat 37.6… , lng -122.5…`. If it fails the range asserts, the wrong place was geocoded — re-source in Step 1.

- [ ] **Step 5: Add npm script + commit**

Add to `package.json` scripts: `"test:daly-boundary": "tsx scripts/test-daly-boundary.ts",`

```bash
git add data/daly-city-boundary.geojson scripts/test-daly-boundary.ts package.json
git commit -m "feat(daly): combined Daly City + Colma boundary GeoJSON (OSM) + validator"
```

---

## Task 4: Seed the city row + finalize centroid

**Files:** Modify `scripts/seed-cities.ts` (centroid only)

- [ ] **Step 1: Insert/update the Daly City row**

Run: `npm run seed:cities`
Expected: idempotent upsert; output lists `daly-city` among the cities. Verify it landed in `discovery` status (hidden under the release gate):
```bash
npx tsx scripts/_q.ts 2>/dev/null || npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`SELECT slug,state,status FROM cities WHERE slug='daly-city'\`; console.log(r); await sql.end();"
```
Expected: one row, `state: CA`, `status: discovery`.

- [ ] **Step 2: Compute the real centroid from the boundary and update the row + source**

Use PostGIS to centroid the union of the two boundary features, then update both the DB row and the source file so they match:
```bash
npx tsx -e "
import 'dotenv/config'; import { readFileSync } from 'node:fs'; import postgres from 'postgres';
const fc = JSON.parse(readFileSync('data/daly-city-boundary.geojson','utf8'));
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const geoms = fc.features.map((f:any)=>JSON.stringify(f.geometry));
const [{ lat, lng }] = await sql\`
  SELECT ST_Y(c) AS lat, ST_X(c) AS lng FROM (
    SELECT ST_Centroid(ST_Collect(ST_GeomFromGeoJSON(g))) AS c
    FROM unnest(\${geoms}::text[]) AS g
  ) t\`;
console.log('centroid', lat, lng);
await sql\`UPDATE cities SET center_lat=\${lat}, center_lng=\${lng} WHERE slug='daly-city'\`;
await sql.end();
"
```
Then update the `centerLat`/`centerLng` placeholder in `scripts/seed-cities.ts` to the printed values (so a future `seed:cities` re-run keeps them), replacing the `CENTROID PLACEHOLDER` comment with `// centroid: ST_Centroid of data/daly-city-boundary.geojson`.

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck` (clean), then:
```bash
git add scripts/seed-cities.ts
git commit -m "feat(daly): finalize Daly City centroid from sourced boundary"
```

---

## Task 5: Discover candidates — **PAID (Google Places)**

**Files:** none (runs the pipeline)

- [ ] **Step 1: PAUSE for spend authorization**

This step calls the Google Places API and costs money. Confirm with the operator and ensure a Cloud Console quota/billing cap is set before running. Do not proceed without explicit go-ahead.

- [ ] **Step 2: Run discovery in boundary mode**

Run: `npm run seed:discover -- --city daly-city`
Expected: logs `gate = within 500m of data/daly-city-boundary.geojson`; inserts N `seed_candidates` rows. Confirm the gate used the boundary file (not the radius fallback) and that the count is plausible for a small city (tens, not hundreds).

- [ ] **Step 3: Sanity-check candidates are in-area**

```bash
npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`SELECT count(*) AS n FROM seed_candidates sc JOIN cities c ON c.id=sc.city_id WHERE c.slug='daly-city'\`; console.log('daly candidates:', r); await sql.end();"
```
Spot-check a few candidate names/addresses are actually Daly City / Colma. Record the spend via `npm run ai:spend` baseline (Places isn't in the AI ledger, so note the Console figure).

---

## Task 6: Enrich candidates — **PAID (Anthropic web_fetch)**

**Files:** none (runs the pipeline)

- [ ] **Step 1: PAUSE for spend authorization**

`seed:enrich` makes paid Anthropic web_fetch calls per candidate (~the metered step; Tacoma was ~$1.50 / 25 candidates). Confirm spend + cap before running. Start with a small `--limit` to gauge yield/cost.

- [ ] **Step 2: Enrich a first batch**

Run: `npm run seed:enrich -- --city daly-city --limit 10`
Expected: per-candidate verify gate (serves alcohol + has website) → Haiku extractor → venues created (with HH rows where the site publishes times; otherwise help-wanted stubs). Watch the log for confirmed-vs-stub counts.

- [ ] **Step 3: Check spend, then continue in batches**

Run `npm run ai:spend` after the batch. If cost/venue is acceptable, continue enriching the rest in `--limit` batches until `0 unprocessed Tacoma… ` — i.e. no unprocessed `daly-city` candidates remain:
```bash
npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`SELECT count(*) FILTER (WHERE status='pending') AS pending, count(*) AS total FROM seed_candidates sc JOIN cities c ON c.id=sc.city_id WHERE c.slug='daly-city'\`; console.log(r); await sql.end();"
```
(Adjust the status filter to whatever `seed_candidates` uses for unprocessed — inspect one row's columns first if unsure.)

---

## Task 7: Neighborhoods

**Files:** none (runs existing scripts; needs OSM fetch — main thread)

- [ ] **Step 1: Import OSM neighborhoods for Daly City**

Run: `npm run import:osm-neighbourhoods -- --city daly-city`
Expected: inserts `neighborhoods` polygons (Westlake, Serramonte, Broadmoor, Crocker, Original Daly City, Colma, …) where OSM has them. Note: this fetches from OSM (Overpass/Nominatim) — main thread only.

- [ ] **Step 2: Tiers + cardinal districts + assignment**

```bash
npm run backfill:neighborhood-tiers -- --city daly-city
npm run generate:cardinal-districts -- --city daly-city
npm run backfill:neighborhoods -- --city daly-city
```
Expected: cardinal districts clip from `data/daly-city-boundary.geojson`; assignment fills venues. (If a script doesn't take `--city`, check its `--help`/source for the right flag — match the patterns in CLAUDE.md's neighborhood runbook.)

- [ ] **Step 3: Coverage report**

Run: `npm run analyze:neighborhood-coverage -- --city daly-city`
Expected: prints assigned % (target ≥95%) and the recognizable-named %. Record both. A low recognizable % is a data-availability outcome, not a blocker.

---

## Task 8: Backfills, scoping, realness review

**Files:** none

- [ ] **Step 1: Timezone + venue-type backfills**

```bash
npm run backfill:timezones -- --city daly-city
npm run backfill:venue-types -- --city daly-city
```
Expected: venues get `America/Los_Angeles` tz + deterministic Google-type-mapped `type`.

- [ ] **Step 2: Scope prune**

Run: `npm run scope:venues -- --city daly-city`
Expected: prunes any venue outside the boundary + buffer (mailing-address bleed). Review the prune list before it deletes — confirm nothing legitimate (a real Daly City / Colma venue) is dropped.

- [ ] **Step 3: Realness review**

Run: `npm run review:suspect -- --city daly-city` (or the script's actual flag).
Expected: lists suspect HH rows (hidden via the realness gate, `active=false`) for eyeballing. Spot-check 5–10 venues against their real sites. Optionally recover PDF/JS-walled menus with `npm run reextract:stubs -- --venue <id|name> --url <pdf>` (**PAID per call** — confirm first).

---

## Task 9: Go live + verify

**Files:** none

- [ ] **Step 1: Final pre-flight counts**

```bash
npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`SELECT count(*) AS venues, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM happy_hours h WHERE h.venue_id=v.id AND h.active)) AS with_hh, count(*) FILTER (WHERE v.neighborhood_id IS NULL) AS no_nbhd FROM venues v JOIN cities c ON c.id=v.city_id WHERE c.slug='daly-city' AND v.deleted_at IS NULL\`; console.log(r); await sql.end();"
```
Expected: a sensible venue count, most with a neighborhood, a modest stub rate (acceptable for Daly City per the spec risk note).

- [ ] **Step 2: Flip to live**

```bash
npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const sql=postgres(process.env.DATABASE_URL,{max:1}); const r=await sql\`UPDATE cities SET status='live', launched_at=COALESCE(launched_at, now()) WHERE slug='daly-city' RETURNING slug,status\`; console.log(r); await sql.end();"
```
Expected: `daly-city | live`.

- [ ] **Step 3: Build + runtime smoke test**

```bash
rm -rf .next && npm run build
PORT=3009 npm run start >/tmp/daly-start.log 2>&1 &
# wait for ready, then:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3009/ca/daly-city          # expect 200
curl -s http://localhost:3009/ca/daly-city | grep -o "Daly City happy hours" | head -1 # expect match
curl -s http://localhost:3009/sitemap.xml | grep -c "/ca/daly-city"                    # expect >=1
# stop the server: lsof -ti tcp:3009 | xargs kill
```
Expected: `/ca/daly-city` renders 200 with the Daly City listing; it appears in the landing city picker and sitemap.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin daly-city-onboarding
gh pr create --base main --head daly-city-onboarding \
  --title "Onboard Daly City (/ca/daly-city)" \
  --body "Implements docs/superpowers/specs/2026-06-02-daly-city-onboarding-design.md. Adds the Daly City city row (Daly City + Colma gate), the combined boundary GeoJSON, and runs the discover→enrich→neighborhoods→review funnel. Pilot for nested-routing-era onboarding.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Note: the venue/HH **data** lives in the DB, not git — landing it on prod uses `npm run push:data` (see `[[project_production_deploy]]`), separate from this code PR. The PR carries the city row + boundary file + validator.

---

## Self-Review notes

- **Spec coverage:** identity/scope → Tasks 2,4; boundary → Task 3; discovery gate → Task 5; enrich → Task 6; neighborhoods → Task 7; backfills/scope/review → Task 8; success criteria + go-live → Task 9. Spec filename fix → Task 1. All covered.
- **Free vs paid split:** Tasks 1–4, 7–9 are free/reversible and run autonomously; Tasks 5–6 (and the optional reextract in Task 8) are PAID and gated on operator go-ahead.
- **Naming consistency:** boundary file is `data/daly-city-boundary.geojson` (slug-matched) everywhere; slug `daly-city`, state `CA`, URL `/ca/daly-city` used consistently.
- **Known soft spots flagged for the executor:** the exact `seed_candidates` "unprocessed" status column and the precise `--city`/flag names on a couple of scripts (`review:suspect`, backfills) should be confirmed against each script's source/`--help` at run time rather than assumed — noted inline where they occur.
