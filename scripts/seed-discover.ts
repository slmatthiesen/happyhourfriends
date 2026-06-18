/**
 * Stage A — Seed discovery for Tacoma (PRD §7.3).
 *
 * Resolves the city row by slug ("tacoma" by default) and queries the Google
 * Places API v1 "places:searchNearby" endpoint for bars and restaurants within
 * the city's bbox / center radius.  Every result is upserted into seed_candidates
 * keyed on google_place_id — completely idempotent (PRD §13: NEVER dedup by name).
 *
 * --curated flag additionally fetches the curated happy-hour list pages from
 * PRD §7.3, extracts candidate venue names with a text heuristic, and inserts
 * them as seed_candidates with googlePlaceId=null.
 *
 * Usage:
 *   tsx scripts/seed-discover.ts --city tacoma --state wa [--curated]
 *
 * Required env vars:
 *   DATABASE_URL           Postgres connection string
 *   GOOGLE_PLACES_API_KEY  Google Cloud Places API (New) key
 */
import "dotenv/config";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import {
  pointInPolygon,
  bboxOf,
  inBBox,
  geometryFromGeoJson,
  type PolygonLike,
  type BBox,
  type Position,
} from "@/lib/geo/pointInPolygon";
import {
  isDenylistedChain,
  isLikelyNoHappyHourFormat,
  isExcludedByPlaceType,
  isExcludedByBusinessStatus,
  isLowSignalCandidate,
} from "@/lib/places/chainDenylist";
import {
  collectAdaptive,
  MAX_DEPTH,
  type Tile,
} from "@/lib/places/discoveryTiling";
import {
  isWithinAirportBuffer,
  type GeoPoint,
} from "@/lib/places/airportGate";
import { haversineMeters } from "@/lib/geo/distance";
import { parseRegularOpeningHours } from "@/lib/places/placeDetails";
import { pickNeighborhood } from "@/lib/places/neighborhoodName";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface DiscoverArgs {
  curated: boolean;
  fresh: boolean;
  debugDrops: boolean;
  noHhRecall: boolean;
  hhRecallOnly: boolean;
  estimate: boolean;
  subTile: boolean;
  maxCalls: number;
}

function parseArgs(): DiscoverArgs {
  const argv = process.argv.slice(2);
  // Default ceiling on the HH-recall Text Search pass (NOT the Nearby sweep, which keeps its
  // own maxTiles guard). Whole-bbox = 3 calls; --sub-tile quadrants = 12; so 30 leaves room.
  let maxCalls = 30;
  const FLAGS = new Set([
    "--curated", "--fresh", "--debug-drops",
    "--hh-recall", "--no-hh-recall", "--hh-recall-only", "--estimate", "--sub-tile",
  ]);
  // Reject stray args. `seed:discover tucson` (no --city) silently ran Tacoma before — a
  // costly footgun (wrong city / wasted Places quota). The city MUST be --city + --state flags.
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--city" || tok === "--state") { i++; continue; } // these consume their value
    if (tok === "--max-calls") { maxCalls = Number(argv[++i]); continue; }
    if (FLAGS.has(tok)) continue;
    throw new Error(
      `Unexpected argument "${tok}". Pass the city as flags:\n` +
        `  npm run seed:discover -- --city <slug> --state <code>   (e.g. --city tucson --state az)\n` +
        `  HH recall runs by DEFAULT. Optional: --no-hh-recall | --hh-recall-only | --estimate | --sub-tile | --max-calls <n>`,
    );
  }
  return {
    curated: argv.includes("--curated"),
    // --fresh: clear this city's existing candidates first (re-discover from scratch,
    // e.g. after changing the type/area filters). Candidates already linked to a venue
    // are kept so we don't lose enrich results.
    fresh: argv.includes("--fresh"),
    debugDrops: argv.includes("--debug-drops"),
    // HH-targeted Text Search recall runs by DEFAULT so discovery is complete in one shot
    // (it's the lever that stops real anchors like Jack's San Mateo being silently truncated).
    // --no-hh-recall: Nearby sweep only (legacy behavior). --hh-recall-only: recall ONLY (skip
    // Nearby) — for cheaply backfilling an already-discovered city. (--hh-recall is now a no-op
    // alias, accepted for back-compat since recall is the default.)
    noHhRecall: argv.includes("--no-hh-recall"),
    hhRecallOnly: argv.includes("--hh-recall-only"),
    // --estimate: print the worst-case call count + cost and exit. Makes ZERO Google calls.
    estimate: argv.includes("--estimate"),
    // --sub-tile: split the city bbox into quadrants for the recall pass (beats the 60-result
    // cap for large cities). Off by default — whole-bbox is 3 calls.
    subTile: argv.includes("--sub-tile"),
    maxCalls: Number.isFinite(maxCalls) && maxCalls > 0 ? maxCalls : 30,
  };
}

// ---------------------------------------------------------------------------
// Curated source URLs (PRD §7.3)
// ---------------------------------------------------------------------------

const CURATED_SOURCES: string[] = [
  "https://wanderlog.com/list/geoCategory/1568034/best-spots-for-happy-hour-in-tacoma",
  "https://seattletravel.com/best-tacoma-happy-hours/",
  "https://ultimatehappyhours.com/location/tacoma/",
  "https://dropt.beer/insights/tacomas-happy-hour-havens-your-ultimate-guide-to-unwinding/",
  "https://www.yelp.com/search?find_desc=Happy+Hour+Bars&find_loc=Tacoma,+WA",
];

// ---------------------------------------------------------------------------
// Google Places API v1 types (subset we use)
// ---------------------------------------------------------------------------

