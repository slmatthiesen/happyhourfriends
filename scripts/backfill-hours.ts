/**
 * Backfill venues.hours_json from Google Place Details for venues that have a
 * google_place_id. After the close-time hardening, all-day / until-close windows stay
 * SUPPRESSED (no "now" badge) until a venue has hours — this restores them.
 *
 * Run: npx tsx scripts/backfill-hours.ts [--city <slug> --state <code>] [--limit N] [--dry-run]
 * Requires GOOGLE_PLACES_API_KEY + DATABASE_URL.
 */
import "dotenv/config";
import postgres from "postgres";
import { fetchPlaceDetails, PlaceDetailsQuotaError } from "@/lib/places/placeDetails";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
if (!API_KEY) { console.error("GOOGLE_PLACES_API_KEY is not set"); process.exit(1); }

function parseArgs(): { hasCity: boolean; limit: number | undefined; dryRun: boolean } {
  const args = process.argv.slice(2);
  const argValue = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  return {
    hasCity: args.includes("--city"),
    limit: argValue("--limit") ? Number(argValue("--limit")) : undefined,
    dryRun: args.includes("--dry-run"),
  };
}

const sql = postgres(DATABASE_URL, { max: 4 });

async function main() {
  const { hasCity, limit, dryRun } = parseArgs();

  // --city is optional; when provided, --state is also required.
  let cityId: string | undefined;
  if (hasCity) {
    const { slug, state } = requireCityArgs();
    const city = await resolveCity(sql, slug, state);
    cityId = city.id;
  }

  const rows = await sql<{ id: string; google_place_id: string; name: string }[]>`
    SELECT v.id, v.google_place_id, v.name
    FROM venues v
    WHERE v.google_place_id IS NOT NULL
      AND v.hours_json IS NULL
      AND v.deleted_at IS NULL
      ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
    ORDER BY v.name
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;

  console.log(`${dryRun ? "[dry-run] " : ""}${rows.length} venue(s) to backfill…`);
  let updated = 0, noHours = 0;
  for (const r of rows) {
    let details;
    try {
      details = await fetchPlaceDetails(API_KEY!, r.google_place_id);
    } catch (e) {
      if (e instanceof PlaceDetailsQuotaError) { console.error(`ABORT: ${(e as PlaceDetailsQuotaError).message}`); break; }
      throw e;
    }
    const periods = details?.openingPeriods ?? null;
    if (!periods) { noHours++; console.log(`  – ${r.name}: no hours`); continue; }
    if (!dryRun) {
      await sql`UPDATE venues SET hours_json = ${sql.json(periods as never)} WHERE id = ${r.id}`;
    }
    updated++;
    console.log(`  ✓ ${r.name}: ${periods.length} period(s)`);
  }
  console.log(`\nDone. ${updated} updated, ${noHours} had no hours.`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
