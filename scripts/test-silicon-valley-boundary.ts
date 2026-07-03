/**
 * Validates the merged Silicon Valley boundary GeoJSON (9 OSM relations → 1 MultiPolygon).
 * Pure (no DB). Run: pnpm tsx scripts/test-silicon-valley-boundary.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pointInPolygon } from "../lib/geo/pointInPolygon";

const fc = JSON.parse(readFileSync("data/silicon-valley-boundary.geojson", "utf8"));
assert.equal(fc.type, "FeatureCollection");
assert.equal(
  fc.features.length,
  1,
  "boundary MUST be a single merged feature (seed:discover reads features[0] only)",
);
const geom = fc.features[0].geometry;
assert.equal(geom.type, "MultiPolygon", `expected MultiPolygon, got ${geom.type}`);
assert.ok(
  geom.coordinates.length >= 9,
  `expected >=9 polygon parts, got ${geom.coordinates.length}`,
);

// Inside: one representative point per municipality (city centers / downtowns).
const inside: Array<[string, number, number]> = [
  ["Palo Alto", -122.143, 37.4419],
  ["Mountain View", -122.0819, 37.3894],
  ["Sunnyvale", -122.0363, 37.3688],
  ["Santa Clara", -121.9552, 37.3541],
  ["Cupertino", -122.0322, 37.323],
  ["Los Altos", -122.1141, 37.3852],
  ["Los Altos Hills", -122.1372, 37.3797],
  ["Menlo Park", -122.1817, 37.453],
  ["Campbell", -121.95, 37.2872],
];
for (const [name, lng, lat] of inside) {
  assert.ok(pointInPolygon([lng, lat], geom), `${name} center should be INSIDE the boundary`);
}

// Outside: deliberately-excluded neighbors (San Jose core; Redwood City up the Peninsula).
const outside: Array<[string, number, number]> = [
  ["San Jose", -121.8863, 37.3382],
  ["Redwood City", -122.2364, 37.4852],
];
for (const [name, lng, lat] of outside) {
  assert.ok(!pointInPolygon([lng, lat], geom), `${name} should be OUTSIDE the boundary`);
}

console.log(
  `✓ silicon-valley boundary OK — 1 feature, ${geom.coordinates.length} parts, 9 inside / 2 outside checks passed`,
);
