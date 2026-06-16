/**
 * Seed the cities table. Idempotent on slug. Tacoma is launch city #1.
 *   tsx scripts/seed-cities.ts
 *
 * Coordinates are the city centroid (reference data) used as the default map
 * center / discovery anchor — not venue data. `seedConfig` is per-city discovery
 * tuning (radius, locality filter) read by scripts/seed-discover-tacoma.ts.
 */
import "dotenv/config";
import postgres from "postgres";

/**
 * Per-city discovery configuration stored in cities.seed_config (JSONB). The discover
 * script reads it to size the search grid + filter the locality. Optional — Tacoma
 * keeps its historical defaults if absent.
 */
interface SeedConfig {
  /** Search + locality radius from the city centroid, in km. */
  radiusKm: number;
  /** Per-tile search radius in metres. 3000 is a sensible default. */
  cellMeters: number;
  /** Place must list one of these as its locality. Filters out neighboring towns. */
  serviceLocalities: string[];
  /** Boundary-mode only: metres of buffer around the municipal boundary that still
   *  counts as in-area (geocode slop). Discover falls back to its own default if omitted. */
  serviceBufferMeters?: number;
}

interface CitySeed {
  slug: string;
  name: string;
  state: string | null;
  country: string;
  timezone: string;
  currency: string;
  centerLat: number;
  centerLng: number;
  seedConfig: SeedConfig;
}

