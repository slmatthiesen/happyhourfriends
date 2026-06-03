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
let minLat = 90,
  maxLat = -90,
  minLng = 180,
  maxLng = -180;
function walk(coords: unknown): void {
  if (typeof (coords as number[])[0] === "number") {
    const [lng, lat] = coords as [number, number];
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    return;
  }
  for (const c of coords as unknown[]) walk(c);
}
for (const f of fc.features) {
  assert.ok(
    ["Polygon", "MultiPolygon"].includes(f.geometry.type),
    `bad geom type ${f.geometry.type}`,
  );
  walk(f.geometry.coordinates);
}

// Daly City + Colma sit roughly within 37.64-37.71 N, -122.51--122.42 W. Assert the
// bbox is inside a slightly padded window — a San Francisco or wrong-state polygon fails.
assert.ok(minLat > 37.6 && maxLat < 37.73, `lat out of range: ${minLat}..${maxLat}`);
assert.ok(minLng > -122.55 && maxLng < -122.4, `lng out of range: ${minLng}..${maxLng}`);

console.log(
  `✓ boundary OK — bbox lat ${minLat.toFixed(4)}..${maxLat.toFixed(4)}, lng ${minLng.toFixed(4)}..${maxLng.toFixed(4)}`,
);
