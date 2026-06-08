# Google-name Neighborhood Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google's per-venue `addressComponents` neighborhood name the PRIMARY neighborhood source (polygon/cardinal become fallback), captured free at discovery for new cities and backfilled cheaply for the 6 existing ones.

**Architecture:** A pure parse/normalize/noise-filter module turns Google `addressComponents` into a clean neighborhood name (or null). That name is stored on `seed_candidates` (at discovery) and `venues` (at enrich, or via a per-city backfill script). `assignNeighborhoods` gains a name-primary "stage 0" that upserts polygon-less `neighborhoods` rows and assigns by name; the existing spatial stages run only for venues with no Google name.

**Tech Stack:** TypeScript (tsx scripts), Drizzle + postgres.js, PostGIS, Google Places API (New), Vitest (or the repo's test runner — confirm in Task 1).

**Spec:** `docs/superpowers/specs/2026-06-07-google-neighborhood-source-design.md`

**Branch/worktree:** Start in a fresh worktree off latest `origin/main` (the parallel session blocks edits on `main` and recommends `claude --worktree`). NOTE: this feature depends on the Atmosphere-capture-at-discovery work (commit `32b082a`) and the enrich populate-stubs change (`0ca838c`); ensure those are merged to `main` first, or branch from a base that includes them.

---

## Pre-req Task 0: Verify the Place Details SKU price (NO code, do this FIRST)

The cost-care line item — do not trust a remembered number.

- [ ] **Step 1:** Confirm the billing tier for an `addressComponents`-only Place Details call in the [Places API (New) pricing table](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing). Expectation: it falls in the **Place Details Essentials / basic** tier (≈$5/1000), NOT the Atmosphere tier ($25–40/1000). Record the actual per-1000 price.
- [ ] **Step 2:** Compute the real backfill total: (sum of venue counts across the 6 cities, ≈2,000) × verified per-call price. If it materially exceeds ~$15, STOP and reconfirm scope with the operator before running any backfill (Task 7).
- [ ] **Step 3:** Note the verified number in the PR description.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/places/neighborhoodName.ts` (new) | Pure: pick + normalize the neighborhood name from `addressComponents`; reject city-name/junk. The single source of truth for "what's a valid Google neighborhood." |
| `lib/places/neighborhoodName.test.ts` (new) | Unit tests for the above. |
| `db/migrations/0017_*.sql` (new) | Add `google_neighborhood text` to `seed_candidates` + `venues`. |
| `lib/places/placeDetails.ts` | Add `addressComponents` to the `PlaceDetails` type + parse (shared by backfill). |
| `scripts/seed-discover-tacoma.ts` | Add `places.addressComponents` to the searchNearby mask; store parsed name on candidate insert/upsert. |
| `scripts/seed-enrich-candidates.ts` | Carry `google_neighborhood` from candidate → venue. |
| `lib/geo/assignNeighborhoods.ts` | Add name-primary stage 0; guard stage 1 to skip Google-named venues. |
| `scripts/backfill-google-neighborhoods.ts` (new) | Per-city opt-in: Place Details `addressComponents` → store name → assign. |
| `package.json` | Add `backfill:google-neighborhoods` script entry. |

---

## Task 1: Pure neighborhood-name module

**Files:**
- Create: `lib/places/neighborhoodName.ts`
- Test: `lib/places/neighborhoodName.test.ts`

The Google response shape (both searchNearby and Place Details): `addressComponents: [{ longText, shortText, types: string[] }]`. Neighborhood lives in the component whose `types` contains `neighborhood` (preferred) or `sublocality`/`sublocality_level_1`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { pickNeighborhood, normalizeName, type AddressComponent } from "./neighborhoodName";

const comp = (longText: string, types: string[]): AddressComponent => ({ longText, shortText: longText, types });

describe("pickNeighborhood", () => {
  it("prefers a neighborhood-typed component", () => {
    expect(pickNeighborhood([comp("Temescal", ["neighborhood"]), comp("Oakland", ["locality"])], "Oakland")).toBe("Temescal");
  });
  it("falls back to sublocality when no neighborhood type", () => {
    expect(pickNeighborhood([comp("Upper Dimond", ["sublocality", "sublocality_level_1"])], "Oakland")).toBe("Upper Dimond");
  });
  it("rejects the city name itself", () => {
    expect(pickNeighborhood([comp("Oakland", ["neighborhood"])], "Oakland")).toBeNull();
  });
  it("rejects junk values", () => {
    expect(pickNeighborhood([comp("Parking lot", ["neighborhood"])], "Oakland")).toBeNull();
  });
  it("returns null when no neighborhood/sublocality component", () => {
    expect(pickNeighborhood([comp("94607", ["postal_code"])], "Oakland")).toBeNull();
  });
  it("trims and collapses whitespace", () => {
    expect(normalizeName("  Old   Oakland ")).toBe("Old Oakland");
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run lib/places/neighborhoodName.test.ts` → fails (module missing). (If the repo uses a different runner, match it — check `package.json` `test` script first.)

- [ ] **Step 3: Implement**

```ts
export interface AddressComponent {
  longText: string;
  shortText?: string;
  types: string[];
}

const JUNK = new Set(["parking lot", "parking", "unnamed road"]);

export function normalizeName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Pick a clean vernacular neighborhood name from Google addressComponents, or null.
 * Prefers type `neighborhood`, then `sublocality`/`sublocality_level_1`. Rejects the
 * city name itself and an obvious-junk denylist. */
export function pickNeighborhood(
  components: AddressComponent[] | null | undefined,
  cityName: string,
): string | null {
  if (!components?.length) return null;
  const byType = (t: string) => components.find((c) => c.types?.includes(t));
  const c = byType("neighborhood") ?? byType("sublocality") ?? byType("sublocality_level_1");
  if (!c?.longText) return null;
  const name = normalizeName(c.longText);
  if (!name) return null;
  const lc = name.toLowerCase();
  if (lc === cityName.trim().toLowerCase()) return null;
  if (JUNK.has(lc)) return null;
  return name;
}
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run lib/places/neighborhoodName.test.ts` → all pass.

- [ ] **Step 5: Commit** — `git add lib/places/neighborhoodName.ts lib/places/neighborhoodName.test.ts && git commit -m "feat(geo): pure Google-neighborhood name parser + noise filter"`

---

## Task 2: Migration — add `google_neighborhood` columns

**Files:** Create `db/migrations/0017_google_neighborhood.sql` (next number after `0016`). Also update the Drizzle schema so types match.

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE seed_candidates ADD COLUMN IF NOT EXISTS google_neighborhood text;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS google_neighborhood text;
```

- [ ] **Step 2: Add the columns to the Drizzle schema** — add `googleNeighborhood: text("google_neighborhood")` to the `seedCandidates` and `venues` table definitions in `db/schema/` (match the existing column style; find them with `grep -rn "website_url\|websiteUrl" db/schema/`).

- [ ] **Step 3: Apply + verify** — `npm run db:migrate` then `docker exec -e PGPASSWORD=hhf hhf-postgres psql -h localhost -U hhf -d happyhourfriends -tA -c "SELECT column_name FROM information_schema.columns WHERE table_name='venues' AND column_name='google_neighborhood';"` → returns `google_neighborhood`.

- [ ] **Step 4: Commit** — `git add db/migrations/0017_google_neighborhood.sql db/schema && git commit -m "feat(db): google_neighborhood on seed_candidates + venues (migration 0017)"`

---

## Task 3: Capture at discovery (searchNearby)

**Files:** Modify `scripts/seed-discover-tacoma.ts`.

VERIFIED: `searchNearby` returns `addressComponents` (test on 2026-06-07: all returned "Downtown Oakland"), and it's basic-tier so no atmosphere-tier bump.

- [ ] **Step 1: Add to the field mask** — in the `X-Goog-FieldMask` string (the Atmosphere mask added this session), append `,places.addressComponents`.

- [ ] **Step 2: Type the field** — add to the `PlaceResult` interface: `addressComponents?: { longText: string; shortText?: string; types: string[] }[];`

- [ ] **Step 3: Parse + store** — import `pickNeighborhood` from `@/lib/places/neighborhoodName`. In the insert block (where `servesAlcohol`/`hoursJson`/`phone` are computed), add `const googleNeighborhood = pickNeighborhood(place.addressComponents, city.name);`. Add `google_neighborhood` to the INSERT column list + VALUES (`${googleNeighborhood}`) and to the `ON CONFLICT DO UPDATE SET` clause (`google_neighborhood = EXCLUDED.google_neighborhood`).

- [ ] **Step 4: Verify compiles** — `npx tsc --noEmit 2>&1 | grep seed-discover` → no errors.

- [ ] **Step 5: Commit** — `git commit -am "feat(discover): capture Google neighborhood (addressComponents) at discovery — free"`

---

## Task 4: Carry to venue at enrich

**Files:** Modify `scripts/seed-enrich-candidates.ts`.

- [ ] **Step 1:** Add `google_neighborhood: string | null;` to the `SeedCandidate` interface.
- [ ] **Step 2:** Add `google_neighborhood` to BOTH candidate SELECTs (the sync `main()` query and the batch `prepAndSubmit()` query).
- [ ] **Step 3:** In `persistExtraction` venue INSERT (the column list around the `website_url, phone, price_level, hours_json, ...` block), add `google_neighborhood` to columns + `${ctx.googleNeighborhood ?? null}` to values. Add `googleNeighborhood: string | null` to `PrepContext` (in `lib/ai/enrichBatchState.ts`).
- [ ] **Step 4:** Set `googleNeighborhood: candidate.google_neighborhood ?? null` (sync path) and `c.google_neighborhood ?? null` (batch path + `stubCtxFor`) wherever a `ctx`/`PrepContext` is built.
- [ ] **Step 5: Verify** — `npx tsc --noEmit 2>&1 | grep -E "seed-enrich|enrichBatchState"` → no errors; `npx eslint scripts/seed-enrich-candidates.ts` → clean.
- [ ] **Step 6: Commit** — `git commit -am "feat(enrich): carry google_neighborhood candidate → venue"`

---

## Task 5: Name-primary assignment (stage 0)

**Files:** Modify `lib/geo/assignNeighborhoods.ts`. Test: `lib/geo/assignNeighborhoods.test.ts` (integration, rolled-back txn — follow the pattern in `scripts/test-neighborhood-assignment.ts`).

- [ ] **Step 1: Write the failing integration test** — in a rolled-back transaction: insert a city, a venue with `google_neighborhood='Temescal'` + coords inside a polygon-backed coarse "North" district, and a second venue with `google_neighborhood=NULL` inside "North". Run `assignNeighborhoods(sql, cityId)`. Assert: venue 1 → a `neighborhoods` row named "Temescal" (tier `fine`, `polygon IS NULL`, `source='Google Places'`); venue 2 → "North" (spatial). Assert re-running creates no duplicate "Temescal" row.

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement stage 0 + guard stage 1.** At the top of `assignNeighborhoods`, before the existing tight-snap UPDATE, add:

```ts
// Stage 0 — name-primary: a venue's Google neighborhood name wins over any polygon.
// Upsert a polygon-less neighborhood row per distinct name, then assign by name. The
// stored google_neighborhood is already noise-filtered (pickNeighborhood at capture time),
// so any non-null value is a valid vernacular name.
await sql`
  INSERT INTO neighborhoods (city_id, name, slug, polygon, source, tier, recognizability, is_fallback, in_scope)
  SELECT DISTINCT vv.city_id, vv.google_neighborhood,
         lower(regexp_replace(vv.google_neighborhood, '[^a-zA-Z0-9]+', '-', 'g')),
         NULL, 'Google Places', 'fine', ${RECOGNIZABLE_BAR}, false, true
  FROM venues vv
  WHERE vv.google_neighborhood IS NOT NULL
    AND vv.deleted_at IS NULL
    ${cityId ? sql`AND vv.city_id = ${cityId}` : sql``}
  ON CONFLICT (city_id, slug) DO NOTHING
`;
const named = await sql<{ id: string }[]>`
  UPDATE venues v
  SET neighborhood_id = n.id, updated_at = now()
  FROM neighborhoods n
  WHERE n.city_id = v.city_id
    AND n.source = 'Google Places'
    AND lower(regexp_replace(v.google_neighborhood, '[^a-zA-Z0-9]+', '-', 'g')) = n.slug
    AND v.google_neighborhood IS NOT NULL
    AND v.deleted_at IS NULL
    AND v.neighborhood_id IS DISTINCT FROM n.id
    ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
  RETURNING v.id
`;
```

Then guard the existing **stage 1** tight-snap query: add `AND vv.google_neighborhood IS NULL` to its inner `WHERE` (so polygons never override a Google name). Stage 2 already filters `neighborhood_id IS NULL`, so it needs no change. Update the return to `named.length + rows.length + wide.length`.

> Confirm `neighborhoods` has a unique constraint on `(city_id, slug)` (the OSM import relies on `ON CONFLICT (city_id, slug)`). If not present, add it in Task 2's migration.

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(geo): name-primary neighborhood assignment (Google name > polygon > cardinal)"`

---

## Task 6: Backfill script

**Files:** Create `scripts/backfill-google-neighborhoods.ts`; add `"backfill:google-neighborhoods": "tsx scripts/backfill-google-neighborhoods.ts"` to `package.json`.

Pattern: mirror `scripts/backfill-hours.ts` (per-city `requireCityArgs`, `--dry-run`, iterate venues with `google_place_id`, Place Details fetch, update, then `assignNeighborhoods`). Field mask: `addressComponents` ONLY (basic tier — keeps it cheap).

- [ ] **Step 1: Implement** — for each venue in the city with a `google_place_id` and `google_neighborhood IS NULL`: GET `https://places.googleapis.com/v1/places/{id}` with `X-Goog-FieldMask: addressComponents`; `pickNeighborhood(resp.addressComponents, city.name)`; if non-null and not `--dry-run`, `UPDATE venues SET google_neighborhood=... WHERE id=...`. Tally found/blank. After the loop (non-dry-run), call `assignNeighborhoods(sql, city.id)` and print the count. Respect a 429 abort like `backfill-hours.ts`.
- [ ] **Step 2: Dry-run test** — `pnpm tsx scripts/backfill-google-neighborhoods.ts --city oakland --state ca --dry-run --limit 5` → prints 5 venues' would-be neighborhoods, writes nothing, $0-ish.
- [ ] **Step 3: Verify** — `npx tsc --noEmit 2>&1 | grep backfill-google` clean; `npx eslint scripts/backfill-google-neighborhoods.ts` clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(backfill): per-city Google-neighborhood backfill (addressComponents, basic tier)"`

---

## Task 7: Run the backfill (operational — GATED on Task 0)

Only after Task 0 confirms the SKU price.

- [ ] **Step 1:** `pnpm tsx scripts/backfill-google-neighborhoods.ts --city oakland --state ca` → verify Oakland venues get real names (Temescal, Uptown, Jack London, Lake Merritt). Spot-check the neighborhood filter on the local site.
- [ ] **Step 2:** Repeat for `daly-city/ca`, `five-cities/ca`, `phoenix-central/az`, `scottsdale/az`, `tacoma/wa`, `tucson/az`. (Operator confirmed all 6 — note Daly City/Five Cities may legitimately return mostly town-name → null → keep their cardinal/town label.)
- [ ] **Step 3:** Run `npm run analyze:neighborhood-coverage -- --city <each> --state <st>` → confirm coverage holds and recognizable share jumps.
- [ ] **Step 4:** Spot-check Tucson/Phoenix/Tacoma for regressions (venues moved off a good polygon onto a worse Google name). If material, revisit the noise filter or precedence.

---

## Self-Review notes
- **Spec coverage:** capture-at-discovery (T3), backfill (T6/T7), name-only rows + precedence (T5), noise filter (T1), schema (T2), SKU verification (T0), testing (T1 unit + T5 integration) — all covered.
- **Type consistency:** `pickNeighborhood`/`normalizeName` (T1) used in T3/T6; `googleNeighborhood` on `PrepContext` (T4) + `google_neighborhood` column (T2) consistent across T3/T4/T5/T6.
- **Watch:** confirm `neighborhoods (city_id, slug)` unique constraint exists before relying on `ON CONFLICT` in T5 (add to T2 migration if missing); confirm the repo test runner (vitest vs other) in T1.
