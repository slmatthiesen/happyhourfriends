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
      // r/√2 children centered at ±r/2 FULLY cover the parent (no center hole) at no extra call
      // count — the fix for the Fuji-class blind spot. r/√2 of 3000 ≈ 2121.32m.
      assert.ok(Math.abs(k.radiusMeters - 3000 / Math.SQRT2) < 0.01, "r/√2 radius");
      assert.equal(k.depth, 1, "depth + 1");
      assert.notEqual(k.lat, parent.lat, "lat offset from parent");
      assert.notEqual(k.lng, parent.lng, "lng offset from parent");
    }
    assert.equal(new Set(kids.map((k) => k.lat)).size, 2, "two distinct child latitudes");
    assert.equal(new Set(kids.map((k) => k.lng)).size, 2, "two distinct child longitudes");
  });

  check("child circles fully cover the parent's center (no blind-spot hole)", () => {
    // The old r/2 geometry left a ~620m uncovered hole around the parent center; r/√2 closes it.
    const parent: Tile = { lat: 47.25, lng: -122.44, radiusMeters: 3000, depth: 0 };
    const kids = splitTile(parent);
    const nearestChildToCenter = Math.min(
      ...kids.map((k) => haversineMeters({ lat: parent.lat, lng: parent.lng }, { lat: k.lat, lng: k.lng })),
    );
    // The parent center is inside (at the corner of) each child circle → covered.
    assert.ok(nearestChildToCenter <= kids[0].radiusMeters + 1, "parent center lies within a child circle");
  });

  check("tiling constants are the agreed completeness-leaning defaults", () => {
    assert.equal(MAX_RESULTS, 20, "Google Places per-call cap");
    assert.equal(MIN_RADIUS_METERS, 700, "subdivision floor radius");
    assert.equal(MAX_DEPTH, 2, "max recursion depth (two subdivision levels — closes the blind spot)");
    assert.equal(DEFAULT_MAX_TILES, 300, "runaway-tile safety cap default");
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

  await checkAsync("recovers a venue in the old center-hole blind spot (Fuji case)", async () => {
    // A saturated 3000m seed tile whose nearest-20 are all within ~480m, plus ONE target venue
    // at 549m from center — just past the truncation. Under the old r/2 + depth-1 geometry this
    // venue fell in the uncovered center hole and was never re-queried. The r/√2 + depth-2 fix
    // must recover it. (Deterministic: no PRNG.)
    const centerLat = 38.5816, centerLng = -121.4944;
    const latPerM = 1 / 111_320;
    const lngPerM = 1 / (111_320 * Math.cos((centerLat * Math.PI) / 180));
    const at = (dxE: number, dyN: number) => ({ lat: centerLat + dyN * latPerM, lng: centerLng + dxE * lngPerM });
    const venues: MockVenue[] = [];
    // 24 core venues on a tight ring 300–470m out (all closer than the target → they fill the cap).
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const rad = 300 + (i % 6) * 30; // 300..470m
      const p = at(Math.cos(ang) * rad, Math.sin(ang) * rad);
      venues.push({ id: `core${i}`, ...p });
    }
    const target = at(549 / Math.SQRT2, 549 / Math.SQRT2); // 549m diagonal
    venues.push({ id: "FUJI", ...target });

    // A single flat call truncates the target away (it is the 25th-nearest, cap is 20).
    const flat = await mockFetch(venues)({ lat: centerLat, lng: centerLng, radiusMeters: 3000, depth: 0 });
    assert.equal(flat.length, MAX_RESULTS, "flat call is saturated (truncated)");
    assert.ok(!flat.some((v) => v.id === "FUJI"), "flat call DROPS the blind-spot venue");

    // Adaptive tiling with the fixed geometry recovers it.
    const collected = await collectAdaptive<MockVenue>({
      seedTiles: [{ lat: centerLat, lng: centerLng, radiusMeters: 3000, depth: 0 }],
      fetchTile: mockFetch(venues),
    });
    assert.ok(collected.has("FUJI"), "adaptive tiling recovers the blind-spot venue");
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
      // depth is BELOW the cap, but a 700m tile's children (~495m = r/√2) are below the radius floor.
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

  // --- broadened denylists --------------------------------------------------------
  {
    const { isLikelyNoHappyHourFormat, isExcludedByPlaceType } = await import("@/lib/places/chainDenylist");

    check("adult-club name patterns are dropped", () => {
      assert.equal(isLikelyNoHappyHourFormat("Dreamgirls Strip Club"), true);
      assert.equal(isLikelyNoHappyHourFormat("Showgirls"), true);
      assert.equal(isLikelyNoHappyHourFormat("Club Nude"), true);
      assert.equal(isLikelyNoHappyHourFormat("Pink Pony Cabaret"), true); // existing pattern still works
      assert.equal(isLikelyNoHappyHourFormat("Nude Nightclub"), true); // start-of-name match
    });
    check("'nude' does not match the substring inside 'denude' / legit names", () => {
      assert.equal(isLikelyNoHappyHourFormat("Denude Spa"), false);
      assert.equal(isLikelyNoHappyHourFormat("The Tavern Lounge"), false); // lounge intentionally allowed
    });
    check("casino name pattern is dropped", () => {
      assert.equal(isLikelyNoHappyHourFormat("Emerald Queen Casino"), true);
    });
    check("donut / truck name patterns are dropped (but not 'Truckee')", () => {
      assert.equal(isLikelyNoHappyHourFormat("Hibachi Truck"), true);
      assert.equal(isLikelyNoHappyHourFormat("Krispy Kreme Donuts"), true);
      assert.equal(isLikelyNoHappyHourFormat("Bob's Doughnuts"), true);
      assert.equal(isLikelyNoHappyHourFormat("Truckee Tavern"), false); // token-aware, not a substring
    });
    check("casino place type is dropped even with an alcohol-signal primary type", () => {
      // A casino's bar would otherwise be KEPT by the alcohol-signal override; the casino
      // type rule runs first so the operator's "never include casinos" rule wins.
      assert.equal(isExcludedByPlaceType("bar", ["bar", "casino"]), true);
      assert.equal(isExcludedByPlaceType("casino", ["casino"]), true);
      assert.equal(isExcludedByPlaceType(null, ["casino"]), true);
    });
    check("a normal bar is still kept", () => {
      assert.equal(isExcludedByPlaceType("bar", ["bar", "restaurant"]), false);
    });
    check("member-only org names are dropped (lodges type as plain `bar`)", () => {
      assert.equal(isLikelyNoHappyHourFormat("Elks Lodge #2532"), true);
      assert.equal(isLikelyNoHappyHourFormat("Elks club"), true);
      assert.equal(isLikelyNoHappyHourFormat("Elks4777"), true); // digit-attached, regex form
      assert.equal(isLikelyNoHappyHourFormat("VFW Post 97"), true);
      assert.equal(isLikelyNoHappyHourFormat("American Legion Post 41"), true);
      assert.equal(isLikelyNoHappyHourFormat("Moose Lodge 708"), true);
      assert.equal(isLikelyNoHappyHourFormat("Fraternal Order of Eagles Aerie 2197"), true);
      assert.equal(isLikelyNoHappyHourFormat("Tucson Lodge No. 4 F & AM"), true); // masonic naming
      assert.equal(isLikelyNoHappyHourFormat("Knights of Columbus Hall"), true);
    });
    check("public venues with org-adjacent names are kept", () => {
      assert.equal(isLikelyNoHappyHourFormat("McMenamins Pub at Elks Temple"), false); // tacoma, live HH
      assert.equal(isLikelyNoHappyHourFormat("The Eagles Nest Bar"), false);
      assert.equal(isLikelyNoHappyHourFormat("The Lodge Sasquatch Kitchen"), false);
      assert.equal(isLikelyNoHappyHourFormat("Post Malone's Tavern"), false);
      assert.equal(isLikelyNoHappyHourFormat("Oddfellows Cafe & Bar"), false); // lodge-form only
    });
    check("member-only orgs caught by website DOMAIN even with a non-fraternal name", () => {
      // Tacoma 2026-07-06: "Chappie's Lounge Post 1" is an AMVETS Post 1 bar — the
      // affiliation only shows up in the domain, not the name.
      assert.equal(isLikelyNoHappyHourFormat("Chappie's Lounge Post 1", "https://www.amvetswa.org/post1chappies"), true);
      assert.equal(isLikelyNoHappyHourFormat("The Barrel Room", "https://vfwpost1234.org/bar"), true);
      assert.equal(isLikelyNoHappyHourFormat("Legion Hall Tavern", "http://americanlegion-post99.org/"), true);
      // A normal bar with an unrelated domain is unaffected.
      assert.equal(isLikelyNoHappyHourFormat("The Barrel Room", "https://thebarrelroom.com/"), false);
      // No website on file — domain check is a no-op, name check still applies.
      assert.equal(isLikelyNoHappyHourFormat("The Barrel Room", null), false);
    });
  }

  // --- Daly City review: junk-type excludes + hard review gate --------------------
  {
    const { isExcludedByPlaceType, isLowSignalCandidate } = await import("@/lib/places/chainDenylist");
    check("non-food / dessert / deli / salad types are dropped", () => {
      for (const t of ["dessert_restaurant","dessert_shop","deli","salad_shop","shopping_mall","clothing_store","service","catering_service","laundry","grocery_store","supermarket","convenience_store"]) {
        assert.equal(isExcludedByPlaceType(t, [t, "restaurant"]), true, t + " should be excluded");
      }
    });
    check("a real bar/restaurant primary type is still kept", () => {
      assert.equal(isExcludedByPlaceType("bar", ["bar"]), false);
      assert.equal(isExcludedByPlaceType("mexican_restaurant", ["mexican_restaurant","restaurant"]), false);
    });
    check("isLowSignalCandidate is a hard <25-review cutoff", () => {
      assert.equal(isLowSignalCandidate(10), true, "10 reviews dropped");
      assert.equal(isLowSignalCandidate(24), true, "24 dropped");
      assert.equal(isLowSignalCandidate(25), false, "25 kept");
      assert.equal(isLowSignalCandidate(500), false, "500 kept");
      assert.equal(isLowSignalCandidate(null), true, "null treated as 0 -> dropped");
      assert.equal(isLowSignalCandidate(undefined), true, "undefined -> dropped");
    });
    check("isLowSignalCandidate keeps low-review venues that have an alcohol signal", () => {
      assert.equal(isLowSignalCandidate(3, "Cheers Bar & Grill", "sports_bar", null), false, "sports bar kept");
      assert.equal(isLowSignalCandidate(1, "BAR960", "cocktail_bar", null), false, "cocktail bar kept");
      assert.equal(isLowSignalCandidate(2, "43rd Street Pub", "bar", null), false, "pub kept");
      assert.equal(isLowSignalCandidate(0, "Evergreen State Brewing Taproom", "bar", null), false, "brewery/taproom kept by name");
      assert.equal(isLowSignalCandidate(5, "Joe's Diner", "diner", null), true, "low-review non-bar still dropped");
      assert.equal(isLowSignalCandidate(40, "Joe's Diner", "diner", null), false, ">=25 kept");
    });
  }

  console.log(`\n${passed} checks passed.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
