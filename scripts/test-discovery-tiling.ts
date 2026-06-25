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

  await check("onCapReached hands back the ACTUAL unvisited regions (for resume)", async () => {
    let unvisited: Reg[] = [];
    let remaining = -1;
    await collectAdaptiveRegions<Reg, { id?: string }>({
      seedRegions: [{ lo: 0, hi: 8 }],
      fetchRegion: async () => ({ places: [], saturated: true, calls: 1 }),
      splitRegion, canSubdivide,
      maxCalls: 3,
      onCapReached: (r, regions) => { remaining = r; unvisited = regions; },
    });
    // The count and the region list agree, and the list holds real regions to resume from.
    assert.equal(unvisited.length, remaining);
    assert.ok(unvisited.length > 0 && typeof unvisited[0].lo === "number", "unvisited regions are resumable");
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
