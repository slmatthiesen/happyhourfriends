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
