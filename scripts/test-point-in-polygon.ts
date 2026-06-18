/**
 * test-point-in-polygon — hermetic ($0, no DB/network) checks on the crossover geometry
 * used by seed:discover. Synthetic square (inside/outside/hole) + real boundary files
 * (data/*-boundary.geojson, read from disk) to prove a point lands in the right city.
 *
 * Run: pnpm tsx scripts/test-point-in-polygon.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pointInPolygon,
  bboxOf,
  inBBox,
  geometryFromGeoJson,
  type PolygonLike,
} from "@/lib/geo/pointInPolygon";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const square: PolygonLike = {
  type: "Polygon",
  // outer 0,0..10,10 with a hole 4,4..6,6
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ],
};

check("synthetic square: inside / outside / hole", () => {
  assert.equal(pointInPolygon([5, 1], square), true, "inside, below the hole");
  assert.equal(pointInPolygon([15, 5], square), false, "outside");
  assert.equal(pointInPolygon([5, 5], square), false, "inside the hole = not contained");
});

check("bbox reject is consistent with containment", () => {
  const b = bboxOf(square);
  assert.deepEqual(b, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.equal(inBBox([5, 1], b), true);
  assert.equal(inBBox([15, 5], b), false);
});

function loadCity(slug: string): PolygonLike {
  return geometryFromGeoJson(JSON.parse(readFileSync(`data/${slug}-boundary.geojson`, "utf8")));
}

check("real boundaries: a point lands in exactly one city", () => {
  const oakland = loadCity("oakland");
  const dalyCity = loadCity("daly-city");
  const oaklandCityHall: [number, number] = [-122.2712, 37.8044];
  const rockridge: [number, number] = [-122.2517, 37.8449]; // College Ave — Oakland's north edge
  const sf: [number, number] = [-122.4194, 37.7749];

  assert.equal(pointInPolygon(oaklandCityHall, oakland), true, "City Hall ∈ Oakland");
  assert.equal(pointInPolygon(oaklandCityHall, dalyCity), false, "City Hall ∉ Daly City");
  assert.equal(pointInPolygon(rockridge, oakland), true, "Rockridge ∈ Oakland (the crossover case)");
  assert.equal(pointInPolygon(sf, oakland), false, "SF ∉ Oakland");
  assert.equal(pointInPolygon(sf, dalyCity), false, "SF ∉ Daly City");
});

console.log(`\n${passed} checks passed.`);
