/**
 * enrich-osm-gap — add ONE OSM-gap venue as a live listing, HH-only, liveness-gated.
 *
 * The OSM gap audit surfaces venues our Google sweep missed, but OSM data is stale (no
 * business-status) and noisy. This turns a single gap into a listing WITHOUT the blanket
 * enrich's stub bloat:
 *   1. Resolve the venue to a Google Place (Text Search) — the liveness + quality gate:
 *      drop CLOSED (businessStatus), no-alcohol (serves*), and low-signal (<25 reviews,
 *      no alcohol signal). OSM alone can't do this (e.g. Gilman Brewing Daly City = closed).
 *   2. Run the SAME resolveVenue persist path the Stub Resolver uses.
 *   3. KEEP only if a real happy-hour window lands; otherwise delete the row (no stub).
 *
 * Usage:
 *   tsx scripts/enrich-osm-gap.ts --city sacramento --state ca --name "Fuji Sacramento" \
 *     [--url <hh-page>] [--apply]
 *
 * Default is DRY-RUN: resolves + gates only, no venue created, no paid extraction. --apply
 * creates the venue and runs the extraction (ledgered by resolveVenue).
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { deriveVenueType } from "@/lib/places/venueType";
import { slugify, placeIdSuffix } from "@/lib/places/venueSlug";
import {
  isDenylistedChain,
  isLikelyNoHappyHourFormat,
  isExcludedByBusinessStatus,
  isLowSignalCandidate,
} from "@/lib/places/chainDenylist";
import { resolveVenue } from "@/lib/recover/resolveVenue";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const KEY = process.env.GOOGLE_PLACES_API_KEY!;
const PRICE_LEVEL: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
const FIELDS =
  "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType," +
  "places.types,places.websiteUri,places.rating,places.userRatingCount,places.priceLevel," +
  "places.businessStatus,places.servesBeer,places.servesWine,places.servesCocktails,places.nationalPhoneNumber";

interface Place {
  id: string; name: string; address: string | null; lat: number; lng: number;
  primaryType: string | null; types: string[] | null; website: string | null;
  reviews: number | null; priceLevel: number | null; businessStatus: string | null;
  servesAlcohol: boolean; phone: string | null;
}

async function resolvePlace(name: string, cityName: string, state: string): Promise<Place | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({ textQuery: `${name} ${cityName} ${state}`, pageSize: 5 }),
  });
  if (!res.ok) throw new Error(`Text Search ${res.status}: ${await res.text()}`);
  const places = (await res.json()).places ?? [];
  const p = places[0];
  if (!p?.id) return null;
  return {
    id: p.id,
    name: p.displayName?.text ?? name,
    address: p.formattedAddress ?? null,
    lat: p.location?.latitude, lng: p.location?.longitude,
    primaryType: p.primaryType ?? null, types: p.types ?? null,
    website: p.websiteUri ?? null,
    reviews: p.userRatingCount ?? null,
    priceLevel: p.priceLevel ? (PRICE_LEVEL[p.priceLevel] ?? null) : null,
    businessStatus: p.businessStatus ?? null,
    servesAlcohol: Boolean(p.servesBeer || p.servesWine || p.servesCocktails),
    phone: p.nationalPhoneNumber ?? null,
  };
}

/** Gate a resolved place the way discovery/enrich would. Returns a reject reason or null (keep). */
function gate(p: Place): string | null {
  if (isExcludedByBusinessStatus(p.businessStatus)) return `closed (${p.businessStatus})`;
  if (isDenylistedChain(p.name)) return "denylisted chain";
  if (isLikelyNoHappyHourFormat(p.name, p.website)) return "buffet/AYCE format";
  if (!p.servesAlcohol && isLowSignalCandidate(p.reviews, p.name, p.primaryType, p.types))
    return `low-signal (no alcohol signal, ${p.reviews ?? 0} reviews)`;
  if (!p.website) return "no website (can't extract)";
  return null;
}

