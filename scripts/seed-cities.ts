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
        ON CONFLICT (slug) DO UPDATE SET
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
