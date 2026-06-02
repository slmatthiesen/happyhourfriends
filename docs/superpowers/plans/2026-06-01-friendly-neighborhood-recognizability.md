# Friendly Neighborhoods (Recognizability-Ranked Rollup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make neighborhood listings show names locals actually use, by tagging every neighborhood with a tier (fine/coarse) and a non-hallucinated recognizability score, then ranking venue→neighborhood assignment to prefer recognizable names and roll up to a gap-free coarse layer otherwise.

**Architecture:** Two new columns on `neighborhoods` (`tier`, `recognizability`) derived at import from OSM `place`/`wikidata`/`wikipedia` tags. A pure scoring helper feeds both the OSM importer and a one-time backfill. A new gap-free coarse layer comes from existing OSM coarse tier + city-GIS admin layers (Census CDP, urban villages) + a generated cardinal-district fallback clipped from the city boundary. The assignment SQL is rewritten to prefer recognizable-fine → coarse → snap. UI needs no change (it already surfaces only assigned neighborhoods).

**Tech Stack:** TypeScript (strict), Drizzle ORM 0.45 + drizzle-kit (versioned migrations), postgres.js, PostGIS, `osmtogeojson`, `tsx`. Tests are standalone `scripts/test-*.ts` using `node:assert/strict` (no vitest/jest in this repo).

---

## Conventions for this plan (read once)

- **Run from repo root** `/Users/stevenmatthiesen/Personal/happyhourfriends`. Docker Postgres must be up (`docker compose up -d`) and `DATABASE_URL` set in `.env`.
- **"Test" = a `scripts/test-*.ts` file** that imports the unit under test, asserts with `node:assert/strict`, prints `✓` per check, and exits non-zero on failure (process exits non-zero automatically when an assert throws). Register each as an npm script `test:<name>`. Mirror `scripts/test-resolve-bounds.ts` exactly for style.
- **`tsx` resolves the `@/` alias** at runtime, so scripts may `import { x } from "@/lib/..."`.
- **Verification gates after each task:** `npm run typecheck` and `npm run lint` must stay clean (two pre-existing Phase 0 lint warnings in `db/schema/moderation.ts` + `scripts/import-neighborhoods.ts` are allowed — nothing new).
- **Commit after every task.** End commit bodies with the repo's `Co-Authored-By` trailer.
- **Day-of-week / non-negotiables** (PRD §13) are untouched by this work.

---

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `db/schema/core.ts` | Add `tier` + `recognizability` columns to `neighborhoods` | Modify |
| `db/migrations/0014_*.sql` | Generated DDL for the two columns | Create (via `db:generate`) |
| `lib/geo/recognizability.ts` | Pure helpers: `tierForPlace`, `recognizabilityScore`, `RECOGNIZABLE_BAR` | Create |
| `scripts/test-recognizability.ts` | Unit checks for the scoring helpers | Create |
| `lib/geo/cardinalDistricts.ts` | Pure helper: `cardinalRects(bbox, aliases)` → 5 labeled GeoJSON rectangles | Create |
| `scripts/test-cardinal-districts.ts` | Unit checks: gap-free tiling, labels, alias application | Create |
| `scripts/backfill-neighborhood-tiers.ts` | One-time, idempotent: set tier/recognizability on existing rows + demote Tucson NA layer | Create |
| `scripts/import-osm-neighborhoods.ts` | Capture `place`/`wikidata`/`wikipedia` into tier + recognizability at insert | Modify |
| `scripts/generate-cardinal-districts.ts` | Generate Downtown+Central+N/E/S/W coarse polygons from a city boundary, gap-free | Create |
| `lib/geo/assignNeighborhoods.ts` | Rewrite ranking: recognizable-fine → coarse → snap | Modify |
| `scripts/test-neighborhood-assignment.ts` | Integration test against live DB in a rolled-back txn | Create |
| `scripts/analyze-neighborhood-coverage.ts` | Add "% on recognizable named neighborhood" metric | Modify |
| `package.json` | Register new npm scripts | Modify |
| `CLAUDE.md` | Document the pipeline | Modify |

---

## Task 1: Schema columns + migration

**Files:**
- Modify: `db/schema/core.ts` (the `neighborhoods` table, ~lines 71–99)
- Create: `db/migrations/0014_*.sql` (via `db:generate`)

- [ ] **Step 1: Add the two columns to the Drizzle schema**

In `db/schema/core.ts`, inside the `neighborhoods` table definition, add these two columns immediately after the `isFallback` column (keep the existing `inScope` and `...timestamps` after them):

```ts
    // Two-tier model for friendly listings. `tier` distinguishes a fine named
    // neighborhood (Arcadia, Sam Hughes) from a coarse rollup district (urban village,
    // Census place, or generated cardinal zone). `recognizability` is a non-hallucinated
    // 0–2 score derived at import from OSM signals (wikidata/wikipedia presence, place
    // tier) — high means "a name locals actually say". Assignment prefers a recognizable
    // fine neighborhood, else rolls a venue up to its coarse district. See
    // lib/geo/recognizability.ts and docs/superpowers/specs/2026-06-01-friendly-neighborhood-recognizability-design.md.
    tier: text("tier", { enum: ["fine", "coarse"] })
      .notNull()
      .default("fine"),
    recognizability: smallint("recognizability").notNull().default(0),
```

- [ ] **Step 2: Ensure `smallint` is imported**

At the top of `db/schema/core.ts`, confirm `smallint` is in the `drizzle-orm/pg-core` import list. If absent, add it. Check first:

Run: `grep -n "smallint" db/schema/core.ts`
If the import line (e.g. `import { pgTable, uuid, text, boolean, ... } from "drizzle-orm/pg-core";`) lacks `smallint`, add it to that list.

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file `db/migrations/0014_<name>.sql` containing two `ALTER TABLE "neighborhoods" ADD COLUMN ...` statements (tier text not null default 'fine', recognizability smallint not null default 0). No other tables touched.

- [ ] **Step 4: Inspect the generated SQL**

Run: `ls db/migrations/ | sort | tail -2 && cat db/migrations/0014_*.sql`
Expected: only the two ADD COLUMN statements for `neighborhoods`. If drizzle tries to alter anything else, stop and reconcile schema drift before continuing.

- [ ] **Step 5: Apply the migration**

Run: `npm run db:migrate`
Expected: applies `0014` cleanly. Then verify:
Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add db/schema/core.ts db/migrations/
git commit -m "$(cat <<'EOF'
feat(db): neighborhoods.tier + recognizability columns

Two-tier model (fine/coarse) + non-hallucinated recognizability score
for friendlier neighborhood listings. Migration 0014.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Recognizability scoring helpers (pure, TDD)