async function main() {
  const { slug, state } = requireCityArgs();
  const name = arg("--name");
  const url = arg("--url");
  const apply = process.argv.includes("--apply");
  if (!name) throw new Error("--name is required (the venue name to resolve).");

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const city = await resolveCity(sql, slug, state);
    const place = await resolvePlace(name, city.name, state.toUpperCase());
    if (!place) { console.log(`No Google match for "${name}" in ${city.name}.`); return; }

    console.log(`Resolved: ${place.name} — ${place.address}`);
    console.log(`  place_id=${place.id} status=${place.businessStatus} reviews=${place.reviews} alcohol=${place.servesAlcohol} site=${place.website ?? "none"}`);

    const reject = gate(place);
    if (reject) { console.log(`\n✗ GATED: ${reject}. Not adding.`); return; }
    console.log(`  ✓ passes liveness/alcohol/quality gates.`);

    if (!apply) {
      console.log(`\nDRY-RUN. Would create the venue and extract from ${url ?? place.website}. Re-run with --apply.`);
      return;
    }

    // ---- Create venue (mirrors enrich insertVenueRow: slug retry on (city_id,slug) collision) ----
    const venueType = deriveVenueType({ primaryType: place.primaryType, types: place.types, name: place.name });
    const base = slugify(place.name);
    const suffix = placeIdSuffix(place.id);
    const slugs = [base, `${base}-${suffix}`, `${base}-${suffix}-2`];
    const doInsert = async (s: string) => {
      const r = await sql<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, address, lat, lng, google_place_id, website_url,
          phone, price_level, type, status, data_completeness)
        VALUES (${city.id}, ${place.name}, ${s}, ${place.address}, ${String(place.lat)}, ${String(place.lng)},
          ${place.id}, ${place.website}, ${place.phone}, ${place.priceLevel},
          ${venueType}::venue_type, 'active'::venue_status, 'stub'::data_completeness)
        ON CONFLICT (${sql`google_place_id`}) DO NOTHING RETURNING id`;
      return r[0]?.id ?? null;
    };
    let venueId: string | null = null, created = false;
    for (let i = 0; i < slugs.length; i++) {
      try { venueId = await doInsert(slugs[i]); created = venueId != null; break; }
      catch (e: any) {
        if (e?.code === "23505" && String(e?.constraint_name ?? "").includes("slug") && i < slugs.length - 1) continue;
        throw e;
      }
    }
    if (!venueId) {
      const [ex] = await sql<{ id: string }[]>`SELECT id FROM venues WHERE google_place_id = ${place.id}`;
      venueId = ex?.id ?? null;
      if (venueId) console.log(`  (venue already existed for this place_id — enriching it)`);
    }
    if (!venueId) throw new Error("venue insert failed");

    // ---- Extract + persist through the canonical path (HH-only promotion, ledgered) ----
    console.log(`  Extracting${url ? ` from ${url}` : " (auto-discover)"}…`);
    const result = await resolveVenue({ venueId, urls: url ? [url] : [], actor: "osm-gap-script" });
    console.log(`  ${result.summary} (cost ${result.costCents}¢)`);
    console.log(`  result: live=${result.windowsLive} hidden=${result.windowsHidden} recovered=${result.recovered} offerings=${result.offeringsAdded}`);
    if (process.argv.includes("--no-delete")) {
      console.log(`  --no-delete: leaving venue ${venueId} in place for inspection.`);
      return;
    }

    if (result.windowsLive > 0) {
      console.log(`\n✓ LIVE: ${place.name} — ${result.windowsLive} active window(s), ${result.offeringsAdded} offering(s).`);
    } else if (created) {
      // No active HH → honor "no stub bloat": remove the freshly-created row + any hidden windows.
      await sql`DELETE FROM offerings WHERE happy_hour_id IN (SELECT id FROM happy_hours WHERE venue_id = ${venueId})`;
      await sql`DELETE FROM happy_hours WHERE venue_id = ${venueId}`;
      await sql`DELETE FROM venues WHERE id = ${venueId}`;
      console.log(`\n✗ No happy hour found → removed the row (no stub added). Cost ${result.costCents}¢ spent on the check.`);
    } else {
      console.log(`\n✗ No active HH; venue pre-existed so left as-is.`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
