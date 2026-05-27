/**
 * Resolve venues that have no google_place_id to their canonical Places id, so the
 * AI enrich pipeline dedups correctly instead of creating duplicate rows (PRD §13 —
 * dedup on google_place_id, NEVER name). Uses the Places API (New) Text Search
 * (places:searchText) with name + address, biased to the city center.
 *
 * This is the resolution pass the discover script's TODO describes: it turns the
 * hand-seeded / curated name-only venues into place_id-keyed rows that
 * `seed:enrich` will then skip via its ON CONFLICT (google_place_id) DO NOTHING.
 * Also backfills lat/lng when missing and re-assigns neighborhoods at the end.
 *
 * Idempotent: only touches venues where google_place_id IS NULL; never overwrites a
 * place_id already claimed by another venue (reports the collision instead).
 *
 * Usage:  tsx scripts/backfill-place-ids.ts [--city tacoma] [--limit N]
 * Required env: DATABASE_URL, GOOGLE_PLACES_API_KEY
 */
import "dotenv/config";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

const SEARCH_TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

interface PlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

function parseArgs(): { city: string; limit: number | null } {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitRaw = get("--limit");
  return {
    city: get("--city") ?? "tacoma",
    limit: limitRaw != null ? parseInt(limitRaw, 10) : null,
  };
}

async function searchPlace(
  apiKey: string,
  textQuery: string,
  bias: { lat: number; lng: number },
): Promise<PlaceResult | null> {
  const res = await fetch(SEARCH_TEXT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({
      textQuery,
      locationBias: {
        circle: {
          center: { latitude: bias.lat, longitude: bias.lng },
          radius: 20000,
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Places searchText error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { places?: PlaceResult[] };
  return data.places?.[0] ?? null;
}

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GOOGLE_PLACES_API_KEY is not set.");
    process.exit(1);
  }

  const sql = postgres(dbUrl, { max: 1 });
  try {
    const [city] = await sql<
      {
        id: string;
        name: string;
        state: string | null;
        center_lat: string | null;
        center_lng: string | null;
      }[]
    >`SELECT id, name, state, center_lat, center_lng FROM cities WHERE slug = ${args.city}`;
    if (!city) throw new Error(`City '${args.city}' not found.`);

    const bias = {
      lat: city.center_lat ? parseFloat(city.center_lat) : 47.2529,
      lng: city.center_lng ? parseFloat(city.center_lng) : -122.4443,
    };

    const venues = await sql<
      { id: string; name: string; address: string | null }[]
    >`
      SELECT id, name, address
      FROM venues
      WHERE city_id = ${city.id}
        AND google_place_id IS NULL
        AND deleted_at IS NULL
      ORDER BY name
      ${args.limit != null ? sql`LIMIT ${args.limit}` : sql``}
    `;

    if (venues.length === 0) {
      console.log("No venues need a place_id backfill. Nothing to do.");
      return;
    }
    console.log(`Resolving place_id for ${venues.length} venue(s)…`);

    let resolved = 0;
    let unresolved = 0;
    let collisions = 0;

    for (let i = 0; i < venues.length; i++) {
      const v = venues[i];
      const locality = [city.name, city.state].filter(Boolean).join(", ");
      const textQuery = v.address ? `${v.name}, ${v.address}` : `${v.name}, ${locality}`;

      let place: PlaceResult | null;
      try {
        place = await searchPlace(apiKey, textQuery, bias);
      } catch (err) {
        console.error(`  ERROR querying "${v.name}":`, err);
        unresolved++;
        continue;
      }

      if (!place?.id) {
        console.warn(`  no match: ${v.name}`);
        unresolved++;
        continue;
      }

      // Don't steal a place_id already claimed by another venue.
      const [claimed] = await sql<{ id: string }[]>`
        SELECT id FROM venues WHERE google_place_id = ${place.id}
      `;
      if (claimed && claimed.id !== v.id) {
        console.warn(`  collision: "${v.name}" → ${place.id} already on another venue`);
        collisions++;
        continue;
      }

      const lat = place.location?.latitude != null ? String(place.location.latitude) : null;
      const lng = place.location?.longitude != null ? String(place.location.longitude) : null;

      await sql`
        UPDATE venues
        SET google_place_id = ${place.id},
            lat = COALESCE(lat, ${lat}),
            lng = COALESCE(lng, ${lng}),
            updated_at = now()
        WHERE id = ${v.id}
      `;
      console.log(`  ✓ ${v.name} → ${place.displayName?.text ?? place.id}`);
      resolved++;

      // Be polite to the API.
      if (i < venues.length - 1) await new Promise((r) => setTimeout(r, 200));
    }

    const assigned = await assignNeighborhoods(sql, city.id);

    console.log("\n── place_id backfill complete ───────────────────────────");
    console.log(`  resolved:     ${resolved}`);
    console.log(`  unresolved:   ${unresolved}`);
    console.log(`  collisions:   ${collisions}`);
    console.log(`  neighborhoods assigned: ${assigned}`);
    console.log(
      "\nReview the matches above — Text Search is name+address based; a wrong match\n" +
        "would mis-key a venue. Then run seed:enrich (it will skip these via place_id).",
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
