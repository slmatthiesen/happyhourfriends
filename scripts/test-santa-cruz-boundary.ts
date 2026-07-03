/**
 * Validates the merged Santa Cruz boundary GeoJSON (7 OSM inputs → 1 MultiPolygon).
 * Pure (no DB). Run: pnpm tsx scripts/test-santa-cruz-boundary.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pointInPolygon } from "../lib/geo/pointInPolygon";

const fc = JSON.parse(readFileSync("data/santa-cruz-boundary.geojson", "utf8"));
assert.equal(fc.type, "FeatureCollection");
assert.equal(
  fc.features.length,
  1,
  "boundary MUST be a single merged feature (seed:discover reads features[0] only)",
);
const geom = fc.features[0].geometry;
assert.equal(geom.type, "MultiPolygon", `expected MultiPolygon, got ${geom.type}`);
assert.ok(
  geom.coordinates.length >= 7,
  `expected >=7 polygon parts (SC + Capitola + Twin Lakes + Soquel + Aptos + Live Oak + Rio del Mar), got ${geom.coordinates.length}`,
);

// Inside: one representative point per constituent (town/village centers).
const inside: Array<[string, number, number]> = [
  ["Santa Cruz downtown", -122.0303, 36.9741],
  ["Capitola village", -121.9533, 36.9761],
  ["Twin Lakes / harbor", -122.018, 36.964],
  ["Soquel village", -121.9464, 36.9906], // Soquel CDP is concave; interior point, not the bbox center
  ["Aptos village", -121.899, 36.977],
  ["Live Oak (41st Ave)", -121.98, 36.97],
  ["Rio del Mar", -121.8912, 36.948], // Rio del Mar CDP is concave; interior point
];
for (const [name, lng, lat] of inside) {
  assert.ok(pointInPolygon([lng, lat], geom), `${name} should be INSIDE the boundary`);
}

// Outside: deliberately-excluded neighbors.
const outside: Array<[string, number, number]> = [
  ["Watsonville", -121.757, 36.9105],
  ["Scotts Valley", -122.0125, 37.051],
  ["Davenport (rural north)", -122.193, 37.0055],
];
for (const [name, lng, lat] of outside) {
  assert.ok(!pointInPolygon([lng, lat], geom), `${name} should be OUTSIDE the boundary`);
}

console.log(
  `✓ santa-cruz boundary OK — 1 feature, ${geom.coordinates.length} parts, ${inside.length} inside / ${outside.length} outside checks passed`,
);
