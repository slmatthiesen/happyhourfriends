/**
 * Runnable check: canonicalNeighborhoodKey + planNameClusters — the pure planning layer
 * behind stage 0 of assignNeighborhoods. Folds spelling/punctuation variants of the same
 * Google neighborhood name into one cluster, detects synonym-of-district names
 * ("Camelback East Village" → Camelback East, "Downtown Oakland" → Downtown), and applies
 * curated display/merge overrides. Pure logic — no DB, no network.
 *
 * Run: tsx scripts/test-neighborhood-canonical.ts — exits non-zero on any failure.
 */
import assert from "node:assert/strict";
import {
  canonicalNeighborhoodKey,
  planNameClusters,
  type DistrictRow,
} from "@/lib/geo/neighborhoodCanonical";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------- canonical key

check("strips punctuation and case", () => {
  assert.equal(canonicalNeighborhoodKey("Saint Philip's Plaza"), "saintphilipsplaza");
  assert.equal(canonicalNeighborhoodKey("Blenman-Elm"), "blenmanelm");
});

check("expands leading St to Saint, trailing St to Street", () => {
  assert.equal(canonicalNeighborhoodKey("St. Philip's Plaza"), "saintphilipsplaza");
  assert.equal(canonicalNeighborhoodKey("Harrison St"), "harrisonstreet");
});

check("expands street-word abbreviations (Blvd, Ave, Mt, Ft, Hwy, Pkwy)", () => {
  assert.equal(canonicalNeighborhoodKey("Broadway BLVD"), "broadwayboulevard");
  assert.equal(
    canonicalNeighborhoodKey("Broadway Boulevard"),
    canonicalNeighborhoodKey("Broadway Blvd"),
  );
  assert.equal(canonicalNeighborhoodKey("Mt. Lemmon"), "mountlemmon");
  assert.equal(canonicalNeighborhoodKey("Ft Lowell"), "fortlowell");
  assert.equal(canonicalNeighborhoodKey("Oakland Ave"), "oaklandavenue");
});

check("strips diacritics so accent variants collide", () => {
  assert.equal(
    canonicalNeighborhoodKey("Barrio Histórico District"),
    canonicalNeighborhoodKey("Barrio Historico District"),
  );
});

// ---------------------------------------------------------------- cluster folding

const noDistricts: DistrictRow[] = [];

check("folds levenshtein-1 spelling variants into one cluster (St. Philip's case)", () => {
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [
      { name: "Saint Phillips Plaza", venues: 5 },
      { name: "Saint Philip's Plaza", venues: 2 },
    ],
    districts: noDistricts,
  });
  assert.equal(clusters.length, 1);
  const c = clusters[0];
  assert.equal(c.venues, 7);
  assert.deepEqual([...c.names].sort(), ["Saint Philip's Plaza", "Saint Phillips Plaza"]);
  // No override: the most frequent raw variant is the display name.
  assert.equal(c.displayName, "Saint Phillips Plaza");
});

check("display override (keyed by any member's canonical key) beats frequency", () => {
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [
      { name: "Saint Phillips Plaza", venues: 5 },
      { name: "Saint Philip's Plaza", venues: 2 },
    ],
    districts: noDistricts,
    overrides: { display: { saintphilipsplaza: "St. Philip's Plaza" } },
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].displayName, "St. Philip's Plaza");
});

check("does NOT fold distance-2 names (East Central vs West Central)", () => {
  const clusters = planNameClusters({
    cityName: "Spokane",
    minVenues: 2,
    googleNames: [
      { name: "East Central", venues: 7 },
      { name: "West Central", venues: 3 },
    ],
    districts: noDistricts,
  });
  assert.equal(clusters.length, 2);
});

check("does NOT fuzzy-fold short keys (guard against false merges)", () => {
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [
      { name: "Vail", venues: 3 },
      { name: "Bail", venues: 2 },
    ],
    districts: noDistricts,
  });
  assert.equal(clusters.length, 2);
});

check("cluster-level critical mass: two 1-venue variants of one name qualify together", () => {
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [
      { name: "Saint Phillips Plaza", venues: 1 },
      { name: "Saint Philip's Plaza", venues: 1 },
    ],
    districts: noDistricts,
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].venues, 2);
});

check("below-threshold clusters are dropped", () => {
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [{ name: "Motel District", venues: 1 }],
    districts: noDistricts,
  });
  assert.equal(clusters.length, 0);
});

// ---------------------------------------------------------------- synonym detection

const camelbackEast: DistrictRow = {
  id: "d1",
  name: "Camelback East",
  slug: "camelback-east",
  tier: "coarse",
  hasPolygon: true,
  source: "City of Phoenix GIS — Urban Villages",
};

