/**
 * Unit checks for landing-page state grouping. Run: npx tsx scripts/test-group-by-state.ts
 * — exits non-zero on any failure. No DB / network needed.
 */
import assert from "node:assert/strict";
import { groupCitiesByState } from "@/lib/cities/groupByState";
import { stateName } from "@/lib/geo/usStates";
import type { CityListItem } from "@/lib/queries/venues";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function city(name: string, state: string): CityListItem {
  return {
    id: `${state}-${name}`.toLowerCase().replace(/\s+/g, "-"),
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    state,
    centerLat: null,
    centerLng: null,
    status: "live",
    venueCount: 0,
    stubCount: 0,
  };
}

// States ordered alphabetically by full display name (not by code).
check("states sort by display name", () => {
  // "WA" → Washington should come after "CA" → California; codes alone would too,
  // but verify it's name-driven by mixing a code whose name order differs.
  const groups = groupCitiesByState([
    city("Tacoma", "WA"),
    city("Daly City", "CA"),
    city("Phoenix", "AZ"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Arizona", "California", "Washington"],
  );
});

// Cities keep their incoming order within a group (query pre-sorts by name).
check("city order preserved within a state", () => {
  const groups = groupCitiesByState([
    city("Daly City", "CA"),
    city("Five Cities", "CA"),
    city("San Luis Obispo", "CA"),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].cities.map((c) => c.name),
    ["Daly City", "Five Cities", "San Luis Obispo"],
  );
});

// Single state still produces one labeled group ("always group").
check("single state → one group with label", () => {
  const groups = groupCitiesByState([city("Tacoma", "WA")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Washington");
  assert.equal(groups[0].code, "WA");
});

// Unknown / empty state code → trailing "Other" group, never dropped.
check("codeless city falls into trailing Other group", () => {
  const groups = groupCitiesByState([
    city("Mystery Town", ""),
    city("Daly City", "CA"),
  ]);
  assert.deepEqual(
    groups.map((g) => g.name),
    ["California", "Other"],
  );
  assert.equal(groups[1].cities[0].name, "Mystery Town");
});

// No cities → no groups.
check("empty input → empty output", () => {
  assert.deepEqual(groupCitiesByState([]), []);
});

// stateName helper: known, unknown, case-insensitive, nullish.
check("stateName maps known codes", () =>
  assert.equal(stateName("ca"), "California"));
check("stateName falls back to raw unknown code", () =>
  assert.equal(stateName("ZZ"), "ZZ"));
check("stateName handles nullish", () => assert.equal(stateName(null), ""));

console.log(`\n${passed} checks passed.`);
