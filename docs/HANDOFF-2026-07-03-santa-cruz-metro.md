# Handoff — Santa Cruz greater-metro coverage (2026-07-03)

**Branch:** `feat/santa-cruz-coverage` (off `origin/main`).
**Status:** boundary + constituent neighborhoods DONE & verified locally. Discovery / enrich / stub-fix NOT started (paid). **Work is uncommitted — commit first (step 0).**

---

## TL;DR
SC's coverage gap vs a 20-venue locals' FB thread was **7 of 8 misses out-of-boundary** — the city-limit polygon excluded Capitola / Soquel / Aptos / Live Oak / Rio del Mar. Not a discovery bug. Fix = dissolve a **greater-SC metro boundary** (the San Mateo mid-Peninsula pattern, PR #158). Boundary + 7 town neighborhoods are built and validated. **Next: paid discovery on the expanded boundary → enrich ($5 gate) → reextract 4 stubs → fix Stagnaro → seed Suda → reconcile → PR.**

## Why we were missing venues (root cause — generalizes to every city)
1. **Boundary = city limits, not metro (dominant).** Discovery tiles `data/<slug>-boundary.geojson`; we shipped a city-limit polygon where HH culture spans the whole metro. San Mateo / silicon-valley / five-cities already use dissolved metro boundaries; SC (and Tempe, San Jose) didn't.
2. **In-boundary recall (~1%).** Only Süda (Soquel Ave, confirmed in-polygon) was missed by both searchNearby (20/tile, DISTANCE rank) and the "happy hour" Text-Search recall pass. Targeted seed — don't rewrite recall for one venue.
3. **Extraction (4 stubs).** Jack O'Neill's, Aldo's, Low Tide, Venus Spirits — discovered, no HH pulled.
4. **Wrong Google entity.** `stagnaro-bros-seafood-inc` = wholesale company, not the wharf restaurant.

Full detail + reusable playbook: memory `project_coverage-misses-boundary-scope.md`.

## DONE (verified)
- **`data/santa-cruz-boundary.geojson`** → dissolved 7-town metro MultiPolygon (11 parts): SC city `r:111737`, Capitola `r:3574370`, Twin Lakes `r:7063032`, Soquel `r:9408781`, Aptos `r:9408782`, Live Oak `w:33167234`, Rio del Mar `w:33167250` (last two are `boundary=census` **ways**, not relations). Validates: `pnpm tsx scripts/test-santa-cruz-boundary.ts` → "1 feature, 11 parts, 7 inside / 3 outside checks passed".
- **`cities.seed_config` (santa-cruz)** → `serviceLocalities` = 7 towns, `serviceBufferMeters` 1500, `radiusKm` 12. Applied via `pnpm seed:cities` (ON CONFLICT DO UPDATE — verified in DB).
- **7 locality neighborhoods** inserted (Santa Cruz, Capitola, Twin Lakes, Soquel, Aptos, Live Oak, Rio del Mar — all `coarse` / recognizability 2). SC now has 14 neighborhoods (these + existing Downtown/Central/N/E/S/W/Seabright).
- **Tooling (reusable):** `build-aggregate-boundary.ts` (added `r:`/`w:` prefix), `add-metro-locality-neighborhoods.ts` (new — inserts towns by OSM ref, avoids Nominatim misresolution of CDPs), `test-santa-cruz-boundary.ts` (new).

## NEXT — resume here (ordered)

### 0. Commit (uncommitted!)
```bash
git add -A && git commit -m "feat(santa-cruz): expand to greater-metro boundary + locality neighborhoods"
```

### 1. Discovery on expanded boundary — PAID ~$0.5–0.8, under gate
```bash
pnpm seed:discover -- --city santa-cruz --state CA --debug-drops 2>&1 | tee /tmp/sc-discover.log
```
- Reads the new metro boundary. **Idempotent** on existing SC venues (dedup `google_place_id`) but **re-bills Google for the whole area** (searchNearby ~$0.03/tile, no ledger; ~25 tiles incl. SC city re-tile).
- **Cost-saver:** scope to the new eastern towns only — add `--bbox -122.01,36.92,-121.85,37.01` — skips re-tiling SC city.
- Watch the pruned-tile count + $ estimate in the log.

### 2. [$5 GATE] Enrich the new candidates — PAID ~$2–5
```bash
tsx scripts/db-query.ts "SELECT count(*) FROM seed_candidates WHERE city_id='82c753fb-ef7e-413b-a71b-9f6cf80ec1bd' AND outcome IS NULL;"
```
Quote batch enrich (~$0.05–0.08/venue × ~40–60 new candidates). **STOP if combined paid ≥$5.**
```bash
pnpm seed:enrich -- --city santa-cruz --state CA --batch --debug-drops
```

### 3. Assign venues to neighborhoods (FREE)
```bash
pnpm backfill:neighborhoods -- --city santa-cruz --state CA
pnpm analyze:neighborhood-coverage -- --city santa-cruz --state CA   # gate ≥95%
```
Optional polish — re-cut cardinal districts from the expanded boundary:
`pnpm generate:cardinal-districts -- --city santa-cruz --state CA --downtown 36.9741,-122.0308 --redo-downtown`

### 4. Reextract 4 stubs + fix Stagnaro + seed Suda
- **Stubs** — venue slugs: `jack-o-neill-restaurant-lounge`, `aldo-s`, `low-tide-bar-grill`, `venus-spirits-cocktails-kitchen-westside`, `venus-spirits-tasting-room`:
  `pnpm reextract:stubs -- --city santa-cruz --state CA --ids "<comma-sep venue IDs>"` (or `/admin/stubs` Resolver).
- **Stagnaro** — `stagnaro-bros-seafood-inc` is the wholesale INC, not the wharf restaurant. Delete the wrong row; the real Stagnaro Bros (wharf) is now in-boundary and should seed on discovery.
- **Süda** (in-boundary recall miss) — targeted seed by Google Place lookup → enrich. One-off.

### 5. Reconcile + verify + PR
```bash
pnpm reconcile:windows -- --city santa-cruz --state CA --apply
pnpm regate -- --city santa-cruz --state CA
```
Re-check coverage vs the FB list — expect Zelda's / Britannia Arms / Margaritaville (Capitola), Venus (Rio del Mar), Shadowbrook (Soquel), Shenanigans (Aptos) now present. Then `gh pr create` → `gh pr merge --merge` when green.

## Reusable playbook for the next 2 cities (you mentioned sites ready)
1. Get the locals' HH list (FB/Reddit). Match against DB; categorize each miss: out-of-boundary / in-boundary / stub / wrong-entity.
2. If out-of-boundary dominates → enumerate OSM boundaries in the county via Overpass (`boundary=census` = CDPs, `admin_level=8` = cities); pick the contiguous developed towns.
3. `pnpm tsx scripts/build-aggregate-boundary.ts --slug <city> --relations r:..,w:..` — **include the primary city's own ref** or you'll lose it. Census TIGERweb REST is 404; OSM has every CA CDP we needed.
4. `scripts/seed-cities.ts` → `serviceLocalities` = constituent towns, `serviceBufferMeters` 1500; run `pnpm seed:cities`.
5. `pnpm tsx scripts/add-metro-locality-neighborhoods.ts --city <city> --state <ST> --items "Name=r:..,Name2=w:.."` (NOT `import:locality-neighborhoods` — Nominatim misresolves unincorporated CDPs like Live Oak / Twin Lakes).
6. discovery → enrich (gate) → backfill:neighborhoods → reconcile. Write a `test-<city>-boundary.ts` (PIP check: each town in, excluded neighbors out).

## Files changed (for the PR)
- `data/santa-cruz-boundary.geojson` (metro, 11 parts — supersedes the municipal polygon; old one recoverable from git)
- `scripts/build-aggregate-boundary.ts` (`r:`/`w:` prefix — backward compatible)
- `scripts/add-metro-locality-neighborhoods.ts` (new)
- `scripts/test-santa-cruz-boundary.ts` (new)
- `scripts/seed-cities.ts` (SC entry → metro)
- `docs/HANDOFF-2026-07-03-santa-cruz-metro.md` (this)

## Gotchas
- The 7 locality polygons + `seed_config` are in the **LOCAL DB only**. For prod: merge the PR, then run `pnpm seed:cities` + `pnpm tsx scripts/add-metro-locality-neighborhoods.ts …` against prod (script-reproducible), or push via `pnpm push:prod`. Never deploy/migrate prod yourself (operator handles).
- Cardinal districts were cut from the **old** municipal boundary; with the expanded metro they may misalign for the new towns. Locality polygons cover the towns by name, so cardinal re-cut is optional polish, not required.
- Discovery re-bills the whole area each run — use `--bbox` to limit to new towns if cost matters.
- `data/scottsdale-open-space.geojson` is a pre-existing untracked file — not part of this work.
