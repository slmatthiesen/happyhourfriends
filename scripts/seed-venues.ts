/**
 * Load scraped seed venues into the DB (PRD §7.3 Stage A/B alternative, §13).
 *
 * Reads data/tacoma-seed.json — real Tacoma happy-hour data gathered from public
 * editorial sources. These are SECONDARY sources: every happy_hours/offerings row
 * carries its `source_url`, and each venue's `dataAsOf` (the source's own
 * last-updated date) is written to `venues.last_verified_at` so the re-verify cron
 * (lib/jobs/handlers/reverify.ts) re-confirms the oldest entries first against each
 * venue's own channels.
 *
 * Idempotent: venues upsert on (city_id, slug); happy_hours upsert on their natural
 * key; offerings are only inserted when their happy_hours row is newly created.
 *
 * Completeness: no happy hours → 'stub'; windows but no priced offerings → 'partial';
 * at least one window with offerings → 'complete'. (Never 'verified' — that status is
 * reserved for AI/own-source verification within 60 days.)
 *
 * Usage:  tsx scripts/seed-venues.ts [--file data/tacoma-seed.json] [--city tacoma]
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

interface SeedOffering {
  kind: string;
  category: string;
  name?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  discountCents?: number | null;
  description?: string | null;
  conditions?: string | null;
}

interface SeedHappyHour {
  daysOfWeek: number[];
  startTime: string;
  endTime: string | null;
  locationWithinVenue: string;
  notes?: string | null;
  offerings: SeedOffering[];
}

interface SeedVenue {
  name: string;
  slug: string;
  address?: string | null;
  type?: string | null;
  lat?: number | null;
  lng?: number | null;
  websiteUrl?: string | null;
  sourceUrl: string;
  dataAsOf: string;
  happyHours: SeedHappyHour[];
}

interface SeedFile {
  _meta?: { city?: string };
  venues: SeedVenue[];
}

function parseArgs(): { file: string; city: string | null } {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    file: get("--file") ?? "data/tacoma-seed.json",
    city: get("--city") ?? null,
  };
}

function completenessOf(v: SeedVenue): "stub" | "partial" | "complete" {
  if (v.happyHours.length === 0) return "stub";
  return v.happyHours.some((h) => h.offerings.length > 0) ? "complete" : "partial";
}

async function main() {
  const args = parseArgs();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  const seed = JSON.parse(
    readFileSync(join(process.cwd(), args.file), "utf8"),
  ) as SeedFile;
  const citySlug = args.city ?? seed._meta?.city ?? "tacoma";

  const sql = postgres(dbUrl, { max: 1 });

  let venuesInserted = 0;
  let venuesExisting = 0;
  let hhInserted = 0;
  let offeringsInserted = 0;

  try {
    const [city] = await sql<{ id: string }[]>`
      SELECT id FROM cities WHERE slug = ${citySlug}
    `;
    if (!city) {
      throw new Error(`City '${citySlug}' not found — run npm run seed:cities first.`);
    }

    for (const v of seed.venues) {
      const completeness = completenessOf(v);
      const lastVerified = v.happyHours.length > 0 ? v.dataAsOf : null;

      const inserted = await sql<{ id: string }[]>`
        INSERT INTO venues
          (city_id, name, slug, address, type, lat, lng, website_url, status,
           data_completeness, last_verified_at)
        VALUES
          (${city.id}, ${v.name}, ${v.slug}, ${v.address ?? null},
           ${v.type ?? null}::venue_type, ${v.lat ?? null}, ${v.lng ?? null},
           ${v.websiteUrl ?? null},
           'active'::venue_status, ${completeness}::data_completeness,
           ${lastVerified}::timestamptz)
        ON CONFLICT (city_id, slug) DO NOTHING
        RETURNING id
      `;

      let venueId: string;
      if (inserted.length > 0) {
        venueId = inserted[0].id;
        venuesInserted++;
      } else {
        const [existing] = await sql<{ id: string }[]>`
          SELECT id FROM venues WHERE city_id = ${city.id} AND slug = ${v.slug}
        `;
        if (!existing) continue;
        venueId = existing.id;
        venuesExisting++;
      }

      for (const hh of v.happyHours) {
        for (const day of hh.daysOfWeek) {
          const hhRows = await sql<{ id: string }[]>`
            INSERT INTO happy_hours
              (venue_id, day_of_week, start_time, end_time,
               location_within_venue, notes, active, source_url)
            VALUES
              (${venueId}, ${day}, ${hh.startTime}, ${hh.endTime},
               ${hh.locationWithinVenue}::location_within_venue,
               ${hh.notes ?? null}, true, ${v.sourceUrl})
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          if (hhRows.length === 0) continue; // already present — keep idempotent
          hhInserted++;
          const hhId = hhRows[0].id;

          for (const o of hh.offerings) {
            await sql`
              INSERT INTO offerings
                (happy_hour_id, kind, category, name, price_cents,
                 original_price_cents, discount_cents, description, conditions,
                 active, source_url)
              VALUES
                (${hhId}, ${o.kind}::offering_kind, ${o.category}::offering_category,
                 ${o.name ?? null}, ${o.priceCents ?? null},
                 ${o.originalPriceCents ?? null}, ${o.discountCents ?? null},
                 ${o.description ?? null}, ${o.conditions ?? null},
                 true, ${v.sourceUrl})
            `;
            offeringsInserted++;
          }
        }
      }
    }

    // Assign neighborhoods for any venue that carries coordinates (point-in-polygon).
    const assigned = await assignNeighborhoods(sql, city.id);

    console.log("\n── Seed load complete ───────────────────────────────────");
    console.log(`  venues inserted:    ${venuesInserted}`);
    console.log(`  venues pre-existing: ${venuesExisting}`);
    console.log(`  happy_hours rows:   ${hhInserted}`);
    console.log(`  offerings rows:     ${offeringsInserted}`);
    console.log(`  neighborhoods set:  ${assigned}`);
    console.log(
      "\nThese are editorial (secondary) sources. Run the re-verify cron / " +
        "seed:enrich once ANTHROPIC_API_KEY is set to confirm against venue channels.",
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
