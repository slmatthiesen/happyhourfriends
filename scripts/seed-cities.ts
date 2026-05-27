/**
 * Seed the cities table. Idempotent on slug. Tacoma is launch city #1.
 *   tsx scripts/seed-cities.ts
 *
 * Coordinates are the city centroid (reference data) used as the default map
 * center / discovery anchor — not venue data.
 */
import "dotenv/config";
import postgres from "postgres";

interface CitySeed {
  slug: string;
  name: string;
  state: string | null;
  country: string;
  timezone: string;
  currency: string;
  centerLat: number;
  centerLng: number;
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
          (slug, name, state, country, default_timezone, currency_code, center_lat, center_lng, status)
        VALUES
          (${c.slug}, ${c.name}, ${c.state}, ${c.country}, ${c.timezone},
           ${c.currency}, ${c.centerLat}, ${c.centerLng}, 'discovery')
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          state = EXCLUDED.state,
          country = EXCLUDED.country,
          default_timezone = EXCLUDED.default_timezone,
          currency_code = EXCLUDED.currency_code,
          center_lat = EXCLUDED.center_lat,
          center_lng = EXCLUDED.center_lng,
          updated_at = now()
      `;
    }
    const rows = await sql`SELECT slug, name, country FROM cities ORDER BY slug`;
    console.log("Cities:", rows);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
