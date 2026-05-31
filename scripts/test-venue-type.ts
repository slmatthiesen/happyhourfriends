/**
 * Runnable unit checks for the venue-type derivation + labels (no test framework in
 * repo). Run: npx tsx scripts/test-venue-type.ts  — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  deriveVenueType,
  isVenueType,
  labelForVenueType,
  VENUE_TYPES,
  VENUE_TYPE_LABELS,
} from "@/lib/places/venueType";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- Google primaryType map ------------------------------------------------
check("primaryType bar -> bar", () =>
  assert.equal(deriveVenueType({ primaryType: "bar", types: null, name: "X" }), "bar"));
check("sports_bar -> sports_bar", () =>
  assert.equal(deriveVenueType({ primaryType: "sports_bar", types: null, name: "X" }), "sports_bar"));
check("cocktail_bar -> cocktail_lounge", () =>
  assert.equal(deriveVenueType({ primaryType: "cocktail_bar", types: null, name: "X" }), "cocktail_lounge"));
check("lounge_bar -> cocktail_lounge", () =>
  assert.equal(deriveVenueType({ primaryType: "lounge_bar", types: null, name: "X" }), "cocktail_lounge"));
check("night_club -> club", () =>
  assert.equal(deriveVenueType({ primaryType: "night_club", types: null, name: "X" }), "club"));
check("irish_pub -> pub", () =>
  assert.equal(deriveVenueType({ primaryType: "irish_pub", types: null, name: "X" }), "pub"));
check("brewery -> brewery", () =>
  assert.equal(deriveVenueType({ primaryType: "brewery", types: null, name: "X" }), "brewery"));
check("pizza_restaurant -> pizzeria", () =>
  assert.equal(deriveVenueType({ primaryType: "pizza_restaurant", types: null, name: "X" }), "pizzeria"));
check("gastropub -> gastropub", () =>
  assert.equal(deriveVenueType({ primaryType: "gastropub", types: null, name: "X" }), "gastropub"));
check("coffee_shop -> cafe", () =>
  assert.equal(deriveVenueType({ primaryType: "coffee_shop", types: null, name: "X" }), "cafe"));

// --- restaurant fallback (generic + *_restaurant tail) ---------------------
check("mexican_restaurant -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "mexican_restaurant", types: null, name: "X" }), "restaurant"));
check("bar_and_grill -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "bar_and_grill", types: null, name: "X" }), "restaurant"));
check("steak_house -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "steak_house", types: null, name: "X" }), "restaurant"));
check("fine_dining_restaurant -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: "fine_dining_restaurant", types: null, name: "X" }), "restaurant"));

// --- types[] fallback when primaryType is null -----------------------------
check("types[] brewery wins when primaryType null", () =>
  assert.equal(
    deriveVenueType({ primaryType: null, types: ["point_of_interest", "brewery"], name: "X" }),
    "brewery",
  ));

// --- name keywords when no Google type -------------------------------------
check("name 'Harmon Brewing' -> brewery", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Harmon Brewing Co" }), "brewery"));
check("name 'The Swiss Pub' -> pub", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "The Swiss Pub" }), "pub"));
check("name 'Moctezuma's Tequila Bar' -> bar", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Moctezuma's Tequila Bar" }), "bar"));
check("name 'Sports Bar X' beats generic bar -> sports_bar", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Joe's Sports Bar" }), "sports_bar"));
check("name 'Engine House Brewpub' -> brewery (brewpub beats pub)", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Engine House Brewpub" }), "brewery"));

// --- final default ---------------------------------------------------------
check("no signal -> restaurant", () =>
  assert.equal(deriveVenueType({ primaryType: null, types: null, name: "Stanley & Seafort's" }), "restaurant"));

// --- enum guard ------------------------------------------------------------
check("isVenueType true for 'pub'", () => assert.equal(isVenueType("pub"), true));
check("isVenueType false for 'gastro_pub'", () => assert.equal(isVenueType("gastro_pub"), false));
check("isVenueType false for null", () => assert.equal(isVenueType(null), false));

// --- labels ----------------------------------------------------------------
check("labels exhaustive over enum", () => {
  for (const t of VENUE_TYPES) assert.ok(VENUE_TYPE_LABELS[t], `missing label for ${t}`);
});
check("dive_bar label is 'Dive'", () => assert.equal(VENUE_TYPE_LABELS.dive_bar, "Dive"));
check("cocktail_lounge label is 'Cocktails'", () => assert.equal(VENUE_TYPE_LABELS.cocktail_lounge, "Cocktails"));
check("hotel_bar label is 'Hotel'", () => assert.equal(VENUE_TYPE_LABELS.hotel_bar, "Hotel"));
check("other label is 'Venue'", () => assert.equal(VENUE_TYPE_LABELS.other, "Venue"));
check("labelForVenueType(null) is ''", () => assert.equal(labelForVenueType(null), ""));
check("labelForVenueType('pub') is 'Pub'", () => assert.equal(labelForVenueType("pub"), "Pub"));

console.log(`\n${passed} checks passed.`);
