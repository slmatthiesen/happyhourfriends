# Discovery cost blow-up — root cause + reduction plan (2026-06-03)

**Context:** The complete-coverage discovery rewrite (branch `feat/discovery-complete-coverage`)
made venue discovery far more thorough — but the live runs cost **~1,550–1,600 Google Places
calls per city (~$55 each)** vs the old **~21 calls/city**. Target going forward: **a couple
dollars per city (~60–90 calls)**. This documents exactly what drove the cost up and the
levers to bring it down, with projected call counts (modeled, no further API spend).

## Measured

| City | seed tiles | total Places calls | unique places | floor tiles still saturated | in-area kept |
|---|---|---|---|---|---|
| Tacoma | 21 | **1,593** | 827 | 247 | 264 |
| Daly City | 13 | **1,553** | 1,607 | 434 | 128 |

Old flat approach: one call per seed tile ≈ **21 / 13 calls**. The new approach is ~75–120× more.

## Root cause — three compounding factors

### 1. Subdivide-until-under-20, to a deep floor (the structural driver)
A tile that returns a saturated 20 results splits into 4 children and re-queries, recursively.
In a uniformly dense area where every tile down to the floor stays saturated, the call count is
the **full tree**: `1 + 4 + 16 + … + 4^D` where `D` = levels to the floor. The deeper the floor,
the more explosive: each extra level **quadruples** the leaf count.

### 2. Child radius `r/√2` instead of `r/2` (≈16× amplifier in dense areas) — a mid-build decision
To make 4 child circles fully cover the parent circle (a code-review concern about a ~0.2·r
uncovered arc at the cardinal edges), child radius was set to `r/√2` (≈0.707·r) rather than the
naive `r/2`. The unmodeled side effect:

- **`r/√2` shrinks slowly:** 3000 → 2121 → 1500 → 1061 → **750m** = reaches the depth-4 floor in
  4 levels → up to **256** leaf tiles per fully-saturated seed (tree = 341).
- **`r/2` shrinks fast:** 3000 → 1500 → **750m** = floor in 2 levels → **16** leaf tiles per seed
  (tree = 21).
- **341 vs 21 ≈ 16× more calls** per dense seed tile.

The slow shrink also means children stay large → stay above 20 results → keep subdividing. And
because `r/√2` children (radius 0.707·r, centered only r/2 apart) **overlap heavily and each
re-covers the parent's center**, the same venues are re-fetched 4× per level, which is *why* the
children stay saturated. So this one choice both deepens the tree and keeps every level saturated.

**This was my error: I implemented the `r/√2` coverage fix without modeling its cost.** The gap it
closes is largely theoretical — adjacent seed tiles (3000m spacing, 3000m radius = massive overlap)
already cover the cardinal-edge gaps in practice.

### 3. RADIUS mode subdivides into dense *adjacent* areas that get discarded
Without a `data/<city>-boundary.geojson`, discovery tiles a disk around the city center and only
filters by mailing-locality **per result, after fetching**. So for Daly City it subdivided deep
into San Francisco: **1,092 of 1,607 finds (68%) were out-of-area** and thrown away — but we paid
to densely subdivide those SF tiles. BOUNDARY mode already prunes out-of-scope tiles *before*
fetching (it does this for desert/water today); these three cities just have no boundary file.

## Reduction levers (modeled call counts)

Disk-grid tile count ≈ `π · (R_coverage / spacing)²`. Recursion multiplies that by the per-seed
tree size in dense pockets.

| Lever | Effect | Tacoma calls (modeled) |
|---|---|---|
| **A. Revert `r/√2` → `r/2`** | floor in 2 levels not 4; tree 341→21 per dense seed | ~1,593 → **~200–350** |
| **B. `MAX_DEPTH` 4 → 2** | caps tree at 1+4+16=21/seed regardless of shrink | ~1,593 → **~250–450** |
| **C. Boundary file (BOUNDARY mode)** | prune out-of-area tiles before fetching | cuts the adjacent-area waste (big for Daly City) |
| **D. Coarser recursion / fixed finer grid** | DISTANCE + fixed ~1500m grid, ≤1 level of subdivision | **~60–120** total |

**A + B together** (fast shrink AND shallow cap) put the worst-case tree at ~21/seed → roughly
**a few hundred calls** for a fully-dense city — still more than target. Adding **C** removes the
out-of-area waste. To actually hit **a couple dollars (~60–90 calls)** we also want **D**: don't
subdivide exhaustively to a tiny floor — a DISTANCE-ranked **fixed ~1500m grid** already returns
the *nearest* 20 per cell, and a single optional level of subdivision catches the few genuinely
dense downtown cells.

## Recommended approach (to implement, pending your nod)

1. **Revert child radius to `r/2`** (lever A) and document that seed/neighbor overlap covers the
   cardinal gaps — accept the theoretical gap for the ~16× cost win.
2. **`MAX_DEPTH` 2, `MIN_RADIUS` ~700m** (lever B+D): at most two subdivision levels; the densest
   cells are logged as floor-saturated rather than chased to 400m.
3. **Add a per-run call budget** (e.g. abort/​warn past ~250 calls) so cost can never surprise
   again — replaces the current 2,000-tile cap, which was far too high to be a real guardrail.
4. **Onboard boundary files** for the target cities (lever C) so RADIUS-mode adjacent-area waste
   disappears. Separate small task; biggest win for SF-adjacent Daly City.
5. **Re-validate on Daly City only** (one run) once the above lands — confirm calls drop to the
   ~60–120 range and the +87 candidate lift largely holds, before touching Tacoma/Phoenix.

**Projected result:** ~**$2–4/city** instead of ~$55, while keeping the DISTANCE-ranking win that
recovers buried bars (the original goal — e.g. The Main Ingredient).

## Decisions already made (operator, 2026-06-03)
- **Hold Phoenix and the Tacoma re-run** until cost is locked in.
- **Do both** lever A/B (lower depth/shrink) **and** lever C (boundary files).
- **$55/city is unacceptable; target a couple dollars/city.**

## What's already correct and stays
- DISTANCE ranking (the actual fix for the popularity-20 cap) — cheap, keep.
- Airport gate, now filtered to real airport `primaryType`s (the hospital-heliport over-drop is fixed).
- Adult-club + casino denylist broadening.
- All pure modules + their tests (`discoveryTiling`, `airportGate`, denylist) — only the tiling
  *parameters/strategy* change, not the structure.