interface PlaceResult {
  id?: string;               // google place id (e.g. "ChIJ...")
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;       // enum string, e.g. "PRICE_LEVEL_MODERATE"
  businessStatus?: string;   // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  // Atmosphere-tier fields — captured here so enrich needs no per-candidate Place
  // Details call (searchNearby bills per tile, Place Details per candidate).
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCocktails?: boolean;
  nationalPhoneNumber?: string;
  regularOpeningHours?: { periods?: { open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } }[] };
  addressComponents?: { longText: string; shortText?: string; types: string[] }[];
}

/** Google priceLevel enum → 1..4 (or null). Mirrors lib/places/placeDetails.ts. */
const PRICE_LEVEL: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

interface NearbySearchResponse {
  places?: PlaceResult[];
  // nextPageToken is not part of the v1 searchNearby response (pagination
  // is handled by the "maxResultCount" cap of 20 per call; use multiple
  // type queries instead).
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const PLACES_ENDPOINT =
  "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_SEARCH_ENDPOINT =
  "https://places.googleapis.com/v1/places:searchText";

// Shared Place field mask (Enterprise + Atmosphere tier). Reused by the Nearby sweep and
// the HH-recall Text Search so BOTH capture the same venue metadata (alcohol gate + hours +
// phone + neighborhood) in a single call — no per-candidate Place Details call in enrich.
const PLACE_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location," +
  "places.primaryType,places.types,places.websiteUri,places.rating," +
  "places.userRatingCount,places.priceLevel,places.businessStatus," +
  "places.servesBeer,places.servesWine,places.servesCocktails," +
  "places.nationalPhoneNumber,places.regularOpeningHours,places.addressComponents";

// Tacoma bbox (PRD §7.3 notes the city center + bbox from cities table).
// Fallback radius/bbox when the DB row has no bbox stored yet.
const TACOMA_FALLBACK = {
  lat: 47.2529,
  lng: -122.4443,
  radiusMeters: 15_000, // ~9 miles — covers Tacoma proper
};

// Per-city discovery config stored in cities.seed_config (JSONB). Falls back to the
// historical Tacoma defaults if absent so older city rows keep working.
//
// COVERAGE MODES (2026-06-01):
//   - BOUNDARY mode (preferred, scales to every city): if data/<city>-boundary.geojson
//     exists, discovery tiles over the boundary's bbox and gates each result with
//     ST_DWithin(boundary, point, serviceBufferMeters). One source of truth shared with
//     `scope:venues` (same file + same buffer), so coverage and pruning can't disagree.
//     This replaces the radius circle that silently dropped real far-but-in-city venues
//     (e.g. Bottega Michelangelo, 14.4km from Tucson's center → outside the 12km gate).
//   - RADIUS mode (legacy fallback): no boundary file → tile a radiusKm disk around the
//     city center and gate by mailing-locality regex + haversine radius (unreliable at
//     borders; kept only so cities without a boundary file still work).
interface SeedConfig {
  radiusKm: number;
  cellMeters: number;
  serviceLocalities: string[];
  // BOUNDARY mode: metres of buffer around the municipal boundary that still counts as
  // in-scope (captures contiguous suburbs the city line doesn't annex — e.g. Casas Adobes
  // for Tucson). MUST match scope:venues' buffer for the same city. Tune per city.
  serviceBufferMeters?: number;
}
const DEFAULT_SEED_CONFIG: SeedConfig = {
  radiusKm: 7,
  cellMeters: 3000,
  serviceLocalities: ["Tacoma", "Ruston"],
};
// Default boundary buffer when seed_config omits it. Small — geocode slop + immediately
// adjacent storefronts — NOT a metro radius. Cities with large unincorporated suburbs
// (Tucson → Casas Adobes) override this upward in seed_config.serviceBufferMeters.
const DEFAULT_SERVICE_BUFFER_METERS = 1500;

// We search broad (anything that could host a happy hour) but exclude junk PRIMARY
// types at the Google query level — so 7-Elevens (convenience_store), Chick-fil-A /
// Chipotle (fast_food_restaurant), coffee shops, bakeries, theaters, etc. never come
// back and never cost us an AI pass. excludedPrimaryTypes removes a place when its
// PRIMARY type is in the list, so a real restaurant that merely *also* serves coffee
// stays. (PRD §7.3 / cost control — keep the candidate set alcohol-leaning.)
const INCLUDED_TYPES = ["bar", "restaurant"] as const;
const EXCLUDED_PRIMARY_TYPES = [
  "fast_food_restaurant",
  "convenience_store",
  "cafe",
  "coffee_shop",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
  "sandwich_shop",
  "ice_cream_shop",
  "donut_shop",
  "grocery_store",
  "supermarket",
  "gas_station",
  "liquor_store",
  "movie_theater",
  "bowling_alley",
  "golf_course",
  "gym",
  "hamburger_restaurant",
  // Operator 2026-05-30 (Tucson calibration): Indian restaurants essentially never run
  // a happy hour. Validated zero false-positives against the confirmed-HH set. (cafeteria
  // is also excluded, but only via isExcludedByPlaceType — it is not a valid Google
  // excludedPrimaryType and would 400 the request.)
  "indian_restaurant",
  // Operator 2026-05-30 (Phoenix calibration): thai_restaurant had 0 confirmed-HH
  // venues across Tucson + Phoenix combined (n=8). Validated zero false-positives
  // against the confirmed-HH set in both cities before excluding.
  "thai_restaurant",
] as const;

/** Grid of search-circle centers covering ~coverage around the city center. */
function buildTiles(
  centerLat: number,
  centerLng: number,
  coverageMeters: number,
  cellMeters: number,
): { lat: number; lng: number }[] {
  const latPerM = 1 / 111_320;
  const lngPerM = 1 / (111_320 * Math.cos((centerLat * Math.PI) / 180));
  const steps = Math.ceil(coverageMeters / cellMeters);
  const tiles: { lat: number; lng: number }[] = [];
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      if (Math.hypot(i * cellMeters, j * cellMeters) > coverageMeters) continue;
      tiles.push({
        lat: centerLat + i * cellMeters * latPerM,
        lng: centerLng + j * cellMeters * lngPerM,
      });
    }
  }
  return tiles;
}

