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
 *   tsx scripts/seed-discover-tacoma.ts [--city tacoma] [--curated]
 *
 * Required env vars:
 *   DATABASE_URL           Postgres connection string
 *   GOOGLE_PLACES_API_KEY  Google Cloud Places API (New) key
 */
import "dotenv/config";
import postgres from "postgres";
import {
  isDenylistedChain,
  isLikelyNoHappyHourFormat,
  isExcludedByPlaceType,
  isExcludedByBusinessStatus,
  isLowSignalCandidate,
} from "@/lib/places/chainDenylist";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { city: string; curated: boolean; fresh: boolean } {
  const argv = process.argv.slice(2);
  const getFlag = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    city: getFlag("--city") ?? "tacoma",
    curated: argv.includes("--curated"),
    // --fresh: clear this city's existing candidates first (re-discover from scratch,
    // e.g. after changing the type/area filters). Candidates already linked to a venue
    // are kept so we don't lose enrich results.
    fresh: argv.includes("--fresh"),
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

// Tacoma bbox (PRD §7.3 notes the city center + bbox from cities table).
// Fallback radius/bbox when the DB row has no bbox stored yet.
const TACOMA_FALLBACK = {
  lat: 47.2529,
  lng: -122.4443,
  radiusMeters: 15_000, // ~9 miles — covers Tacoma proper
};

// Per-city discovery config stored in cities.seed_config (JSONB). Falls back to the
// historical Tacoma defaults if absent so older city rows keep working.
interface SeedConfig {
  radiusKm: number;
  cellMeters: number;
  serviceLocalities: string[];
}
const DEFAULT_SEED_CONFIG: SeedConfig = {
  radiusKm: 7,
  cellMeters: 3000,
  serviceLocalities: ["Tacoma", "Ruston"],
};

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
] as const;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

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
      // Enterprise-tier mask: websiteUri/rating/priceLevel/businessStatus cost more
      // than the basic mask but are captured once per city at discovery time (no
      // per-candidate Place Details call needed for the triage sheet), and
      // businessStatus lets us drop permanently-closed venues before any AI spend.
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location," +
        "places.primaryType,places.types,places.websiteUri,places.rating," +
        "places.userRatingCount,places.priceLevel,places.businessStatus",
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
        "  5. Re-run:  tsx scripts/seed-discover-tacoma.ts\n",
    );
    process.exit(0);
  }

  const sql = postgres(dbUrl, { max: 1 });

  try {
    // ---- Resolve city row ---------------------------------------------------
    const [city] = await sql<
      {
        id: string;
        state: string | null;
        center_lat: string | null;
        center_lng: string | null;
        seed_config: SeedConfig | string | null;
      }[]
    >`SELECT id, state, center_lat, center_lng, seed_config FROM cities WHERE slug = ${args.city}`;
    if (!city) {
      throw new Error(
        `City '${args.city}' not found — run npm run seed:cities first.`,
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
      `Discovering venues for city '${args.city}' around (lat=${lat}, lng=${lng})…`,
    );

    // ---- Google Places: tiled search (junk primary types excluded) ----------
    let placesInserted = 0;
    let outOfArea = 0;
    let chainsSkipped = 0;
    let formatsSkipped = 0;
    let typesSkipped = 0;
    let closedSkipped = 0;
    let lowSignalSkipped = 0;
    let placesSkipped = 0;

    const tiles = buildTiles(lat, lng, COVERAGE_METERS, CELL_METERS);
    console.log(
      `  ${tiles.length} tiles (≤20 results each); excluding ${EXCLUDED_PRIMARY_TYPES.length} ` +
        `junk primary types; service area = ${SERVICE_LOCALITIES.join("/")} ≤${SERVICE_RADIUS_KM}km…`,
    );

    for (const tile of tiles) {
      let places: PlaceResult[];
      try {
        places = await fetchNearby(placesKey, tile.lat, tile.lng, CELL_METERS);
      } catch (err) {
        console.error(
          `  ERROR @ ${tile.lat.toFixed(3)},${tile.lng.toFixed(3)}:`,
          err,
        );
        continue;
      }

      for (const place of places) {
        if (!place.id || !place.displayName?.text) {
          placesSkipped++;
          continue;
        }

        const name = place.displayName.text;
        const address = place.formattedAddress ?? null;
        const pLat = place.location?.latitude ?? null;
        const pLng = place.location?.longitude ?? null;

        // Closed gate: drop venues Google reports closed (permanently OR temporarily)
        // before they ever cost an AI pass. No alcohol override — closed is closed.
        if (isExcludedByBusinessStatus(place.businessStatus)) {
          closedSkipped++;
          continue;
        }

        // National-chain gate: skip Applebee's / Red Lobster / fast food etc. entirely
        // so they never cost a Place Details or AI pass (operator: ignore these).
        if (isDenylistedChain(name)) {
          chainsSkipped++;
          continue;
        }

        // Format gate (name-based): buffets / AYCE — these don't run happy hours.
        if (isLikelyNoHappyHourFormat(name)) {
          formatsSkipped++;
          continue;
        }

        // Place-type gate: drop breakfast/buffet/juice/grocery formats by Google type,
        // with an alcohol-signal override so real bars/breweries are never dropped.
        if (isExcludedByPlaceType(place.primaryType, place.types)) {
          typesSkipped++;
          continue;
        }

        // Low-signal gate: <25 reviews AND no website AND no price tier — too little to
        // go on (no site = nothing for the extractor to read). No alcohol override.
        const priceLevelNum = place.priceLevel
          ? (PRICE_LEVEL[place.priceLevel] ?? null)
          : null;
        if (
          isLowSignalCandidate(place.userRatingCount, place.websiteUri, priceLevelNum)
        ) {
          lowSignalSkipped++;
          continue;
        }

        // Service-area gate: keep only the configured localities within the radius.
        // Out-of-area edge-tile spillover (Federal Way, Lakewood for Tacoma; Tempe,
        // Scottsdale for Phoenix-central) is dropped here, never stored.
        const inLocality = SERVICE_LOCALITIES.some((loc) =>
          new RegExp(`,\\s*${loc},\\s*${stateCode}`).test(address ?? ""),
        );
        const inRadius =
          pLat != null && pLng != null
            ? haversineKm(lat, lng, pLat, pLng) <= SERVICE_RADIUS_KM
            : false;
        if (!inLocality || !inRadius) {
          outOfArea++;
          continue;
        }

        try {
          const priceLevel = priceLevelNum; // computed above for the low-signal gate
          const types = place.types ?? null;
          await sql`
            INSERT INTO seed_candidates
              (city_id, name, google_place_id, address, lat, lng, source_url,
               primary_type, types, website_url, rating, user_rating_count,
               price_level, business_status)
            VALUES
              (${city.id}, ${name}, ${place.id}, ${address},
               ${pLat != null ? String(pLat) : null},
               ${pLng != null ? String(pLng) : null}, ${"google_places"},
               ${place.primaryType ?? null}, ${types}, ${place.websiteUri ?? null},
               ${place.rating ?? null}, ${place.userRatingCount ?? null},
               ${priceLevel}, ${place.businessStatus ?? null})
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
              updated_at = now()
          `;
          placesInserted++;
        } catch (err) {
          console.warn(`  WARN upsert failed for ${name}:`, err);
          placesSkipped++;
        }
      }
      await new Promise((r) => setTimeout(r, 40));
    }

    console.log(
      `Google Places: ${placesInserted} in-area upserts, ${outOfArea} out-of-area dropped, ` +
        `${chainsSkipped} chains dropped, ${formatsSkipped} buffet/AYCE dropped, ` +
        `${typesSkipped} place-type dropped, ${closedSkipped} closed dropped, ` +
        `${lowSignalSkipped} low-signal dropped, ` +
        `${placesSkipped} skipped.`,
    );

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
      `\nDone. seed_candidates total for '${args.city}': ${count?.n ?? "?"}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