const CITIES: CitySeed[] = [
  {
    slug: "tacoma",
    name: "Tacoma",
    state: "WA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    centerLat: 47.2529,
    centerLng: -122.4443,
    seedConfig: {
      radiusKm: 7, // matches the historical SERVICE_RADIUS_KM gate
      cellMeters: 3000,
      serviceLocalities: ["Tacoma", "Ruston"],
    },
  },
  {
    // "Central Phoenix" — downtown centroid, 5-mile cap per operator (2026-05-27).
    // Both the radius AND the locality filter drop Tempe / Mesa / Scottsdale / Glendale.
    slug: "phoenix-central",
    name: "Central Phoenix",
    state: "AZ",
    country: "US",
    timezone: "America/Phoenix",
    currency: "USD",
    centerLat: 33.4484,
    centerLng: -112.074,
    seedConfig: {
      radiusKm: 8, // ~5 miles
      cellMeters: 3000,
      serviceLocalities: ["Phoenix"],
    },
  },
  {
    // Tucson, AZ — operator launch city after Tacoma. Centroid + ~12km radius
    // covers Tucson proper; locality filter drops Oro Valley / Marana / South Tucson.
    slug: "tucson",
    name: "Tucson",
    state: "AZ",
    country: "US",
    timezone: "America/Phoenix",
    currency: "USD",
    centerLat: 32.2226,
    centerLng: -110.9747,
    seedConfig: {
      radiusKm: 12,
      cellMeters: 3000,
      serviceLocalities: ["Tucson"],
    },
  },
  {
    // Scottsdale, AZ — separate municipality from Phoenix, so it needs its own city +
    // locality gate (Phoenix discovery dropped Scottsdale venues as "out-of-area").
    // Anchored on Old Town / South Scottsdale; ~20km radius reaches up through North
    // Scottsdale (Kierland / DC Ranch). Southern overage is gated by serviceLocalities.
    slug: "scottsdale",
    name: "Scottsdale",
    state: "AZ",
    country: "US",
    timezone: "America/Phoenix",
    currency: "USD",
    centerLat: 33.4942,
    centerLng: -111.9261,
    seedConfig: {
      radiusKm: 20,
      cellMeters: 3000,
      serviceLocalities: ["Scottsdale"],
    },
  },
  {
    // Daly City, CA — pilot for nested-routing-era onboarding. Combined Daly City + Colma
    // market (Colma is a tiny enclave; its restaurant/280 strip reads as "Daly City" to
    // locals). Boundary mode via data/daly-city-boundary.geojson drives discovery; the
    // locality gate drops SF / South SF / Brisbane / Pacifica. South SF is a separate
    // future city, NOT folded in here. See spec 2026-06-02-daly-city-onboarding-design.md.
    slug: "daly-city",
    name: "Daly City",
    state: "CA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    // centroid: ST_Centroid of data/daly-city-boundary.geojson (Daly City + Colma union)
    centerLat: 37.6842979,
    centerLng: -122.4654597,
    seedConfig: {
      radiusKm: 6, // fallback only; data/daly-city-boundary.geojson drives real tiling/gate
      cellMeters: 3000,
      serviceLocalities: ["Daly City", "Colma"],
      serviceBufferMeters: 500,
    },
  },
  {
    // Five Cities (Central Coast), CA — the contiguous SLO-County "Five Cities" market as
    // ONE combined city, with the towns surfaced as neighborhood filters. Boundary mode via
    // data/five-cities-boundary.geojson (union of OSM Pismo Beach + Grover Beach + Arroyo
    // Grande + Oceano polygons) drives discovery; Shell Beach is a district WITHIN Pismo
    // Beach so it has no separate polygon (the Pismo polygon covers it). San Luis Obispo is
    // a SEPARATE future city, NOT folded in here. See the Daly City onboarding runbook.
    slug: "five-cities",
    name: "Five Cities (Central Coast)",
    state: "CA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    // bbox center of data/five-cities-boundary.geojson (fallback only; boundary drives tiling)
    centerLat: 35.128,
    centerLng: -120.641,
    seedConfig: {
      radiusKm: 10, // fallback only; data/five-cities-boundary.geojson drives real tiling/gate
      cellMeters: 3000,
      serviceLocalities: [
        "Pismo Beach",
        "Grover Beach",
        "Arroyo Grande",
        "Oceano",
        "Shell Beach",
      ],
      serviceBufferMeters: 500,
    },
  },
  {
    // Oakland, CA — first larger-metro test of the discovery→enrich→free-fill→spotcheck
    // process (prior CA cities were small). Boundary mode via data/oakland-boundary.geojson
    // drives discovery; the locality gate keeps Oakland and drops Berkeley / Emeryville /
    // Alameda / Piedmont (Piedmont is an enclave but a separate town). centerLat/Lng are a
    // fallback only — once the boundary file lands, refine to its ST_Centroid.
    slug: "oakland",
    name: "Oakland",
    state: "CA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    // approx ST_Centroid of data/oakland-boundary.geojson (OSM relation 2833530)
    centerLat: 37.7876,
    centerLng: -122.2059,
    seedConfig: {
      radiusKm: 12, // fallback only; data/oakland-boundary.geojson drives real tiling/gate
      cellMeters: 3000,
      serviceLocalities: ["Oakland"],
      serviceBufferMeters: 500,
    },
  },
  {
    // Spokane, WA — Inland Northwest process-test city (moderate, ~180 km², ~230k pop).
    // First WA city since Tacoma; tests neighborhood-data + HH-publishing generalization
    // outside AZ/Bay. Boundary mode via data/spokane-boundary.geojson (OSM relation 237599)
    // drives discovery; the locality gate + spatial boundary drop Spokane Valley (separate
    // city), Airway Heights, Liberty Lake, Cheney. centerLat/Lng = bbox center of the
    // boundary file (fallback map anchor only; the boundary drives real tiling/gate).
    slug: "spokane",
    name: "Spokane",
    state: "WA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    centerLat: 47.67279,
    centerLng: -117.45393,
    seedConfig: {
      radiusKm: 12, // fallback only; data/spokane-boundary.geojson drives real tiling/gate
      cellMeters: 3000,
      serviceLocalities: ["Spokane"],
      serviceBufferMeters: 500,
    },
  },
  {
    // San Luis Obispo, CA — completes the central-coast cluster next to Five Cities
    // (compact, ~34 km², ~47k pop + Cal Poly; dense Higuera St downtown). Boundary mode
    // via data/san-luis-obispo-boundary.geojson (OSM relation 112148) drives discovery;
    // centerLat/Lng = bbox center of the boundary file (fallback map anchor only).
    slug: "san-luis-obispo",
    name: "San Luis Obispo",
    state: "CA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    centerLat: 35.2725,
    centerLng: -120.67037,
    seedConfig: {
      radiusKm: 8, // fallback only; data/san-luis-obispo-boundary.geojson drives real tiling/gate
      cellMeters: 3000,
      serviceLocalities: ["San Luis Obispo"],
      serviceBufferMeters: 500,
    },
  },
  {
    slug: "san-mateo",
    name: "San Mateo & Mid-Peninsula",
    state: "CA",
    country: "US",
    timezone: "America/Los_Angeles",
    currency: "USD",
    // center: bbox center of data/san-mateo-boundary.geojson — dissolved union of 5 mid-Peninsula
    // cities (OSM rels: San Mateo 2835017, Foster City 2835016, San Carlos 112314,
    // Belmont 9959750, Burlingame 9949457). Towns surface as neighborhood filters (Five Cities model).
    centerLat: 37.5406,
    centerLng: -122.2788,
    seedConfig: {
      radiusKm: 10, // fallback only; data/san-mateo-boundary.geojson drives real tiling/gate
      cellMeters: 3000,
      serviceLocalities: ["San Mateo", "Belmont", "San Carlos", "Foster City", "Burlingame"],
      serviceBufferMeters: 500,
    },
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  try {
    for (const c of CITIES) {
      await sql`
        INSERT INTO cities
          (slug, name, state, country, default_timezone, currency_code,
           center_lat, center_lng, seed_config, status)
        VALUES
          (${c.slug}, ${c.name}, ${c.state}, ${c.country}, ${c.timezone},
           ${c.currency}, ${c.centerLat}, ${c.centerLng},
           ${JSON.stringify(c.seedConfig)}::jsonb, 'discovery')
        ON CONFLICT (state, slug) DO UPDATE SET
          name = EXCLUDED.name,
          state = EXCLUDED.state,
          country = EXCLUDED.country,
          default_timezone = EXCLUDED.default_timezone,
          currency_code = EXCLUDED.currency_code,
          center_lat = EXCLUDED.center_lat,
          center_lng = EXCLUDED.center_lng,
          seed_config = EXCLUDED.seed_config,
          updated_at = now()
      `;
    }
    const rows = await sql`SELECT slug, name, country, seed_config FROM cities ORDER BY slug`;
    console.log("Cities:", rows);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