/** Grid of search-circle centers covering a lat/lng bounding box (BOUNDARY mode). */
function buildTilesBbox(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  cellMeters: number,
): { lat: number; lng: number }[] {
  const midLat = (minLat + maxLat) / 2;
  const latStep = cellMeters / 111_320;
  const lngStep = cellMeters / (111_320 * Math.cos((midLat * Math.PI) / 180));
  const tiles: { lat: number; lng: number }[] = [];
  for (let lat = minLat; lat <= maxLat + latStep; lat += latStep) {
    for (let lng = minLng; lng <= maxLng + lngStep; lng += lngStep) {
      tiles.push({ lat, lng });
    }
  }
  return tiles;
}

async function fetchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<PlaceResult[]> {
  const body = {
    includedTypes: INCLUDED_TYPES,
    excludedPrimaryTypes: EXCLUDED_PRIMARY_TYPES,
    maxResultCount: 20,
    // DISTANCE (not the default POPULARITY): return the NEAREST 20 to the tile center,
    // not the 20 most prominent. Combined with adaptive subdivision of saturated tiles,
    // this is what makes coverage complete (lower-profile bars stop losing the 20 slots
    // to popular restaurants). DISTANCE requires a circular locationRestriction (we have one).
    rankPreference: "DISTANCE",
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
  };

  const res = await fetch(PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // Atmosphere-tier mask (shared PLACE_FIELD_MASK). searchNearby bills per TILE CALL,
      // not per result, so capturing the alcohol gate + hours + phone here (≈+$1/city)
      // deletes the per-CANDIDATE Place Details call from enrich (≈-$8-30/city).
      "X-Goog-FieldMask": PLACE_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Google Places API error ${res.status}: ${text}`);
  }

  const data: NearbySearchResponse = (await res.json()) as NearbySearchResponse;
  return data.places ?? [];
}

// ---------------------------------------------------------------------------
// HH-targeted recall (Text Search)
// ---------------------------------------------------------------------------
// The DISTANCE-ranked Nearby sweep truncates each tile to the nearest 20 SERVER-SIDE, so
// real HH anchors in dense corridors (e.g. Jack's on S El Camino, San Mateo) are dropped
// before we ever see them. Google exposes NO happy-hour field, so we tap its "happy hour"
// search RELEVANCE instead. Recovered places run through the IDENTICAL gate ladder +
// boundary gate + upsert as Nearby results — this only changes how candidates are FOUND.

const HH_RECALL_QUERIES = ["happy hour"] as const;
// Google caps Text Search at 60 results across pages (3 × pageSize 20). Hard ceiling per
// query+region — there is NO adaptive recursion (unlike Nearby), so cost is fixed and
// countable up front: queries × regions × ≤3 pages.
const TEXT_SEARCH_MAX_PAGES = 3;

interface LatLngRect {
  low: { latitude: number; longitude: number };
  high: { latitude: number; longitude: number };
}

interface TextSearchResponse {
  places?: PlaceResult[];
  nextPageToken?: string;
}

/** Split a rectangle into 4 quadrants (opt-in --sub-tile, to surface > 60 venues/city). */
function splitRectQuadrants(r: LatLngRect): LatLngRect[] {
  const midLat = (r.low.latitude + r.high.latitude) / 2;
  const midLng = (r.low.longitude + r.high.longitude) / 2;
  return [
    { low: { latitude: r.low.latitude, longitude: r.low.longitude }, high: { latitude: midLat, longitude: midLng } },
    { low: { latitude: r.low.latitude, longitude: midLng }, high: { latitude: midLat, longitude: r.high.longitude } },
    { low: { latitude: midLat, longitude: r.low.longitude }, high: { latitude: r.high.latitude, longitude: midLng } },
    { low: { latitude: midLat, longitude: midLng }, high: { latitude: r.high.latitude, longitude: r.high.longitude } },
  ];
}

async function fetchTextSearchPage(
  apiKey: string,
  textQuery: string,
  rectangle: LatLngRect,
  pageToken?: string,
): Promise<TextSearchResponse> {
  const body: Record<string, unknown> = {
    textQuery,
    rankPreference: "RELEVANCE",
    locationRestriction: { rectangle },
    pageSize: 20,
  };
  if (pageToken) body.pageToken = pageToken;
  const res = await fetch(TEXT_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": `${PLACE_FIELD_MASK},nextPageToken`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Google Places searchText error ${res.status}: ${text}`);
  }
  return (await res.json()) as TextSearchResponse;
}

/**
 * Run the HH-recall Text Search over each region, paginating to the 60-result cap, merging
 * unique places into `into`. Returns calls made (cost accounting) and net-new added to the
 * pool. No recursion — bounded by regions × queries × TEXT_SEARCH_MAX_PAGES.
 */
async function collectHhRecall(
  apiKey: string,
  regions: LatLngRect[],
  into: Map<string, PlaceResult>,
): Promise<{ calls: number; added: number }> {
  let calls = 0;
  let added = 0;
  for (const region of regions) {
    for (const q of HH_RECALL_QUERIES) {
      let pageToken: string | undefined;
      let page = 0;
      do {
        const data = await fetchTextSearchPage(apiKey, q, region, pageToken);
        calls++;
        for (const p of data.places ?? []) {
          if (!p.id) continue;
          if (!into.has(p.id)) added++;
          into.set(p.id, p);
        }
        pageToken = data.nextPageToken;
        page++;
        await new Promise((r) => setTimeout(r, 40));
      } while (pageToken && page < TEXT_SEARCH_MAX_PAGES);
    }
  }
  return { calls, added };
}