**Files:**
- Create: `lib/geo/recognizability.ts`
- Create: `scripts/test-recognizability.ts`
- Modify: `package.json` (add `test:recognizability`)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-recognizability.ts`:

```ts
/**
 * Unit checks for the neighborhood recognizability helpers.
 * Run: npx tsx scripts/test-recognizability.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  tierForPlace,
  recognizabilityScore,
  isRecognizableFine,
  RECOGNIZABLE_BAR,
} from "@/lib/geo/recognizability";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// tierForPlace: coarse OSM place types → coarse, fine ones → fine, unknown → fine.
check("suburb is coarse", () => assert.equal(tierForPlace("suburb"), "coarse"));
check("city_district is coarse", () =>
  assert.equal(tierForPlace("city_district"), "coarse"));
check("borough is coarse", () => assert.equal(tierForPlace("borough"), "coarse"));
check("neighbourhood is fine", () =>
  assert.equal(tierForPlace("neighbourhood"), "fine"));
check("quarter is fine", () => assert.equal(tierForPlace("quarter"), "fine"));
check("unknown/empty defaults to fine", () => {
  assert.equal(tierForPlace(undefined), "fine");
  assert.equal(tierForPlace(""), "fine");
});

// recognizabilityScore: wiki tag → 2, bare suburb → 1, else 0.
check("wikidata present → 2", () =>
  assert.equal(recognizabilityScore({ wikidata: "Q123", place: "neighbourhood" }), 2));
check("wikipedia present → 2", () =>
  assert.equal(recognizabilityScore({ wikipedia: "en:Sam Hughes", place: "quarter" }), 2));
check("bare suburb (no wiki) → 1", () =>
  assert.equal(recognizabilityScore({ place: "suburb" }), 1));
check("plain neighbourhood, no wiki → 0", () =>
  assert.equal(recognizabilityScore({ place: "neighbourhood" }), 0));
check("empty tags → 0", () => assert.equal(recognizabilityScore({}), 0));

// isRecognizableFine: fine + score ≥ bar.
check("fine + score 2 is recognizable", () =>
  assert.equal(isRecognizableFine("fine", 2), true));
check("fine + score 0 is NOT recognizable", () =>
  assert.equal(isRecognizableFine("fine", 0), false));
check("coarse is never 'recognizable fine' regardless of score", () =>
  assert.equal(isRecognizableFine("coarse", 2), false));
check("RECOGNIZABLE_BAR is 1", () => assert.equal(RECOGNIZABLE_BAR, 1));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Register the npm script**

In `package.json` `scripts`, add (next to the other `test:*` entries):

```json
    "test:recognizability": "tsx scripts/test-recognizability.ts",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:recognizability`
Expected: FAIL — `Cannot find module '@/lib/geo/recognizability'` (file not created yet).

- [ ] **Step 4: Write the implementation**

Create `lib/geo/recognizability.ts`:

```ts
/**
 * Neighborhood recognizability + tier helpers.
 *
 * The product problem: official neighborhood layers are full of names locals don't say
 * (Tucson's "Limberlost" NA). OSM carries a free, globally-consistent, NON-hallucinated
 * signal for fame — famous neighborhoods (Arcadia, Sam Hughes) carry `wikidata`/`wikipedia`
 * tags; obscure registrations don't. We turn that plus the OSM `place` tier into:
 *   - tier: "fine" (a named neighborhood) vs "coarse" (a broad rollup district)
 *   - recognizability: 0..2, higher = more likely a name people actually use
 * Assignment (lib/geo/assignNeighborhoods.ts) prefers a recognizable FINE neighborhood,
 * else rolls a venue up to its COARSE district. Pure functions — unit-tested, no I/O.
 */

export type NeighborhoodTier = "fine" | "coarse";

/** OSM `place` values that denote a broad district rather than a single neighborhood. */
const COARSE_PLACES = new Set(["suburb", "city_district", "borough"]);

/** Map an OSM `place` tag to our tier. Unknown/missing defaults to "fine". */
export function tierForPlace(place: string | null | undefined): NeighborhoodTier {
  return place && COARSE_PLACES.has(place) ? "coarse" : "fine";
}

/** OSM tags relevant to scoring (subset of a feature's properties). */
export interface RecognizabilityTags {
  place?: string | null;
  wikidata?: string | null;
  wikipedia?: string | null;
}

/**
 * 0..2 recognizability:
 *   2 — has a wikidata or wikipedia tag (a documented, named place; the fame proxy)
 *   1 — a bare `place=suburb` (a genuine district even without a wiki link)
 *   0 — anything else (plain neighbourhood/quarter with no notability signal)
 */
export function recognizabilityScore(tags: RecognizabilityTags): number {
  if (tags.wikidata || tags.wikipedia) return 2;
  if (tags.place === "suburb") return 1;
  return 0;
}

/** A fine name may surface only at/above this recognizability score. Tunable. */
export const RECOGNIZABLE_BAR = 1;

