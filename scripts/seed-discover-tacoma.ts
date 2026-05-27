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

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { city: string; curated: boolean } {
  const argv = process.argv.slice(2);
  const getFlag = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    city: getFlag("--city") ?? "tacoma",
    curated: argv.includes("--curated"),
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
}

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

async function fetchNearby(
  apiKey: string,
  placeType: string,
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<PlaceResult[]> {
  const body = {
    includedTypes: [placeType],
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
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `Google Places API error ${res.status} for type=${placeType}: ${text}`,
    );
  }

  const data: NearbySearchResponse = await res.json() as NearbySearchResponse;
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
      { id: string; center_lat: string | null; center_lng: string | null }[]
    >`SELECT id, center_lat, center_lng FROM cities WHERE slug = ${args.city}`;
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
    const radius = TACOMA_FALLBACK.radiusMeters;

    console.log(
      `Discovering venues for city '${args.city}' (lat=${lat}, lng=${lng}, r=${radius}m)…`,
    );

    // ---- Google Places: bar + restaurant -----------------------------------
    let placesInserted = 0;
    let placesSkipped = 0;

    for (const placeType of ["bar", "restaurant"] as const) {
      console.log(`  Querying Google Places for type=${placeType}…`);
      let places: PlaceResult[];
      try {
        places = await fetchNearby(placesKey, placeType, lat, lng, radius);
      } catch (err) {
        console.error(`  ERROR fetching type=${placeType}:`, err);
        continue;
      }
      console.log(`    → ${places.length} results`);

      for (const place of places) {
        if (!place.id || !place.displayName?.text) {
          placesSkipped++;
          continue;
        }

        const name = place.displayName.text;
        const googlePlaceId = place.id;
        const address = place.formattedAddress ?? null;
        const placeLat =
          place.location?.latitude != null
            ? String(place.location.latitude)
            : null;
        const placeLng =
          place.location?.longitude != null
            ? String(place.location.longitude)
            : null;

        try {
          await sql`
            INSERT INTO seed_candidates
              (city_id, name, google_place_id, address, lat, lng, source_url)
            VALUES
              (${city.id}, ${name}, ${googlePlaceId}, ${address},
               ${placeLat}, ${placeLng}, ${"google_places"})
            ON CONFLICT (google_place_id) DO UPDATE SET
              name    = EXCLUDED.name,
              address = EXCLUDED.address,
              lat     = EXCLUDED.lat,
              lng     = EXCLUDED.lng,
              updated_at = now()
          `;
          placesInserted++;
        } catch (err) {
          console.warn(`  WARN upsert failed for ${name}:`, err);
          placesSkipped++;
        }
      }
    }

    console.log(
      `Google Places: ${placesInserted} upserted, ${placesSkipped} skipped.`,
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
