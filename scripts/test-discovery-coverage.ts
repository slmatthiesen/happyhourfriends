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
  DEFAULT_MAX_TILES,
  type Tile,
} from "@/lib/places/discoveryTiling";
import { haversineMeters } from "@/lib/geo/distance";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }
async function checkAsync(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`  ✓ ${name}`); }

async function main() {
  check("splitTile returns 4 children at r/√2 radius, depth+1, offset from center", () => {
    const parent: Tile = { lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 };
    const kids = splitTile(parent);
    assert.equal(kids.length, 4, "four children");
    for (const k of kids) {
      // Child radius = r/√2 (NOT r/2) so the four child circles fully cover the parent
      // circle (the cardinal extremes sit exactly r/√2 from the nearest child center).
      assert.ok(Math.abs(k.radiusMeters - 3000 * Math.SQRT1_2) < 1, "radius shrunk by 1/√2");
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
    assert.equal(DEFAULT_MAX_TILES, 2000, "runaway-tile safety cap default");
  });

  // --- collectAdaptive ------------------------------------------------------------
  interface MockVenue { id: string; lat: number; lng: number }

  /** 30 venues scattered in a ~1.8km grid around a center. */
  function makeCluster(centerLat: number, centerLng: number): MockVenue[] {
    const latPerM = 1 / 111_320;
    const lngPerM = 1 / (111_320 * Math.cos((centerLat * Math.PI) / 180));
    const out: MockVenue[] = [];
    let n = 0;
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 5; j++) {
        out.push({
          id: `v${n++}`,
          lat: centerLat + (i - 2.5) * 300 * latPerM,
          lng: centerLng + (j - 2) * 300 * lngPerM,
        });
      }
    }
    return out; // 30 venues
  }

  /** Mock Places: nearest `MAX_RESULTS` venues within the tile radius (mimics the cap). */
  function mockFetch(venues: MockVenue[]) {
    return async (tile: Tile): Promise<MockVenue[]> =>
      venues
        .map((v) => ({ v, d: haversineMeters({ lat: tile.lat, lng: tile.lng }, { lat: v.lat, lng: v.lng }) }))
        .filter((x) => x.d <= tile.radiusMeters)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_RESULTS)
        .map((x) => x.v);
  }

  await checkAsync("a single big tile truncates at the 20-result cap", async () => {
    const venues = makeCluster(47.25, -122.44);
    const oneShot = await mockFetch(venues)({ lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 });
    assert.equal(oneShot.length, MAX_RESULTS, "the flat call sees only 20 of the 30 venues");
  });

  await checkAsync("collectAdaptive recovers past the cap and de-dups by id", async () => {
    const venues = makeCluster(47.25, -122.44);
    const collected = await collectAdaptive<MockVenue>({
      seedTiles: [{ lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 }],
      fetchTile: mockFetch(venues),
    });
    assert.ok(collected.size > MAX_RESULTS, `recovered more than ${MAX_RESULTS} (got ${collected.size})`);
    assert.ok(collected.size <= venues.length, "never invents venues");
    for (const [id, v] of collected) assert.equal(id, v.id, "map keyed on the venue's own id");
  });

  await checkAsync("onFloorSaturated fires (not subdivide) for a saturated floor tile", async () => {
    let floorHits = 0;
    let fetches = 0;
    const collected = await collectAdaptive<MockVenue>({
      seedTiles: [{ lat: 47.25, lng: -122.44, radiusMeters: MIN_RADIUS_METERS, depth: MAX_DEPTH }],
      fetchTile: async () => {
        fetches++;
        return Array.from({ length: MAX_RESULTS }, (_, i) => ({ id: `f${i}`, lat: 0, lng: 0 }));
      },
      onFloorSaturated: () => { floorHits++; },
    });
    assert.equal(fetches, 1, "floor tile is queried once and NOT subdivided");
    assert.equal(floorHits, 1, "floor saturation reported");
    assert.equal(collected.size, MAX_RESULTS, "its results are still collected");
  });

  await checkAsync("radius floor (not depth) also stops subdivision", async () => {
    let floorHits = 0;
    let fetches = 0;
    await collectAdaptive<MockVenue>({
      // depth is BELOW the cap, but a 400m tile's children (~283m) are below the radius floor.
      seedTiles: [{ lat: 47.25, lng: -122.44, radiusMeters: MIN_RADIUS_METERS, depth: MAX_DEPTH - 1 }],
      fetchTile: async () => {
        fetches++;
        return Array.from({ length: MAX_RESULTS }, (_, i) => ({ id: `r${i}`, lat: 0, lng: 0 }));
      },
      onFloorSaturated: () => { floorHits++; },
    });
    assert.equal(fetches, 1, "radius-floor tile queried once and NOT subdivided");
    assert.equal(floorHits, 1, "radius-floor saturation reported");
  });

  await checkAsync("maxTiles guard throws on runaway subdivision", async () => {
    await assert.rejects(
      collectAdaptive<MockVenue>({
        seedTiles: [{ lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 }],
        fetchTile: async () => Array.from({ length: MAX_RESULTS }, (_, i) => ({ id: `x${i}`, lat: 0, lng: 0 })),
        maxTiles: 3,
      }),
      /exceeded 3 tiles/,
      "aborts before runaway Places spend",
    );
  });

  // --- airport gate ---------------------------------------------------------------
  {
    const { isWithinAirportBuffer, AIRPORT_BUFFER_METERS } = await import("@/lib/places/airportGate");
    // SEA-TAC airport point.
    const seatac = [{ lat: 47.4480, lng: -122.3088 }];

    check("isWithinAirportBuffer drops a point inside the buffer", () => {
      // ~200m north of the airport point — clearly inside 1500m.
      assert.equal(isWithinAirportBuffer(47.4498, -122.3088, seatac), true);
    });
    check("isWithinAirportBuffer keeps a point outside the buffer (Airport Tavern case)", () => {
      // Tacoma's Airport Tavern is ~10km from SEA-TAC — well outside 1500m.
      assert.equal(isWithinAirportBuffer(47.2100, -122.4600, seatac), false);
    });
    check("isWithinAirportBuffer is a no-op when no airports are known", () => {
      assert.equal(isWithinAirportBuffer(47.4498, -122.3088, []), false);
    });
    check("AIRPORT_BUFFER_METERS is the agreed 1500m", () => {
      assert.equal(AIRPORT_BUFFER_METERS, 1500);
    });
  }

  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