/** True when a neighborhood is a fine name recognizable enough to surface on its own. */
export function isRecognizableFine(tier: NeighborhoodTier, recognizability: number): boolean {
  return tier === "fine" && recognizability >= RECOGNIZABLE_BAR;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:recognizability`
Expected: PASS — all checks print `✓`, ends with "N checks passed." Exit code 0.

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean (no new issues).

- [ ] **Step 7: Commit**

```bash
git add lib/geo/recognizability.ts scripts/test-recognizability.ts package.json
git commit -m "$(cat <<'EOF'
feat(geo): recognizability + tier scoring helpers (pure, tested)

OSM place tier → fine/coarse; wikidata/wikipedia → 0..2 recognizability.
RECOGNIZABLE_BAR gates which fine names may surface.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backfill tier/recognizability on existing rows + demote Tucson NA layer

Existing neighborhoods predate the columns (all default `tier='fine', recognizability=0`).
Set them correctly by `source`, and demote Tucson's 154 obscure NA polygons so recognizable
names win. Idempotent and re-runnable.

**Source → (tier, recognizability, is_fallback) mapping** (confirmed against the live DB):

| `source` (LIKE) | tier | recognizability | is_fallback | rationale |
|---|---|---|---|---|
| `OpenStreetMap%` | fine | 2 | unchanged | passed the importer's wikidata/suburb notability filter already |
| `%Urban Villages%` (Phoenix) | coarse | 1 | false | the broad rollup blobs (Camelback East) |
| `%Council Districts%` (Tacoma) | coarse | 1 | false | broad rollup |
| `%Census%` / `%CDP%` (Tucson) | coarse | 2 | false | recognizable broad areas (Catalina Foothills, South Tucson) |
| `%Zillow%` | coarse | 1 | unchanged (stays fallback) | gap-fill broad areas |
| `%Neighborhood Associations%` (Tucson) | fine | 0 | **true** (demote) | obscure administrative names — shadowed |

**Files:**
- Create: `scripts/backfill-neighborhood-tiers.ts`
- Modify: `package.json` (add `backfill:neighborhood-tiers`)

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-neighborhood-tiers.ts`:

```ts
/**
 * One-time, idempotent backfill of neighborhoods.tier / recognizability for rows that
 * predate those columns, keyed on the existing `source` text. Also DEMOTES Tucson's
 * obscure Neighborhood-Association layer to is_fallback so recognizable names win in
 * assignment. Safe to re-run: every UPDATE is deterministic from `source`.
 *
 *   npm run backfill:neighborhood-tiers
 *
 * Does NOT re-run assignment — run `npm run import:osm-neighborhoods` /
 * `npm run generate:cardinal-districts` (which call assignNeighborhoods) afterwards, or
 * assignment is exercised by Task 9.
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  try {
    const osm = await sql`
      UPDATE neighborhoods SET tier='fine', recognizability=2
      WHERE source LIKE 'OpenStreetMap%'
      RETURNING id`;
    const villages = await sql`
      UPDATE neighborhoods SET tier='coarse', recognizability=1, is_fallback=false
      WHERE source LIKE '%Urban Villages%' OR source LIKE '%Council Districts%'
      RETURNING id`;
    const census = await sql`
      UPDATE neighborhoods SET tier='coarse', recognizability=2, is_fallback=false
      WHERE source LIKE '%Census%' OR source LIKE '%CDP%'
      RETURNING id`;
    const zillow = await sql`
      UPDATE neighborhoods SET tier='coarse', recognizability=1
      WHERE source LIKE '%Zillow%'
      RETURNING id`;
    const demoted = await sql`
      UPDATE neighborhoods SET tier='fine', recognizability=0, is_fallback=true
      WHERE source LIKE '%Neighborhood Associations%'
      RETURNING id`;
    console.log(
      `Backfill: OSM=${osm.length} villages/districts=${villages.length} ` +
        `census=${census.length} zillow=${zillow.length} demoted-NA=${demoted.length}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Register the npm script**

In `package.json` `scripts`, add (near the other `backfill:*`):

```json
    "backfill:neighborhood-tiers": "tsx scripts/backfill-neighborhood-tiers.ts",
```

- [ ] **Step 3: Run the backfill**

Run: `npm run backfill:neighborhood-tiers`
Expected (matches the live counts): `OSM=9 villages/districts=23 census=16 zillow=42 demoted-NA=154` (approx — exact numbers may vary slightly; the demoted-NA count should be ~154).

- [ ] **Step 4: Verify the result**

Run:
```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const p=(await import("postgres")).default;const sql=p(process.env.DATABASE_URL,{max:1});console.table(await sql`SELECT c.slug, nb.tier, count(*) n, min(nb.recognizability) rmin, max(nb.recognizability) rmax, count(*) FILTER (WHERE nb.is_fallback) fb FROM neighborhoods nb JOIN cities c ON c.id=nb.city_id GROUP BY c.slug, nb.tier ORDER BY c.slug, nb.tier`);await sql.end();})'
```
Expected: Tucson has a `fine` group with all `is_fallback=true` (the demoted NAs) plus a `fine` group from OSM (recognizability 2), and a `coarse` group (Census, recognizability 2). Re-running Step 3 a second time should report the same counts (idempotent).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-neighborhood-tiers.ts package.json
git commit -m "$(cat <<'EOF'
feat(geo): backfill neighborhood tier/recognizability + demote Tucson NA layer

Idempotent, keyed on source. Demotes 154 obscure Tucson Neighborhood
Associations to is_fallback so recognizable names win.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Capture tier + recognizability in the OSM importer

The importer currently uses `wikidata`/`wikipedia` only as a keep/drop filter and discards
`place`. Capture both into the new columns at insert.

**Files:**
- Modify: `scripts/import-osm-neighborhoods.ts`

- [ ] **Step 1: Import the helpers**

At the top of `scripts/import-osm-neighborhoods.ts`, add to the imports (below the existing `assignNeighborhoods` import):

```ts
import {
  tierForPlace,
  recognizabilityScore,
} from "@/lib/geo/recognizability";
```

- [ ] **Step 2: Compute tier + score per feature and pass into the INSERT**

In the `for (const f of polys)` loop, after the existing `const geomJson = JSON.stringify(f.geometry);` line, add:

```ts
        const props = f.properties as Record<string, unknown>;
        const tier = tierForPlace(props.place as string | undefined);
        const recognizability = recognizabilityScore({
          place: props.place as string | undefined,
          wikidata: props.wikidata as string | undefined,
          wikipedia: props.wikipedia as string | undefined,
        });
```

Then change the INSERT to include the two new columns. Replace the existing INSERT statement with:

```ts
        await sql`
          INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability)
          VALUES (
            ${city.id}, ${name}, ${slug},
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)), 3)),
            'OpenStreetMap (ODbL)', 'https://www.openstreetmap.org/', ${args.fallback}, ${tier}, ${recognizability}
          )
          ON CONFLICT (city_id, slug) DO NOTHING
        `;
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean (no new issues).

- [ ] **Step 4: Commit**

```bash
git add scripts/import-osm-neighborhoods.ts
git commit -m "$(cat <<'EOF'
feat(geo): capture OSM place tier + wikidata recognizability on import

Records tier (fine/coarse) and 0..2 recognizability per imported OSM
neighborhood instead of discarding the signals.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Cardinal-district geometry helper (pure, TDD)

A deterministic, gap-free partition of a city bbox into 5 labeled rectangles — North
(top third, full width), South (bottom third), West (middle-left), East (middle-right),
Central (middle cell). Downtown is added later by the generator as an anchor buffer that
overlaps Central. Pure function over a bbox; geometry intersection with the real boundary
happens in SQL in the next task.

**Files:**
- Create: `lib/geo/cardinalDistricts.ts`
- Create: `scripts/test-cardinal-districts.ts`
- Modify: `package.json` (add `test:cardinal-districts`)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-cardinal-districts.ts`:

```ts
/**
 * Unit checks for cardinalRects. Run: npx tsx scripts/test-cardinal-districts.ts
 * — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import { cardinalRects, type Bbox } from "@/lib/geo/cardinalDistricts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// A 3x3 unit bbox: lng 0..3, lat 0..3 (thirds fall on integers — easy to reason about).
const bbox: Bbox = { west: 0, south: 0, east: 3, north: 3 };

check("produces exactly 5 named rects", () => {
  const rects = cardinalRects(bbox);
  assert.equal(rects.length, 5);
  assert.deepEqual(
    rects.map((r) => r.name).sort(),
    ["Central", "East", "North", "South", "West"],
  );
});

check("North spans full width, top third", () => {
  const n = cardinalRects(bbox).find((r) => r.name === "North")!;
  // ring is [[w,s],[e,s],[e,n],[w,n],[w,s]] of the rect
  const ring = n.geometry.coordinates[0];
  const lngs = ring.map((c) => c[0]);
  const lats = ring.map((c) => c[1]);
  assert.equal(Math.min(...lngs), 0);
  assert.equal(Math.max(...lngs), 3);
  assert.equal(Math.min(...lats), 2); // top third: lat 2..3
  assert.equal(Math.max(...lats), 3);
});

check("Central is the middle cell", () => {
  const c = cardinalRects(bbox).find((r) => r.name === "Central")!;
  const ring = c.geometry.coordinates[0];
  const lngs = ring.map((co) => co[0]);
  const lats = ring.map((co) => co[1]);
  assert.equal(Math.min(...lngs), 1);
  assert.equal(Math.max(...lngs), 2);
  assert.equal(Math.min(...lats), 1);
  assert.equal(Math.max(...lats), 2);
});

check("West is middle-row left cell, East is middle-row right cell", () => {
  const rects = cardinalRects(bbox);
  const w = rects.find((r) => r.name === "West")!.geometry.coordinates[0];
  const e = rects.find((r) => r.name === "East")!.geometry.coordinates[0];
  assert.equal(Math.max(...w.map((c) => c[0])), 1); // west cell: lng 0..1
  assert.equal(Math.min(...e.map((c) => c[0])), 2); // east cell: lng 2..3
});

check("alias map renames zones", () => {
  const rects = cardinalRects(bbox, { Central: "Midtown", North: "Foothills" });
  const names = rects.map((r) => r.name).sort();
  assert.deepEqual(names, ["East", "Foothills", "Midtown", "South", "West"]);
});

check("each rect geometry is a closed GeoJSON Polygon", () => {
  for (const r of cardinalRects(bbox)) {
    assert.equal(r.geometry.type, "Polygon");
    const ring = r.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]); // closed
    assert.equal(ring.length, 5);
  }
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Register the npm script**

In `package.json` `scripts`, add:

```json
    "test:cardinal-districts": "tsx scripts/test-cardinal-districts.ts",
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:cardinal-districts`
Expected: FAIL — `Cannot find module '@/lib/geo/cardinalDistricts'`.

- [ ] **Step 4: Write the implementation**

Create `lib/geo/cardinalDistricts.ts`:

```ts
/**
 * Generated cardinal-district geometry. Produces a deterministic, GAP-FREE partition of a
 * city's bounding box into 5 broad rectangles — North/South span the full width (top/bottom
 * third), West/East are the middle row's left/right cells, Central is the middle cell. The
 * generator (scripts/generate-cardinal-districts.ts) intersects each with the real city
 * boundary and adds a Downtown buffer on top, so the bland generic names only ever appear
 * where no recognizable named or admin coarse area covers a venue.
 *
 * Generic labels by default; an optional per-city alias map renames individual zones
 * (e.g. Tucson Central → Midtown). Pure function — unit-tested, no I/O.
 */

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type CardinalZone = "North" | "South" | "West" | "East" | "Central";

/** Optional per-city override: generic zone → display name. */
export type CardinalAliases = Partial<Record<CardinalZone, string>>;

export interface CardinalRect {
  /** Display name (aliased if an override was supplied). */
  name: string;
  /** The generic zone this rect represents (stable; used for slugs/aliasing). */
  zone: CardinalZone;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
}

function rect(
  west: number,
  south: number,
  east: number,
  north: number,
): { type: "Polygon"; coordinates: [number, number][][] } {
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/**
 * Partition `bbox` into the 5 cardinal rectangles. Thirds are computed linearly in lng/lat.
 * North = top third full width, South = bottom third full width, West/East = middle row
 * left/right cells, Central = middle cell.
 */
export function cardinalRects(bbox: Bbox, aliases: CardinalAliases = {}): CardinalRect[] {
  const { west, south, east, north } = bbox;
  const dx = (east - west) / 3;
  const dy = (north - south) / 3;
  const x1 = west + dx;
  const x2 = west + 2 * dx;
  const y1 = south + dy;
  const y2 = south + 2 * dy;

  const zones: { zone: CardinalZone; geom: ReturnType<typeof rect> }[] = [
    { zone: "South", geom: rect(west, south, east, y1) },
    { zone: "West", geom: rect(west, y1, x1, y2) },
    { zone: "Central", geom: rect(x1, y1, x2, y2) },
    { zone: "East", geom: rect(x2, y1, east, y2) },
    { zone: "North", geom: rect(west, y2, east, north) },
  ];

  return zones.map(({ zone, geom }) => ({
    zone,
    name: aliases[zone] ?? zone,
    geometry: geom,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:cardinal-districts`
Expected: PASS — all `✓`, ends "N checks passed."

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/geo/cardinalDistricts.ts scripts/test-cardinal-districts.ts package.json
git commit -m "$(cat <<'EOF'
feat(geo): cardinalRects — gap-free bbox partition for generated districts

5 labeled rectangles (N/S full-width, W/E/Central middle row) with an
optional per-city alias map. Pure, tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `generate:cardinal-districts` script

Intersect the 5 cardinal rectangles with a city's real boundary polygon, add a Downtown
buffer, and insert as `tier='coarse'` neighborhoods (`source='Generated cardinal district'`).
Idempotent (skips slugs already present). Reads an optional `data/<city>-cardinal-aliases.json`.

**Files:**
- Create: `scripts/generate-cardinal-districts.ts`
- Modify: `package.json` (add `generate:cardinal-districts`)
- (Optional input) `data/tucson-cardinal-aliases.json`

- [ ] **Step 1: Write the script**

Create `scripts/generate-cardinal-districts.ts`:

```ts
/**
 * Generate a gap-free coarse "cardinal district" layer for a city, clipped to its real
 * boundary. The friendly-rollup floor: only surfaces where no recognizable named or admin
 * coarse area covers a venue.
 *
 *   npm run generate:cardinal-districts -- --city tucson
 *   npm run generate:cardinal-districts -- --city tucson --boundary ./data/tucson-boundary.geojson
 *   npm run generate:cardinal-districts -- --city tucson --downtown 32.2226,-110.9747
 *
 * Boundary source order: --boundary file → data/<city>-boundary.geojson. The bbox of that
 * boundary feeds cardinalRects(); each rectangle is intersected with the boundary so zones
 * never spill outside the city. Downtown = a 1.5km buffer around the anchor (--downtown
 * "lat,lng", else the boundary centroid), clipped to the boundary, layered on top. Zone
 * names can be overridden via data/<city>-cardinal-aliases.json
 * (e.g. {"Central":"Midtown","North":"Foothills"}). Idempotent: ON CONFLICT (city_id, slug)
 * DO NOTHING. Re-runs assignment at the end.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";
import {
  cardinalRects,
  type Bbox,
  type CardinalAliases,
} from "@/lib/geo/cardinalDistricts";

const DOWNTOWN_RADIUS_M = 1500;

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const city = getArg("--city");
  if (!city) throw new Error("Required: --city <slug> [--boundary file] [--downtown lat,lng]");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const boundaryPath = getArg("--boundary") ?? `./data/${city}-boundary.geojson`;
  if (!existsSync(boundaryPath)) {
    throw new Error(`No boundary file at ${boundaryPath}. Pass --boundary <path>.`);
  }
  const boundaryGeoJSON = readFileSync(boundaryPath, "utf8");

  const aliasPath = `./data/${city}-cardinal-aliases.json`;
  const aliases: CardinalAliases = existsSync(aliasPath)
    ? (JSON.parse(readFileSync(aliasPath, "utf8")) as CardinalAliases)
    : {};

  const sql = postgres(url, { max: 1 });
  try {
    const [c] = await sql<{ id: string }[]>`SELECT id FROM cities WHERE slug = ${city}`;
    if (!c) throw new Error(`City '${city}' not found.`);

    // Load the boundary as a single (multi)polygon geometry in Postgres.
    const [b] = await sql<{ bbox: string }[]>`
      WITH g AS (
        SELECT ST_SetSRID(
          ST_Collect(ST_MakeValid((ST_Dump(ST_GeomFromGeoJSON(j.geom))).geom)), 4326
        ) AS geom
        FROM (
          SELECT (feat->'geometry')::text AS geom
          FROM jsonb_array_elements(
            CASE WHEN (${boundaryGeoJSON}::jsonb)->>'type' = 'FeatureCollection'
                 THEN (${boundaryGeoJSON}::jsonb)->'features'
                 ELSE jsonb_build_array(${boundaryGeoJSON}::jsonb) END
          ) AS feat
        ) j
      )
      SELECT ST_XMin(geom)::text||','||ST_YMin(geom)::text||','||
             ST_XMax(geom)::text||','||ST_YMax(geom)::text AS bbox
      FROM g
    `;
    const [w, s, e, n] = b.bbox.split(",").map(Number);
    const bbox: Bbox = { west: w, south: s, east: e, north: n };

    // Downtown anchor: --downtown "lat,lng" or the boundary centroid.
    const dt = getArg("--downtown");
    let anchorLat: number;
    let anchorLng: number;
    if (dt) {
      [anchorLat, anchorLng] = dt.split(",").map(Number);
    } else {
      const [ctr] = await sql<{ lat: number; lng: number }[]>`
        SELECT ST_Y(ST_Centroid(ST_GeomFromGeoJSON(${
          // centroid of the union of features
          // (reuse the same FeatureCollection-or-Feature handling)
          boundaryGeoJSON
        }))) AS lat,
               ST_X(ST_Centroid(ST_GeomFromGeoJSON(${boundaryGeoJSON}))) AS lng
      `.catch(async () => {
        // GeoJSON may be a FeatureCollection (ST_GeomFromGeoJSON wants a geometry):
        const [r] = await sql<{ lat: number; lng: number }[]>`
          WITH g AS (
            SELECT ST_Collect(ST_MakeValid((ST_Dump(ST_GeomFromGeoJSON(j.geom))).geom)) AS geom
            FROM (
              SELECT (feat->'geometry')::text AS geom
              FROM jsonb_array_elements(
                CASE WHEN (${boundaryGeoJSON}::jsonb)->>'type' = 'FeatureCollection'
                     THEN (${boundaryGeoJSON}::jsonb)->'features'
                     ELSE jsonb_build_array(${boundaryGeoJSON}::jsonb) END
              ) AS feat
            ) j
          )
          SELECT ST_Y(ST_Centroid(geom)) AS lat, ST_X(ST_Centroid(geom)) AS lng FROM g
        `;
        return [r];
      });
      anchorLat = ctr.lat;
      anchorLng = ctr.lng;
    }

    const rects = cardinalRects(bbox, aliases);
    let inserted = 0;
    let skipped = 0;

    // Boundary geometry CTE reused per insert via a SQL function expression.
    const boundarySql = sql`(
      SELECT ST_SetSRID(ST_Collect(ST_MakeValid((ST_Dump(ST_GeomFromGeoJSON(j.geom))).geom)), 4326)
      FROM (
        SELECT (feat->'geometry')::text AS geom
        FROM jsonb_array_elements(
          CASE WHEN (${boundaryGeoJSON}::jsonb)->>'type' = 'FeatureCollection'
               THEN (${boundaryGeoJSON}::jsonb)->'features'
               ELSE jsonb_build_array(${boundaryGeoJSON}::jsonb) END
        ) AS feat
      ) j
    )`;

    for (const r of rects) {
      const slug = slugify(r.name);
      const geomJson = JSON.stringify(r.geometry);
      const res = await sql<{ id: string }[]>`
        INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability)
        SELECT ${c.id}, ${r.name}, ${slug},
          ST_Multi(ST_CollectionExtract(
            ST_Intersection(
              ${boundarySql},
              ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)
            ), 3)),
          'Generated cardinal district', NULL, false, 'coarse', 0
        WHERE NOT EXISTS (
          SELECT 1 FROM neighborhoods WHERE city_id = ${c.id} AND slug = ${slug}
        )
        RETURNING id
      `;
      if (res.length) inserted++;
      else skipped++;
    }

    // Downtown = anchor buffer clipped to boundary.
    const dtSlug = "downtown";
    const dtRes = await sql<{ id: string }[]>`
      INSERT INTO neighborhoods (city_id, name, slug, polygon, source, source_url, is_fallback, tier, recognizability)
      SELECT ${c.id}, 'Downtown', ${dtSlug},
        ST_Multi(ST_CollectionExtract(
          ST_Intersection(
            ${boundarySql},
            ST_Buffer(ST_SetSRID(ST_MakePoint(${anchorLng}, ${anchorLat}), 4326)::geography, ${DOWNTOWN_RADIUS_M})::geometry
          ), 3)),
        'Generated cardinal district', NULL, false, 'coarse', 0
      WHERE NOT EXISTS (
        SELECT 1 FROM neighborhoods WHERE city_id = ${c.id} AND slug = ${dtSlug}
      )
      RETURNING id
    `;
    if (dtRes.length) inserted++;
    else skipped++;

    const reassigned = await assignNeighborhoods(sql, c.id);
    console.log(
      `Cardinal districts for '${city}': ${inserted} inserted, ${skipped} already present. ` +
        `Reassigned ${reassigned} venue(s).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Register the npm script**

In `package.json` `scripts`, add:

```json
    "generate:cardinal-districts": "tsx scripts/generate-cardinal-districts.ts",
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. (If lint flags the `.catch` fallback as complex, simplify by extracting the boundary-union into a single SQL CTE used for both centroid and bbox — keep behavior identical.)

- [ ] **Step 4: Dry sanity run (Tucson) — NON-DESTRUCTIVE, idempotent**

Run: `npm run generate:cardinal-districts -- --city tucson`
Expected: `Cardinal districts for 'tucson': 6 inserted, 0 already present. Reassigned N venue(s).` (6 = Downtown + 5 cardinal). A second run: `0 inserted, 6 already present`.

- [ ] **Step 5: Verify geometry validity + coverage**

Run:
```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const p=(await import("postgres")).default;const sql=p(process.env.DATABASE_URL,{max:1});console.table(await sql`SELECT nb.name, ST_IsValid(nb.polygon) valid, round((ST_Area(nb.polygon::geography)/1e6)::numeric,1) km2 FROM neighborhoods nb JOIN cities c ON c.id=nb.city_id WHERE c.slug='tucson' AND nb.source='Generated cardinal district' ORDER BY km2 DESC`);await sql.end();})'
```
Expected: 6 rows, all `valid=true`, non-zero areas, Downtown smallest.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-cardinal-districts.ts package.json
git commit -m "$(cat <<'EOF'
feat(geo): generate:cardinal-districts — gap-free coarse fallback layer

Clips Downtown + N/E/S/W/Central to the city boundary; optional per-city
alias map; idempotent; re-runs assignment.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rewrite assignment ranking (recognizable-fine → coarse → snap)

Replace the single smallest-polygon ranking with a recognizability-first preference, while
keeping the existing tight-snap (100m) and wide-unambiguous (1mi) safety nets for true gaps.

**Files:**
- Modify: `lib/geo/assignNeighborhoods.ts`
- Create: `scripts/test-neighborhood-assignment.ts`
- Modify: `package.json` (add `test:assignment`)

- [ ] **Step 1: Write the integration test (failing)**

Create `scripts/test-neighborhood-assignment.ts`. It builds a throwaway city + 3 overlapping
polygons + 2 venues inside a single transaction, runs `assignNeighborhoods`, asserts the
ranking, then ROLLS BACK so the DB is untouched.

```ts
/**
 * Integration test for assignNeighborhoods ranking. Builds fixtures in a transaction and
 * rolls back — leaves the DB unchanged. Requires a live PostGIS DB (DATABASE_URL).
 * Run: npx tsx scripts/test-neighborhood-assignment.ts — exits non-zero on any failure.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  let passed = 0;
  try {
    await sql.begin(async (tx) => {
      // Throwaway city. Required NOT-NULL cols (verified in db/schema/core.ts):
      // slug, name, country, default_timezone, currency_code.
      const [city] = await tx<{ id: string }[]>`
        INSERT INTO cities (name, slug, country, default_timezone, currency_code)
        VALUES ('TestVille', 'testville-assign', 'US', 'America/Phoenix', 'USD')
        RETURNING id`;

      // Helper to insert a square polygon covering [lng0..lng1] x [lat0..lat1].
      const square = (lng0: number, lat0: number, lng1: number, lat1: number) =>
        `{"type":"Polygon","coordinates":[[[${lng0},${lat0}],[${lng1},${lat0}],[${lng1},${lat1}],[${lng0},${lat1}],[${lng0},${lat0}]]]}`;

      // Big COARSE district covering everything (recognizability 1).
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Big District', 'big-district',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-111, 32, -110, 33)}), 4326)),
          'coarse', 1, false)`;
      // Small RECOGNIZABLE FINE neighborhood in the NW corner (recognizability 2).
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Famous Hood', 'famous-hood',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-111, 32.8, -110.9, 32.9)}), 4326)),
          'fine', 2, false)`;
      // Small OBSCURE FINE neighborhood in the SE corner (recognizability 0).
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Obscure NA', 'obscure-na',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-110.2, 32.1, -110.1, 32.2)}), 4326)),
          'fine', 0, true)`;

      // Venue A inside Famous Hood (and Big District). Expect → Famous Hood.
      const [vA] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng)
        VALUES (${city.id}, 'Venue A', 'venue-a', 32.85, -110.95) RETURNING id`;
      // Venue B inside Obscure NA (and Big District). Expect → Big District (obscure shadowed).
      const [vB] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng)
        VALUES (${city.id}, 'Venue B', 'venue-b', 32.15, -110.15) RETURNING id`;

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      const got = async (vid: string) => {
        const [r] = await tx<{ name: string | null }[]>`
          SELECT n.name FROM venues v LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
          WHERE v.id = ${vid}`;
        return r.name;
      };

      assert.equal(await got(vA.id), "Famous Hood",
        "recognizable fine neighborhood wins when it contains the venue");
      passed++;
      console.log("  ✓ recognizable fine wins over coarse");

      assert.equal(await got(vB.id), "Big District",
        "obscure fine is shadowed; venue rolls up to the coarse district");
      passed++;
      console.log("  ✓ obscure fine is shadowed → coarse rollup");

      // Roll back: throw a sentinel so sql.begin aborts the txn.
      throw new Error("ROLLBACK_SENTINEL");
    });
  } catch (err) {
    if ((err as Error).message !== "ROLLBACK_SENTINEL") throw err;
  } finally {
    await sql.end();
  }
  console.log(`\n${passed} checks passed (fixtures rolled back).`);
  if (passed !== 2) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> Note: this assumes `venues` requires only `city_id,name,slug,lat,lng` as NOT NULL (others nullable/defaulted). If the insert fails on a missing NOT NULL column, add the minimal required columns shown in the error — do NOT weaken constraints.

- [ ] **Step 2: Register the npm script**

In `package.json` `scripts`, add:

```json
    "test:assignment": "tsx scripts/test-neighborhood-assignment.ts",
```

- [ ] **Step 3: Run to verify it FAILS against current logic**

Run: `npm run test:assignment`
Expected: FAIL on the second assertion — current logic picks the smallest polygon, so Venue B gets "Obscure NA" instead of "Big District". (Venue A may already pass.) This proves the test exercises the new behavior.

- [ ] **Step 4: Rewrite the assignment ranking**

In `lib/geo/assignNeighborhoods.ts`, replace the **first** UPDATE (the `const rows = ...` tight-snap query) with the version below. The change: add an `ineligible` flag (a fine neighborhood below the recognizability bar is ineligible), order so eligible beats ineligible, then containment, then coarse-prefers-larger-context via the existing tie-breaks. Keep `SNAP_METERS`, the second wide-snap UPDATE, and the return value unchanged.

```ts
  const rows = await sql<{ id: string }[]>`
    UPDATE venues v
    SET neighborhood_id = sub.nid,
        updated_at = now()
    FROM (
      SELECT DISTINCT ON (vv.id) vv.id AS vid, n.id AS nid
      FROM venues vv
      JOIN neighborhoods n
        ON n.city_id = vv.city_id
       AND n.polygon IS NOT NULL
       AND ST_DWithin(
             n.polygon::geography,
             ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)::geography,
             ${SNAP_METERS}
           )
      WHERE vv.lat IS NOT NULL
        AND vv.lng IS NOT NULL
        AND vv.deleted_at IS NULL
        ${cityId ? sql`AND vv.city_id = ${cityId}` : sql``}
      ORDER BY vv.id,
               -- 1. Eligible candidates first: a recognizable fine neighborhood, OR any
               --    coarse district. A fine neighborhood below the recognizability bar is
               --    ineligible (shadowed) and only used as a last resort.
               (CASE WHEN n.tier = 'fine' AND n.recognizability < ${RECOGNIZABLE_BAR}
                     THEN 1 ELSE 0 END) ASC,
               -- 2. Among eligible: prefer a recognizable FINE name over a COARSE rollup.
               (CASE WHEN n.tier = 'fine' THEN 0 ELSE 1 END) ASC,
               -- 3. Containing polygon (distance 0) beats merely-near.
               ST_Distance(
                 n.polygon::geography,
                 ST_SetSRID(ST_MakePoint(vv.lng::float8, vv.lat::float8), 4326)::geography
               ) ASC,
               -- 4. Higher recognizability wins.
               n.recognizability DESC,
               -- 5. Tie-break: smaller (more specific) polygon.
               ST_Area(n.polygon::geography) ASC
    ) sub
    WHERE v.id = sub.vid
      AND v.neighborhood_id IS DISTINCT FROM sub.nid
    RETURNING v.id
  `;
```

- [ ] **Step 5: Import the bar constant**

At the top of `lib/geo/assignNeighborhoods.ts`, add:

```ts
import { RECOGNIZABLE_BAR } from "@/lib/geo/recognizability";
```

Also update the function's doc-comment ranking list (lines ~30–40) to describe the new order (eligible recognizable-fine/coarse → fine-over-coarse → containment → recognizability → smallest). Keep it accurate to the SQL above.

- [ ] **Step 6: Run test to verify it PASSES**

Run: `npm run test:assignment`
Expected: PASS — both checks `✓`, "2 checks passed (fixtures rolled back)."

- [ ] **Step 7: Confirm rollback left no residue**

Run:
```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const p=(await import("postgres")).default;const sql=p(process.env.DATABASE_URL,{max:1});const r=await sql`SELECT count(*)::int n FROM cities WHERE slug=${"testville-assign"}`;console.log("leftover test cities:",r[0].n);await sql.end();})'
```
Expected: `leftover test cities: 0`.

- [ ] **Step 8: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add lib/geo/assignNeighborhoods.ts scripts/test-neighborhood-assignment.ts package.json
git commit -m "$(cat <<'EOF'
feat(geo): recognizability-first neighborhood assignment

Prefer a recognizable fine neighborhood, else roll up to the coarse
district; obscure fine names are shadowed. Integration-tested in a
rolled-back txn.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add a recognizability metric to the coverage report

Keep the ≥95% coverage gate; add a per-city "% of assigned venues on a recognizable named
(fine) neighborhood vs. a coarse rollup" so friendliness is measurable.

**Files:**
- Modify: `scripts/analyze-neighborhood-coverage.ts`

- [ ] **Step 1: Extend the summary query**

In `scripts/analyze-neighborhood-coverage.ts`, the main summary query selects per-city
`slug, venues, assigned, rate` (with `HAVING count(v.id) > 0` and `ORDER BY rate ASC`). Add a
`LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id` and two columns, **keeping the
existing HAVING and ORDER BY**. Replace the existing `const rows = await sql<...>` block with:

```ts
    const rows = await sql<
      {
        slug: string;
        venues: number;
        assigned: number;
        rate: number;
        on_fine: number;
        recognizable_rate: number;
      }[]
    >`
      SELECT c.slug,
             count(v.id)::int AS venues,
             count(v.neighborhood_id)::int AS assigned,
             COALESCE(count(v.neighborhood_id)::float / NULLIF(count(v.id), 0), 0) AS rate,
             count(v.id) FILTER (WHERE n.tier = 'fine' AND n.recognizability >= 1)::int AS on_fine,
             COALESCE(
               count(v.id) FILTER (WHERE n.tier = 'fine' AND n.recognizability >= 1)::float
               / NULLIF(count(v.neighborhood_id), 0), 0) AS recognizable_rate
      FROM cities c
      LEFT JOIN venues v ON v.city_id = c.id AND v.deleted_at IS NULL
      LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
      ${citySlug ? sql`WHERE c.slug = ${citySlug}` : sql``}
      GROUP BY c.slug
      HAVING count(v.id) > 0
      ORDER BY rate ASC
    `;
```

- [ ] **Step 2: Print the new metric**

The current per-city print line (inside the `for (const r of rows)` loop) is:

```ts
      console.log(
        `  ${pass ? "PASS" : "FAIL"}  ${r.slug.padEnd(18)} ` +
          `${pct.padStart(5)}%  (${r.assigned}/${r.venues}, ${r.venues - r.assigned} blank)`,
      );
```

Replace it with (appends the recognizable share; `pct` is the local `(r.rate*100).toFixed(1)`
already computed just above it):

```ts
      const recPct = (r.recognizable_rate * 100).toFixed(0);
      console.log(
        `  ${pass ? "PASS" : "FAIL"}  ${r.slug.padEnd(18)} ` +
          `${pct.padStart(5)}%  (${r.assigned}/${r.venues}, ${r.venues - r.assigned} blank)` +
          `  — ${recPct.padStart(3)}% recognizable (${r.on_fine}/${r.assigned})`,
      );
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Run it**

Run: `npm run analyze:neighborhood-coverage`
Expected: each city still shows its assigned % and PASS/FAIL, now with a "recognizable name" share. (The numbers become meaningful after Task 9 runs the pipeline.)

- [ ] **Step 5: Commit**

```bash
git add scripts/analyze-neighborhood-coverage.ts
git commit -m "$(cat <<'EOF'
feat(geo): report % of venues on a recognizable named neighborhood

Adds a friendliness metric alongside the ≥95% coverage gate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Execute the pipeline for Tucson + Phoenix and verify end-to-end

This task RUNS the pipeline against the live DB and inspects the result. The Overpass calls
are free (no AI spend). No `--limit`-style cost concerns here.

- [ ] **Step 1: Re-import OSM for Tucson (captures tier/recognizability for real barrios)**

Run: `npm run import:osm-neighborhoods -- --city tucson --bbox 31.9,-111.2,32.4,-110.7`
Expected: inserts/updates OSM neighborhoods; logs polygons found + reassigned count. Sam
Hughes / Barrio Viejo / Armory Park should now exist as `tier='fine', recognizability=2`.

- [ ] **Step 2: Verify the famous barrios carry the recognizability signal (design assumption check)**

Run:
```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const p=(await import("postgres")).default;const sql=p(process.env.DATABASE_URL,{max:1});console.table(await sql`SELECT nb.name, nb.tier, nb.recognizability FROM neighborhoods nb JOIN cities c ON c.id=nb.city_id WHERE c.slug=${"tucson"} AND nb.name IN ('"'"'Sam Hughes'"'"','"'"'Barrio Viejo'"'"','"'"'Armory Park'"'"','"'"'Barrio Hollywood'"'"') ORDER BY nb.name`);await sql.end();})'
```
Expected: these rows have `recognizability=2`. **If they're missing or score 0**, the OSM
tags differ from the design assumption — STOP and report: we'd then lower `RECOGNIZABLE_BAR`
or add a curated allowlist for these names rather than guess. (This is the one empirical
assumption the spec flagged.)

- [ ] **Step 3: Generate the cardinal fallback for Tucson**

Run: `npm run generate:cardinal-districts -- --city tucson`
Expected: `6 inserted` (first run), assignment re-run.

- [ ] **Step 4: Re-run assignment for both cities (covers Phoenix after Task 7 logic change)**

Run:
```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const p=(await import("postgres")).default;const {assignNeighborhoods}=await import("@/lib/geo/assignNeighborhoods");const sql=p(process.env.DATABASE_URL,{max:1});for(const slug of ["tucson","phoenix-central"]){const [c]=await sql`SELECT id FROM cities WHERE slug=${slug}`;const n=await assignNeighborhoods(sql,c.id);console.log(slug,"reassigned",n);}await sql.end();})'
```
Expected: prints reassigned counts for both cities (Phoenix venues that were on obscure fine
names move to recognizable/coarse).

- [ ] **Step 5: Inspect Tucson's resulting listing**

Run:
```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const p=(await import("postgres")).default;const sql=p(process.env.DATABASE_URL,{max:1});console.table(await sql`SELECT n.name, n.tier, n.recognizability, count(v.id)::int venues FROM neighborhoods n JOIN cities c ON c.id=n.city_id LEFT JOIN venues v ON v.neighborhood_id=n.id AND v.deleted_at IS NULL WHERE c.slug=${"tucson"} GROUP BY n.id,n.name,n.tier,n.recognizability HAVING count(v.id)>0 ORDER BY venues DESC`);await sql.end();})'
```
Expected: the surfaced names are recognizable — barrios (Sam Hughes, Barrio Viejo, Downtown,
West University), Census coarse areas (Catalina Foothills, South Tucson), and cardinal zones
where nothing else covers — **not** Limberlost / Poets Square / Sewell (those now have 0
venues).

- [ ] **Step 6: Run the coverage + friendliness report**

Run: `npm run analyze:neighborhood-coverage`
Expected: Tucson still PASS ≥95% assigned; the "recognizable name" share is materially higher
than before. Record the before/after in the commit message.

- [ ] **Step 7: Optionally add a Tucson alias to demo the override**

Only if you want the demo: create `data/tucson-cardinal-aliases.json`:

```json
{ "Central": "Midtown" }
```

Then re-run Step 3 won't rename existing rows (idempotent skip). To apply an alias to an
already-generated zone, update its name directly:

```bash
npx tsx -e 'import("dotenv/config").then(async()=>{const p=(await import("postgres")).default;const sql=p(process.env.DATABASE_URL,{max:1});await sql`UPDATE neighborhoods SET name='"'"'Midtown'"'"', slug='"'"'midtown'"'"' WHERE source='"'"'Generated cardinal district'"'"' AND name='"'"'Central'"'"' AND city_id=(SELECT id FROM cities WHERE slug='"'"'tucson'"'"')`;await sql.end();})'
```

(Leaving the override mechanism file-based for fresh cities; this manual update is just for
the already-generated Tucson row.)

- [ ] **Step 8: Commit any data files + a checkpoint note**

```bash
git add -A data/ 2>/dev/null; git commit -m "$(cat <<'EOF'
chore(geo): execute friendly-neighborhood pipeline for tucson + phoenix

Re-imported OSM, generated cardinal fallback, re-ran assignment.
Recognizable-name share before/after recorded in plan.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)" || echo "nothing to commit"
```

---

## Task 10: Document the pipeline

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a status section to CLAUDE.md**

Add a dated subsection (mirror the style of the existing dated sections) summarizing:
- The two-tier model (`tier` fine/coarse + `recognizability` 0..2 from OSM wiki/place signals).
- The new scripts: `backfill:neighborhood-tiers`, `generate:cardinal-districts`; the extended
  `import:osm-neighborhoods`; the rewritten `assignNeighborhoods` (recognizable-fine → coarse
  → snap); the coverage report's recognizable-% metric.
- The per-city alias mechanism (`data/<city>-cardinal-aliases.json`, generic by default).
- The one empirical caveat verified in Task 9 Step 2 (barrios carry wikidata).
- Pointer to the spec + this plan.

- [ ] **Step 2: Typecheck/lint sanity (docs only, but confirm nothing else changed)**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: record friendly-neighborhood recognizability pipeline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (completed during authoring)

**Spec coverage:**
- Two-tier model + recognizability score → Tasks 1, 2.
- Recognizability from OSM wiki/place (non-hallucinated) → Task 2 (`recognizabilityScore`), Task 4 (capture at import).
- OSM as primary fine layer / re-import Tucson → Task 9 Step 1.
- Coarse layer = OSM coarse tier + admin (Census/villages) + cardinal fallback → Tasks 3 (admin mapping), 5–6 (cardinal).
- Tucson NA demotion → Task 3.
- Generic-default + optional per-city alias mechanism → Tasks 5–6 (`CardinalAliases`, `data/<city>-cardinal-aliases.json`), Task 9 Step 7 demo.
- Assignment rewrite (recognizable-fine → coarse → snap; obscure shadowed) → Task 7.
- UI surfaces only assigned names (no change needed) → noted; verified by Task 9 Step 5.
- ≥95% coverage gate preserved + new recognizable-% metric → Task 8.
- Empirical verification of the wikidata-on-barrios assumption → Task 9 Step 2 (with explicit STOP/fallback).
- Tests via repo convention (`scripts/test-*.ts`) → Tasks 2, 5, 7.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. The two intentionally-flexible spots (coverage-script print line; venues NOT NULL columns) give an exact fallback rule rather than "handle it."

**Type consistency:** `tierForPlace`/`recognizabilityScore`/`isRecognizableFine`/`RECOGNIZABLE_BAR` defined in Task 2 are used identically in Tasks 4, 7, 8. `cardinalRects`/`Bbox`/`CardinalAliases`/`CardinalRect` defined in Task 5 are used identically in Task 6. Column names `tier`/`recognizability` consistent across Tasks 1, 3, 4, 6, 7, 8.

## Open questions carried from the spec (resolve during execution if they bite)

- Default center label is **"Central"** (alias → "Midtown" per city). Keep unless operator says otherwise.
- The existing 1-mile wide-unambiguous snap is **retained** as a final coarse-only net; revisit removing it only if it causes a visibly wrong assignment after Task 9.