// Genuine airport primary types. The `airport` INCLUDED type also returns places merely
// TAGGED airport — hospital/heliport helipads, the airport's parking-garage POI, even
// terminal "clubs". A hospital heliport sits in dense urban cores (e.g. Saint Joseph
// Hospital Heliport, 1km from Tacoma's center), so without this filter the 1500m buffer
// wipes out a whole restaurant district. We keep only points whose PRIMARY type is an
// actual airport — the in-terminal-dining case we care about — and drop the rest.
const AIRPORT_PRIMARY_TYPES = new Set<string>(["airport", "international_airport"]);

/**
 * Find airport points near the city so the discovery gate can drop in-terminal venues.
 * One Places call for includedTypes:["airport"], filtered to AIRPORT_PRIMARY_TYPES (Google
 * tags helipads/garages "airport" too — see the note above). Always searches at Google's
 * 50km Nearby maximum (centered on the city center), independent of the city's discovery
 * radius — the intent is "find this metro's airport(s)", and any metro airport is within
 * 50km of center. Generic + zero-curation: no per-city airport list. At most 20 results are
 * returned (maxResultCount cap — never a real limitation). Returns [] on any error (the gate
 * then becomes a no-op).
 */
async function findAirports(
  apiKey: string,
  centerLat: number,
  centerLng: number,
): Promise<GeoPoint[]> {
  const body = {
    includedTypes: ["airport"],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: centerLat, longitude: centerLng },
        radius: 50_000, // Google Places Nearby maximum radius
      },
    },
  };
  try {
    const res = await fetch(PLACES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location,places.primaryType",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`  [airport] lookup HTTP ${res.status} — airport gate disabled this run`);
      return [];
    }
    const data = (await res.json()) as {
      places?: { location?: { latitude?: number; longitude?: number }; primaryType?: string }[];
    };
    return (data.places ?? [])
      .filter((p) => p.primaryType != null && AIRPORT_PRIMARY_TYPES.has(p.primaryType))
      .map((p) => p.location)
      .filter((l): l is { latitude: number; longitude: number } => l?.latitude != null && l?.longitude != null)
      .map((l) => ({ lat: l.latitude, lng: l.longitude }));
  } catch (err) {
    console.warn(`  [airport] lookup failed — airport gate disabled this run:`, err);
    return [];
  }
}