check("trailing 'Village' synonym of a coarse polygon district is proposed", () => {
  const clusters = planNameClusters({
    cityName: "Central Phoenix",
    minVenues: 2,
    googleNames: [{ name: "Camelback East Village", venues: 36 }],
    districts: [camelbackEast],
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].synonymOf?.slug, "camelback-east");
});

check("bare/article 'Village' names are never stripped to a synonym", () => {
  const clusters = planNameClusters({
    cityName: "Central Phoenix",
    minVenues: 2,
    googleNames: [{ name: "The Village", venues: 4 }],
    districts: [camelbackEast],
  });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].synonymOf, undefined);
});

check("city-name token synonym: 'Downtown Oakland' → coarse Downtown", () => {
  const downtown: DistrictRow = {
    id: "d2",
    name: "Downtown",
    slug: "downtown",
    tier: "coarse",
    hasPolygon: true,
    source: "Generated cardinal district",
  };
  const clusters = planNameClusters({
    cityName: "Oakland",
    minVenues: 2,
    googleNames: [{ name: "Downtown Oakland", venues: 13 }],
    districts: [downtown],
  });
  assert.equal(clusters[0].synonymOf?.slug, "downtown");
});

check("exact coarse-district name match is a synonym (South Scottsdale rule)", () => {
  const south: DistrictRow = {
    id: "d3",
    name: "South Scottsdale",
    slug: "south-scottsdale",
    tier: "coarse",
    hasPolygon: true,
    source: "Zillow Neighborhood Boundaries (CC BY-SA 3.0)",
  };
  const clusters = planNameClusters({
    cityName: "Scottsdale",
    minVenues: 2,
    googleNames: [{ name: "South Scottsdale", venues: 81 }],
    districts: [south],
  });
  assert.equal(clusters[0].synonymOf?.slug, "south-scottsdale");
});

check("synonym is only proposed against coarse polygon districts, not fine rows", () => {
  const arcadiaFine: DistrictRow = {
    id: "d4",
    name: "Arcadia",
    slug: "arcadia",
    tier: "fine",
    hasPolygon: true,
    source: "OpenStreetMap (ODbL)",
  };
  const clusters = planNameClusters({
    cityName: "Central Phoenix",
    minVenues: 2,
    googleNames: [{ name: "Arcadia Village", venues: 3 }],
    districts: [arcadiaFine],
  });
  assert.equal(clusters[0].synonymOf, undefined);
});

// ---------------------------------------------------------------- curated merges

check("curated merge override targets a district by slug", () => {
  const cdp: DistrictRow = {
    id: "d5",
    name: "Catalina Foothills",
    slug: "catalina-foothills",
    tier: "coarse",
    hasPolygon: true,
    source: "US Census TIGER 2023 Places (CDP)",
  };
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [{ name: "Catalina Foothills Estates", venues: 6 }],
    districts: [cdp],
    overrides: { mergeIntoSlug: { catalinafoothillsestates: "catalina-foothills" } },
  });
  assert.equal(clusters[0].curatedInto?.id, "d5");
  assert.equal(clusters[0].synonymOf, undefined);
});

// ---------------------------------------------------------------- existing-row attach

check("attaches to the existing fine row matching the cluster key, preferring name==display", () => {
  const rowA: DistrictRow = {
    id: "r-apos",
    name: "Saint Philip's Plaza",
    slug: "saint-philip-s-plaza",
    tier: "fine",
    hasPolygon: false,
    source: "Google Places",
  };
  const rowB: DistrictRow = {
    id: "r-noapos",
    name: "Saint Phillips Plaza",
    slug: "saint-phillips-plaza",
    tier: "fine",
    hasPolygon: false,
    source: "Google Places",
  };
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [
      { name: "Saint Phillips Plaza", venues: 5 },
      { name: "Saint Philip's Plaza", venues: 2 },
    ],
    districts: [rowA, rowB],
  });
  assert.equal(clusters.length, 1);
  // Display is the frequency pick ("Saint Phillips Plaza"), so attach prefers rowB.
  assert.equal(clusters[0].attachTo?.id, "r-noapos");
});

check("attach prefers a polygon-bearing imported row over a polygon-less Google row", () => {
  const imported: DistrictRow = {
    id: "r-gis",
    name: "West University",
    slug: "west-university",
    tier: "fine",
    hasPolygon: true,
    source: "City of Tucson / Pima County GIS — Neighborhood Associations",
  };
  const googleRow: DistrictRow = {
    id: "r-goog",
    name: "West University",
    slug: "west-university-2",
    tier: "fine",
    hasPolygon: false,
    source: "Google Places",
  };
  const clusters = planNameClusters({
    cityName: "Tucson",
    minVenues: 2,
    googleNames: [{ name: "West University", venues: 6 }],
    districts: [imported, googleRow],
  });
  assert.equal(clusters[0].attachTo?.id, "r-gis");
});

console.log(`\nAll ${passed} neighborhood-canonical checks passed.`);
