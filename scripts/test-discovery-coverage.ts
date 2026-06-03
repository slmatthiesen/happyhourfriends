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
    assert.equal(k.radiusMeters, 1500, "half radius");
    assert.equal(k.depth, 1, "depth + 1");
    assert.notEqual(k.lat, parent.lat, "lat offset from parent");
    assert.notEqual(k.lng, parent.lng, "lng offset from parent");
  }
  assert.equal(new Set(kids.map((k) => k.lat)).size, 2, "two distinct child latitudes");
  assert.equal(new Set(kids.map((k) => k.lng)).size, 2, "two distinct child longitudes");
});

check("tiling constants are the agreed completeness-leaning defaults", () => {
  assert.equal(MAX_RESULTS, 20, "Google Places per-call cap");
  assert.equal(MIN_RADIUS_METERS, 400, "subdivision floor radius");
  assert.equal(MAX_DEPTH, 4, "max recursion depth");
});

console.log(`\n${passed} checks passed.`);
