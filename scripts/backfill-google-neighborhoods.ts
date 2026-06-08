/**
 * Backfill venues.google_neighborhood from Google Place Details for existing venues that
 * were discovered before T3 (addressComponents capture at discovery). After the backfill,
 * re-runs assignNeighborhoods so the name-primary stage (T5) takes effect.
 *
 * Run: npx tsx scripts/backfill-google-neighborhoods.ts --city <slug> --state <code> [--limit N] [--dry-run] [--include-stubs]
 * Requires GOOGLE_PLACES_API_KEY + DATABASE_URL.
 * --city and --state are BOTH required (cities are unique by (state, slug)).
 *
 * By DEFAULT only NON-STUB venues are backfilled — i.e. venues that have at least one
 * active happy hour (the listings that actually display HH data). Stubs (no active
 * happy_hours, the help-wanted placeholders) are skipped to save spend, since they're the
 * bulk of the count. Pass --include-stubs to backfill every venue with a place id instead.
 *
 * COST NOTE: uses the Essentials tier ($5/1000) with field mask "addressComponents" only.
 * Do NOT add other fields to the field mask — any upgrade field bumps to a pricier SKU.
 * Do NOT run without explicit operator cost approval.
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import { pickNeighborhood, type AddressComponent } from "@/lib/places/neighborhoodName";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
if (!API_KEY) { console.error("GOOGLE_PLACES_API_KEY is not set"); process.exit(1); }

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places/";

function parseArgs(): { limit: number | undefined; dryRun: boolean; includeStubs: boolean } {
  const args = process.argv.slice(2);
  const argValue = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  return {
    limit: argValue("--limit") ? Number(argValue("--limit")) : undefined,
    dryRun: args.includes("--dry-run"),
    includeStubs: args.includes("--include-stubs"),
  };
}

const sql = postgres(DATABASE_URL, { max: 4 });

async function main() {
  const { limit, dryRun, includeStubs } = parseArgs();

  // --city and --state are BOTH required for this script.
  const { slug, state } = requireCityArgs();
  const city = await resolveCity(sql, slug, state);

  // Default: skip stubs (venues with no active happy hour). Stubs are the help-wanted
  // placeholders and the bulk of the count; backfilling only real listings keeps spend down.
  const nonStubOnly = !includeStubs
    ? sql`AND EXISTS (
        SELECT 1 FROM happy_hours hh
        WHERE hh.venue_id = v.id AND hh.active = true AND hh.deleted_at IS NULL
      )`
    : sql``;

  const rows = await sql<{ id: string; google_place_id: string; name: string }[]>`
    SELECT v.id, v.google_place_id, v.name
    FROM venues v
    WHERE v.google_place_id IS NOT NULL
      AND v.google_neighborhood IS NULL
      AND v.deleted_at IS NULL
      AND v.city_id = ${city.id}
      ${nonStubOnly}
    ORDER BY v.name
    ${limit ? sql`LIMIT ${limit}` : sql``}
  `;

  console.log(`${dryRun ? "[dry-run] " : ""}${rows.length} ${includeStubs ? "venue(s) (incl. stubs)" : "non-stub venue(s)"} to backfill for ${city.name}, ${city.state.toUpperCase()}…`);

  let found = 0, blank = 0, updated = 0;
  let aborted = false;

  for (const r of rows) {
    const url = `${PLACES_ENDPOINT}${encodeURIComponent(r.google_place_id)}`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: {
          "X-Goog-Api-Key": API_KEY!,
          "X-Goog-FieldMask": "addressComponents",
        },
      });
    } catch (e) {
      console.error(`  FETCH ERROR for ${r.name}: ${(e as Error).message}`);
      throw e;
    }

    if (resp.status === 429) {
      console.error(`ABORT: Google Places returned 429 (quota/rate-limit) after ${found + blank} venue(s). Stopping fetch loop.`);
      aborted = true;
      break;
    }

    if (!resp.ok) {
      console.error(`ABORT: Google Places returned HTTP ${resp.status} for ${r.name}. Stopping fetch loop.`);
      aborted = true;
      break;
    }

    const body = (await resp.json()) as { addressComponents?: AddressComponent[] };
    const name = pickNeighborhood(body.addressComponents ?? null, city.name);

    if (name === null) {
      blank++;
      if (dryRun) console.log(`  – ${r.name}: (none)`);
      continue;
    }

    found++;
    if (dryRun) {
      console.log(`  ✓ ${r.name}: "${name}" (would write)`);
    } else {
      await sql`UPDATE venues SET google_neighborhood = ${name} WHERE id = ${r.id}`;
      updated++;
      console.log(`  ✓ ${r.name}: "${name}"`);
    }
  }

  const totalScanned = found + blank;

  if (!dryRun) {
    console.log(`\nRunning neighborhood assignment for ${city.name}…`);
    const assigned = await assignNeighborhoods(sql, city.id);
    console.log(`  ${assigned} venue(s) re-assigned.`);
    console.log(`\nDone. scanned=${totalScanned} found=${found} blank=${blank} updated=${updated} assigned=${assigned}${aborted ? " (ABORTED early — quota hit)" : ""}`);
  } else {
    console.log(`\n[dry-run] Done. scanned=${totalScanned} found=${found} blank=${blank} (no writes, no assignment run)${aborted ? " (ABORTED early — quota hit)" : ""}`);
  }

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