// Simple heuristic: extract lines from a page that look like venue names.
// Looks for li/heading text that is 3–60 chars, not a nav/footer link.
function extractVenueNames(html: string): string[] {
  // Strip scripts + styles first
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  const candidates = new Set<string>();
  // Match title-case-ish phrases between 4–60 chars after punctuation / line breaks
  const re = /(?:^|[.!?•\n\r–-])\s*([A-Z][A-Za-z0-9'&\s]{3,58}?)(?=[.!?,\n\r]|$)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const s = m[1].trim();
    if (s.length >= 4 && s.length <= 60) {
      candidates.add(s);
    }
  }
  return Array.from(candidates).slice(0, 200); // cap per page
}

async function fetchCuratedPage(url: string): Promise<string[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "HappyHourFriends/1.0 (+https://happyhourfriends.com; seeder)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.warn(`  [curated] HTTP ${res.status} for ${url} — skipping`);
    return [];
  }
  const html = await res.text();
  return extractVenueNames(html);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const { slug: citySlug, state: cityState } = requireCityArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) {
    console.log(
      "\nSetup required — GOOGLE_PLACES_API_KEY is not set.\n" +
        "  1. Go to https://console.cloud.google.com/apis/credentials\n" +
        "  2. Create an API key and enable 'Places API (New)'\n" +
        "  3. Set a budget alert at $50/mo (PRD §10.1)\n" +
        "  4. Add to .env:  GOOGLE_PLACES_API_KEY=<your-key>\n" +
        "  5. Re-run:  tsx scripts/seed-discover.ts\n",
    );
    process.exit(0);
  }

  const sql = postgres(dbUrl, { max: 1 });

  try {
    // ---- Resolve city row ---------------------------------------------------
    const [city] = await sql<
      {
        id: string;
        name: string;
        slug: string;
        state: string | null;
        center_lat: string | null;
        center_lng: string | null;
        seed_config: SeedConfig | string | null;
      }[]
    >`SELECT id, name, slug, state, center_lat, center_lng, seed_config FROM cities
      WHERE lower(slug) = ${citySlug} AND lower(state) = ${cityState}`;
    if (!city) {
      throw new Error(
        `City '${citySlug}' (state '${cityState}') not found — run npm run seed:cities first.`,
      );
    }

    const lat = city.center_lat
      ? parseFloat(city.center_lat)
      : TACOMA_FALLBACK.lat;
    const lng = city.center_lng
      ? parseFloat(city.center_lng)
      : TACOMA_FALLBACK.lng;

    // Per-city discovery config (radius, locality filter). Defaults to historical
    // Tacoma values if seed_config is null so legacy rows keep working. postgres.js
    // returns JSONB as a string by default — parse if so.
    const rawCfg = city.seed_config;
    const cfg: SeedConfig =
      typeof rawCfg === "string"
        ? (JSON.parse(rawCfg) as SeedConfig)
        : (rawCfg ?? DEFAULT_SEED_CONFIG);
    const COVERAGE_METERS = cfg.radiusKm * 1000;
    const CELL_METERS = cfg.cellMeters;
    const SERVICE_RADIUS_KM = cfg.radiusKm;
    const SERVICE_LOCALITIES = cfg.serviceLocalities;
    // Locality regex needs the state code (e.g. ", Tacoma, WA" / ", Phoenix, AZ").
    const stateCode = city.state ?? "WA";

    // ---- Coverage mode: BOUNDARY (preferred) vs RADIUS (legacy) -------------
    // If a municipal boundary GeoJSON exists for this city, tile over its bbox and gate
    // every result spatially with ST_DWithin(boundary, point, buffer) — the same file +
    // buffer scope:venues uses. Otherwise fall back to the radius circle.
    const boundaryFile = `data/${city.slug}-boundary.geojson`;
    const useBoundary = existsSync(boundaryFile);
    const SERVICE_BUFFER_METERS =
      cfg.serviceBufferMeters ?? DEFAULT_SERVICE_BUFFER_METERS;
    if (useBoundary) {
      // Load the boundary into a temp table ONCE; the bbox + per-candidate gate query
      // against it. Accepts a Feature, FeatureCollection (first feature), or bare geometry.
      const raw = JSON.parse(readFileSync(boundaryFile, "utf8"));
      const geom =
        raw.type === "FeatureCollection"
          ? raw.features[0].geometry
          : raw.type === "Feature"
            ? raw.geometry
            : raw;
      // Session-scoped temp table (postgres.js max:1 = one connection for the run).
      await sql`CREATE TEMP TABLE _seed_boundary (g geometry)`;
      await sql`
        INSERT INTO _seed_boundary (g)
        VALUES (ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geom)}), 4326))
      `;
    }

    // ---- Crossover defense: drop candidates inside ANOTHER city's polygon -----
    // The service buffer (e.g. 500m) intentionally reaches past the municipal line, so it
    // pulls in border venues that geographically belong to a neighbor. A venue inside an
    // already-onboarded city's boundary is THAT city's — keep it out of this one regardless
    // of mailing address (unreliable at borders). The structural guard (global-unique
    // google_place_id) already protects venues that neighbor ALREADY claimed; this adds the
    // ones it hasn't discovered yet (Berkeley pulled 10 Rockridge venues inside Oakland).
    // Assumes boundary files are non-overlapping municipal/metro definitions.
    const siblingBoundaries: { slug: string; geom: PolygonLike; bbox: BBox }[] = [];
    for (const f of readdirSync("data")) {
      if (!f.endsWith("-boundary.geojson")) continue;
      const sibSlug = f.slice(0, -"-boundary.geojson".length);
      if (sibSlug === city.slug) continue;
      try {
        const sibGeom = geometryFromGeoJson(JSON.parse(readFileSync(join("data", f), "utf8")));
        siblingBoundaries.push({ slug: sibSlug, geom: sibGeom, bbox: bboxOf(sibGeom) });
      } catch {
        // A malformed sibling file shouldn't abort discovery — just skip it.
      }
    }
    /** The slug of another city whose polygon contains this point, or null. */
    const crossoverCityFor = (pLng: number, pLat: number): string | null => {
      const pt: Position = [pLng, pLat];
      for (const s of siblingBoundaries) {
        if (inBBox(pt, s.bbox) && pointInPolygon(pt, s.geom)) return s.slug;
      }
      return null;
    };

    // --fresh: wipe prior candidates (except those already linked to a venue) so the
    // re-discovery reflects the current type/area filters cleanly.
    if (args.fresh) {
      const del = await sql`
        DELETE FROM seed_candidates
        WHERE city_id = ${city.id} AND resulting_venue_id IS NULL
      `;
      console.log(`--fresh: cleared ${del.count} prior unprocessed candidate(s).`);
    }

    console.log(
      `Discovering venues for city '${city.slug}' around (lat=${lat}, lng=${lng})…`,
    );

    // ---- Google Places: tiled search (junk primary types excluded) ----------
    let placesInserted = 0;
    let outOfArea = 0;
    let crossoverDropped = 0;
    const crossoverByCity = new Map<string, number>();
    let chainsSkipped = 0;
    let formatsSkipped = 0;
    let typesSkipped = 0;
    let closedSkipped = 0;
    let airportSkipped = 0;
    let lowSignalSkipped = 0;
    let placesSkipped = 0;

    // --debug-drops: every dropped candidate + reason, written to docs/<city>-discovery-drops.json.
    interface DropRecord { name: string; reason: string; address: string | null; primaryType: string | null; website: string | null; lat: number | null; lng: number | null; reviews: number | null; }
    const drops: DropRecord[] = [];
    const recordDrop = (reason: string, place: PlaceResult) => {
      if (!args.debugDrops) return;
      drops.push({
        name: place.displayName?.text ?? "(no name)",
        reason,
        address: place.formattedAddress ?? null,
        primaryType: place.primaryType ?? null,
        website: place.websiteUri ?? null,
        lat: place.location?.latitude ?? null,
        lng: place.location?.longitude ?? null,
        reviews: place.userRatingCount ?? null,
      });
    };

    // ---- HH-recall rectangle (bounds the "happy hour" Text Search) ----------
    // Boundary mode: the boundary's buffered bbox. Radius mode: center ± coverage.
    const recallEnabled = !args.noHhRecall;
    let recallRect: LatLngRect;
    if (useBoundary) {
      const [rb] = await sql<
        { xmin: number; ymin: number; xmax: number; ymax: number }[]
      >`
        SELECT ST_XMin(e) xmin, ST_YMin(e) ymin, ST_XMax(e) xmax, ST_YMax(e) ymax
        FROM (
          SELECT ST_Envelope(ST_Buffer(g::geography, ${SERVICE_BUFFER_METERS})::geometry) e
          FROM _seed_boundary
        ) s
      `;
      recallRect = { low: { latitude: rb.ymin, longitude: rb.xmin }, high: { latitude: rb.ymax, longitude: rb.xmax } };
    } else {
      const dLat = COVERAGE_METERS / 111_320;
      const dLng = COVERAGE_METERS / (111_320 * Math.cos((lat * Math.PI) / 180));
      recallRect = { low: { latitude: lat - dLat, longitude: lng - dLng }, high: { latitude: lat + dLat, longitude: lng + dLng } };
    }
    const recallRegions: LatLngRect[] = args.subTile ? splitRectQuadrants(recallRect) : [recallRect];

    // ---- Nearby seed tiles (free to COMPUTE; only FETCHED if the Nearby sweep runs) ----
    let tiles: { lat: number; lng: number }[];
    if (useBoundary) {
      // Tile the boundary's buffered bbox, then drop tiles whose center is far from the
      // boundary (open desert / mountains / Saguaro NP) so we don't spend Places calls
      // where no venue can be in-scope. Keep tiles within (buffer + one cell) of the
      // boundary so edge cells still cover the buffer ring.
      const [bb] = await sql<
        { xmin: number; ymin: number; xmax: number; ymax: number }[]
      >`
        SELECT ST_XMin(e) xmin, ST_YMin(e) ymin, ST_XMax(e) xmax, ST_YMax(e) ymax
        FROM (
          SELECT ST_Envelope(ST_Buffer(g::geography, ${SERVICE_BUFFER_METERS})::geometry) e
          FROM _seed_boundary
        ) s
      `;
      const all = buildTilesBbox(bb.ymin, bb.xmin, bb.ymax, bb.xmax, CELL_METERS);
      const vals = all.map((t, i) => `(${i}, ${t.lng}, ${t.lat})`).join(",");
      const near = await sql.unsafe<{ i: number }[]>(`
        SELECT v.i FROM (VALUES ${vals}) v(i, lng, lat), _seed_boundary b
        WHERE ST_DWithin(
          b.g::geography,
          ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
          ${SERVICE_BUFFER_METERS + CELL_METERS}
        )
      `);
      const keep = new Set(near.map((r) => Number(r.i)));
      tiles = all.filter((_, i) => keep.has(i));
      console.log(
        `  BOUNDARY mode: ${tiles.length} tiles (of ${all.length} bbox, desert pruned); ` +
          `gate = within ${SERVICE_BUFFER_METERS}m of ${boundaryFile}; ` +
          `excluding ${EXCLUDED_PRIMARY_TYPES.length} junk primary types…`,
      );
    } else {
      tiles = buildTiles(lat, lng, COVERAGE_METERS, CELL_METERS);
      console.log(
        `  RADIUS mode: ${tiles.length} tiles (≤20 results each); excluding ${EXCLUDED_PRIMARY_TYPES.length} ` +
          `junk primary types; service area = ${SERVICE_LOCALITIES.join("/")} ≤${SERVICE_RADIUS_KM}km…`,
      );
    }
    const seedTiles: Tile[] = tiles.map((t) => ({
      lat: t.lat,
      lng: t.lng,
      radiusMeters: CELL_METERS,
      depth: 0,
    }));
    // Runaway cap scaled to CITY SIZE (full 4-ary tree per seed tile + margin) — the Nearby
    // sweep's own guard, independent of the recall --max-calls ceiling.
    const perSeedTreeMax = (Math.pow(4, MAX_DEPTH + 1) - 1) / 3;
    const maxTiles = Math.ceil(seedTiles.length * perSeedTreeMax) + 10;

    // ---- Cost plan + --estimate (prints the worst-case call count; makes ZERO calls) ----
    const plannedRecallCalls = recallEnabled
      ? recallRegions.length * HH_RECALL_QUERIES.length * TEXT_SEARCH_MAX_PAGES
      : 0;
    if (recallEnabled) {
      console.log(
        `  HH recall plan: "${HH_RECALL_QUERIES.join('", "')}" × ${recallRegions.length} region(s) ` +
          `× ≤${TEXT_SEARCH_MAX_PAGES} pages = ≤${plannedRecallCalls} Text Search call(s) ` +
          `(~$${(plannedRecallCalls * 0.04).toFixed(2)} @ Enterprise+Atmosphere).`,
      );
      if (plannedRecallCalls > args.maxCalls) {
        throw new Error(
          `HH recall would make ≤${plannedRecallCalls} calls, over --max-calls=${args.maxCalls}. ` +
            `Raise --max-calls to proceed.`,
        );
      }
    }
    if (!args.hhRecallOnly) {
      console.log(`  Nearby sweep plan: ≤${maxTiles} tile call(s) (adaptive — usually far fewer) + 1 airport call.`);
    }
    if (args.estimate) {
      console.log(`  --estimate: no Google calls made. Re-run without --estimate to execute.`);
      await sql.end();
      return;
    }

    // ---- Collect places into one pool → the shared gate ladder + boundary + upsert ----
    const collected = new Map<string, PlaceResult>();

    if (!args.hhRecallOnly) {
      // Adaptive collection: each seed tile is queried by NEAREST-20; a saturated tile (20)
      // subdivides into 4 smaller tiles and re-queries, down to the floor.
      let floorSaturated = 0;
      let tilesFetched = 0;
      let tilesPruned = 0;
      const nearby = await collectAdaptive<PlaceResult>({
        seedTiles,
        maxTiles,
        fetchTile: async (tile) => {
          // Subdivision pruning (BOUNDARY mode): skip a CHILD tile whose circle can't reach the
          // in-scope area — don't PAY to subdivide into a dense neighbor city (e.g. San Francisco
          // for Daly City). Seed tiles (depth 0) are already pruned to the boundary bbox above.
          if (useBoundary && tile.depth > 0) {
            const [{ within }] = await sql<{ within: boolean }[]>`
              SELECT ST_DWithin(
                g::geography,
                ST_SetSRID(ST_MakePoint(${tile.lng}, ${tile.lat}), 4326)::geography,
                ${SERVICE_BUFFER_METERS + tile.radiusMeters}
              ) AS within
              FROM _seed_boundary
            `;
            if (!within) { tilesPruned++; return []; }
          }
          let places: PlaceResult[];
          try {
            places = await fetchNearby(placesKey, tile.lat, tile.lng, tile.radiusMeters);
          } catch (err) {
            console.error(`  ERROR @ ${tile.lat.toFixed(3)},${tile.lng.toFixed(3)}:`, err);
            return [];
          }
          tilesFetched++;
          await new Promise((r) => setTimeout(r, 40)); // gentle throttle (unchanged cadence)
          return places;
        },
        onFloorSaturated: () => { floorSaturated++; },
      });
      for (const [k, v] of nearby) collected.set(k, v);
      console.log(
        `  Adaptive tiling: ${tilesFetched} tile fetches → ${nearby.size} unique places` +
          (tilesPruned > 0 ? `; ${tilesPruned} out-of-boundary child tile(s) pruned (no call)` : ``) +
          (floorSaturated > 0 ? `; ${floorSaturated} floor tile(s) still saturated (dense hotspot)` : ``),
      );
    }

    if (recallEnabled) {
      const { calls, added } = await collectHhRecall(placesKey, recallRegions, collected);
      console.log(`  HH recall: ${calls} Text Search call(s) → ${added} unique place(s) added to the pool.`);
    }

    // Airport points (for the in-terminal exclusion gate). One Places call; [] on error.
    const airports = await findAirports(placesKey, lat, lng);
    console.log(
      airports.length > 0
        ? `  Airport gate: ${airports.length} airport point(s) found; dropping candidates within 1500m.`
        : `  Airport gate: no airports found near center — gate is a no-op this run.`,
    );

    // Gate + upsert every unique place. (Same gate ladder as before, now run once per
    // deduped place instead of once per tile-result.)
    for (const place of collected.values()) {
      if (!place.id || !place.displayName?.text) {
        placesSkipped++;
        continue;
      }

      const name = place.displayName.text;
      const address = place.formattedAddress ?? null;
      const pLat = place.location?.latitude ?? null;
      const pLng = place.location?.longitude ?? null;

      if (isExcludedByBusinessStatus(place.businessStatus)) {
        closedSkipped++;
        recordDrop("closed", place);
        continue;
      }
      if (isDenylistedChain(name)) {
        chainsSkipped++;
        recordDrop("chain", place);
        continue;
      }
      if (isLikelyNoHappyHourFormat(name)) {
        formatsSkipped++;
        recordDrop("format", place);
        continue;
      }
      if (isExcludedByPlaceType(place.primaryType, place.types)) {
        typesSkipped++;
        recordDrop("place-type", place);
        continue;
      }

      // Airport-terminal gate: drop candidates within 1500m of a known airport point.
      if (pLat != null && pLng != null && isWithinAirportBuffer(pLat, pLng, airports)) {
        airportSkipped++;
        recordDrop("airport", place);
        continue;
      }

      const priceLevelNum = place.priceLevel
        ? (PRICE_LEVEL[place.priceLevel] ?? null)
        : null;
      if (isLowSignalCandidate(place.userRatingCount, name, place.primaryType, place.types)) {
        lowSignalSkipped++;
        recordDrop("low-signal", place);
        continue;
      }

      // Service-area gate (unchanged: BOUNDARY = ST_DWithin buffer; RADIUS = locality+haversine).
      let inArea: boolean;
      if (useBoundary) {
        if (pLat == null || pLng == null) {
          inArea = false;
        } else {
          const [{ within }] = await sql<{ within: boolean }[]>`
            SELECT ST_DWithin(
              g::geography,
              ST_SetSRID(ST_MakePoint(${pLng}, ${pLat}), 4326)::geography,
              ${SERVICE_BUFFER_METERS}
            ) AS within
            FROM _seed_boundary
          `;
          inArea = within;
        }
      } else {
        const inLocality = SERVICE_LOCALITIES.some((loc) =>
          new RegExp(`,\\s*${loc},\\s*${stateCode}`).test(address ?? ""),
        );
        const inRadius =
          pLat != null && pLng != null
            ? haversineMeters({ lat, lng }, { lat: pLat, lng: pLng }) <= SERVICE_RADIUS_KM * 1000
            : false;
        inArea = inLocality && inRadius;
      }
      if (!inArea) {
        outOfArea++;
        recordDrop("out-of-area", place);
        continue;
      }

      // Crossover: in-area but geographically inside another onboarded city's polygon → drop.
      if (pLat != null && pLng != null) {
        const owner = crossoverCityFor(pLng, pLat);
        if (owner) {
          crossoverDropped++;
          crossoverByCity.set(owner, (crossoverByCity.get(owner) ?? 0) + 1);
          recordDrop(`in-other-city:${owner}`, place);
          continue;
        }
      }

      try {
        const priceLevel = priceLevelNum;
        const types = place.types ?? null;
        // Atmosphere fields captured at discovery for the enrich gate (no Place Details call).
        const servesAlcohol = Boolean(
          place.servesBeer || place.servesWine || place.servesCocktails,
        );
        const hoursJson = parseRegularOpeningHours(place.regularOpeningHours);
        const phone = place.nationalPhoneNumber ?? null;
        const googleNeighborhood = pickNeighborhood(place.addressComponents, city.name);
        await sql`
          INSERT INTO seed_candidates
            (city_id, name, google_place_id, address, lat, lng, source_url,
             primary_type, types, website_url, rating, user_rating_count,
             price_level, business_status, serves_alcohol, hours_json, phone,
             google_neighborhood)
          VALUES
            (${city.id}, ${name}, ${place.id}, ${address},
             ${pLat != null ? String(pLat) : null},
             ${pLng != null ? String(pLng) : null}, ${"google_places"},
             ${place.primaryType ?? null}, ${types}, ${place.websiteUri ?? null},
             ${place.rating ?? null}, ${place.userRatingCount ?? null},
             ${priceLevel}, ${place.businessStatus ?? null},
             ${servesAlcohol}, ${sql.json((hoursJson ?? null) as never)}, ${phone},
             ${googleNeighborhood})
          ON CONFLICT (google_place_id) DO UPDATE SET
            name             = EXCLUDED.name,
            address          = EXCLUDED.address,
            lat              = EXCLUDED.lat,
            lng              = EXCLUDED.lng,
            primary_type     = EXCLUDED.primary_type,
            types            = EXCLUDED.types,
            website_url      = EXCLUDED.website_url,
            rating           = EXCLUDED.rating,
            user_rating_count = EXCLUDED.user_rating_count,
            price_level      = EXCLUDED.price_level,
            business_status  = EXCLUDED.business_status,
            serves_alcohol   = EXCLUDED.serves_alcohol,
            hours_json       = EXCLUDED.hours_json,
            phone            = EXCLUDED.phone,
            google_neighborhood = EXCLUDED.google_neighborhood,
            updated_at = now()
        `;
        placesInserted++;
      } catch (err) {
        console.warn(`  WARN upsert failed for ${name}:`, err);
        placesSkipped++;
      }
    }

    console.log(
      `Google Places: ${placesInserted} in-area upserts, ${outOfArea} out-of-area dropped, ` +
        `${chainsSkipped} chains dropped, ${formatsSkipped} buffet/AYCE dropped, ` +
        `${typesSkipped} place-type dropped, ${closedSkipped} closed dropped, ` +
        `${airportSkipped} airport dropped, ${lowSignalSkipped} low-signal dropped, ` +
        `${placesSkipped} skipped.`,
    );
    if (crossoverDropped > 0) {
      const breakdown = [...crossoverByCity.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${s}: ${n}`)
        .join(", ");
      console.log(
        `  crossover: ${crossoverDropped} candidate(s) dropped — inside another city's polygon (${breakdown}). ` +
          `Saved enriching venues that belong to a neighbor.`,
      );
    }

    if (args.debugDrops) {
      const path = `docs/${city.slug}-discovery-drops.json`;
      const byReason: Record<string, number> = {};
      for (const d of drops) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      writeFileSync(path, JSON.stringify({ city: city.slug, total: drops.length, byReason, drops }, null, 2));
      console.log(`  --debug-drops: wrote ${drops.length} dropped candidates to ${path}`);
    }

    // ---- Metro-scope cleanup -----------------------------------------------
    // Drop UNPROCESSED candidates that fall inside an out-of-scope neighborhood (operator
    // marked in_scope=false — far residential areas that aren't HH destinations). Only
    // unprocessed: never touch candidates already enriched into venues. Generic across
    // cities; a no-op where no neighborhood is out-of-scope. The radius gate can't express
    // "this metro but not that suburb", so we subtract scope here, after the spatial fetch.
    const scoped = await sql`
      DELETE FROM seed_candidates sc
      USING neighborhoods n
      WHERE sc.city_id = ${city.id}
        AND n.city_id = sc.city_id
        AND n.in_scope = false
        AND n.polygon IS NOT NULL
        AND sc.processed_at IS NULL
        AND sc.lat IS NOT NULL AND sc.lng IS NOT NULL
        AND ST_Contains(n.polygon, ST_SetSRID(ST_MakePoint(sc.lng::float8, sc.lat::float8), 4326))
    `;
    if (scoped.count > 0) {
      console.log(`Metro-scope: dropped ${scoped.count} candidate(s) in out-of-scope neighborhoods.`);
    }

    // ---- Curated sources (optional) ----------------------------------------
    if (args.curated) {
      console.log("\nFetching curated source pages…");
      // TODO: after curated names are inserted, run a follow-up pass that
      //       calls the Places API "Text Search" to resolve each name to a
      //       google_place_id and merge the two rows (NEVER dedup by name alone
      //       — PRD §13; a chain may have multiple locations).
      let curatedInserted = 0;
      let curatedSkipped = 0;

      for (const sourceUrl of CURATED_SOURCES) {
        console.log(`  Fetching ${sourceUrl}…`);
        let names: string[] = [];
        try {
          names = await fetchCuratedPage(sourceUrl);
        } catch (err) {
          console.warn(`  ERROR fetching ${sourceUrl}:`, err);
          continue;
        }
        console.log(`    → ${names.length} candidate names extracted`);

        for (const name of names) {
          try {
            // googlePlaceId=null: these are name-only stubs until the TODO
            // resolution pass matches them against the Places API.
            await sql`
              INSERT INTO seed_candidates
                (city_id, name, google_place_id, address, lat, lng, source_url)
              VALUES
                (${city.id}, ${name}, ${null}, ${null},
                 ${null}, ${null}, ${sourceUrl})
              ON CONFLICT (google_place_id) DO NOTHING
            `;
            curatedInserted++;
          } catch (err) {
            console.warn(`  WARN insert failed for "${name}":`, err);
            curatedSkipped++;
          }
        }
      }

      console.log(
        `Curated: ${curatedInserted} inserted, ${curatedSkipped} skipped.`,
      );
    }

    // ---- Summary -----------------------------------------------------------
    const [count] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM seed_candidates WHERE city_id = ${city.id}
    `;
    console.log(
      `\nDone. seed_candidates total for '${city.slug}': ${count?.n ?? "?"}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
