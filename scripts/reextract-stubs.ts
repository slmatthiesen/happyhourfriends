/**
 * reextract-stubs — recover happy hours for EXISTING stub venues using the fixed
 * extractor (prompt v13: a day+time window is recordable even with no published
 * prices). A normal `seed:enrich` re-run will NOT do this — it skips any candidate
 * whose google_place_id already maps to a venue — so stubs created before the fix
 * never get a second look. This script re-runs the extractor over those stubs and
 * ATTACHES any windows to the existing venue row (never inserts/deletes venues).
 *
 * Reuses the live pipeline pieces: triageSite (page discovery), extractHappyHours
 * (the fixed extractor), assessRealness (the same realness gate enrich uses). The
 * happy_hours / offerings inserts mirror persistExtraction exactly (ON CONFLICT DO
 * NOTHING — idempotent, additive). Every model call is recorded in ai_usage_ledger.
 *
 * Usage:
 *   tsx scripts/reextract-stubs.ts --city tucson --dry-run      # $0: triage only, who qualifies
 *   tsx scripts/reextract-stubs.ts --city tucson [--limit N]    # PAID: ~$0.03/venue on-demand
 *
 * Required env: DATABASE_URL, ANTHROPIC_API_KEY (for the real run), GOOGLE_PLACES_API_KEY optional.
 */
import "dotenv/config";
import postgres from "postgres";
import { extractHappyHours } from "@/lib/ai/extractHappyHours";
import { triageSite, resolveEnrichAction } from "@/lib/places/siteTriage";
import { hhLikelihood } from "@/lib/places/hhLikelihood";
import { assessRealness } from "@/lib/places/realnessGate";
import { firstOfCurrentMonth } from "@/lib/ai/budget";

type Sql = ReturnType<typeof postgres>;

interface StubVenue {
  id: string;
  name: string;
  website_url: string | null;
  type: string | null;
  primary_type: string | null;
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (f: string) => {
    const i = a.indexOf(f);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    city: get("--city") ?? "tucson",
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : null,
    dryRun: a.includes("--dry-run"),
  };
}

/** Attach extracted windows to an EXISTING venue. Mirrors persistExtraction's inserts. */
async function attachWindows(
  sql: Sql,
  venueId: string,
  extracted: Awaited<ReturnType<typeof extractHappyHours>>,
): Promise<{ active: number; hidden: number }> {
  let active = 0;
  let hidden = 0;
  for (const hh of extracted.happyHours) {
    const days = [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
    const verdict = assessRealness({
      allDay: hh.allDay,
      dayCount: days.length,
      timeKnown: hh.timeKnown,
      confidence: extracted.confidence,
    });
    const rows = await sql<{ id: string }[]>`
      INSERT INTO happy_hours
        (venue_id, days_of_week, all_day, start_time, end_time,
         location_within_venue, notes, active, extract_confidence, time_known, source_url)
      VALUES
        (${venueId}, ${days}, ${hh.allDay}, ${hh.startTime}, ${hh.endTime},
         ${hh.locationWithinVenue}::location_within_venue, ${hh.notes},
         ${!verdict.suspect}, ${extracted.confidence}, ${hh.timeKnown}, ${hh.sourceUrl})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (rows.length === 0) continue; // duplicate window — already present
    if (verdict.suspect) hidden++;
    else active++;
    for (const off of hh.offerings) {
      await sql`
        INSERT INTO offerings
          (happy_hour_id, kind, category, name, price_cents, original_price_cents,
           discount_cents, description, conditions, active, source_url)
        VALUES
          (${rows[0].id}, ${off.kind}::offering_kind, ${off.category}::offering_category,
           ${off.name}, ${off.priceCents}, ${off.originalPriceCents}, ${off.discountCents},
           ${off.description}, ${off.conditions}, true, ${off.sourceUrl})
      `;
    }
  }
  return { active, hidden };
}

async function main() {
  const args = parseArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const placesKey = process.env.GOOGLE_PLACES_API_KEY ?? null;
  void placesKey; // not needed: we use the venue's stored website_url (already the Place Details site)

  if (!args.dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required for the real run (use --dry-run for a $0 preview).");
    process.exit(1);
  }

  try {
    const [city] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM cities WHERE slug = ${args.city}
    `;
    if (!city) throw new Error(`city '${args.city}' not found`);

    // Stubs with a website: the recoverable population. (No-site stubs can't be re-read;
    // social-only stubs are caught by triage below and skipped.)
    const stubs = await sql<StubVenue[]>`
      SELECT v.id, v.name, v.website_url, v.type::text AS type, sc.primary_type
      FROM venues v
      LEFT JOIN seed_candidates sc ON sc.resulting_venue_id = v.id
      WHERE v.city_id = ${city.id}
        AND v.status = 'active'
        AND v.data_completeness = 'stub'
        AND v.website_url IS NOT NULL
      ORDER BY v.name
      ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
    `;

    console.log(
      `${args.dryRun ? "[DRY RUN] " : ""}${stubs.length} stub venue(s) with a website in ${city.name}.\n` +
        (args.dryRun
          ? "Triage only — no model calls, no spend.\n"
          : `Estimated cost: ~$${(stubs.length * 0.03).toFixed(2)} on-demand.\n`),
    );

    const month = firstOfCurrentMonth();
    let qualifies = 0;
    let venuesRecovered = 0;
    let windowsLive = 0;
    let windowsHidden = 0;
    let stillEmpty = 0;
    let socialSkipped = 0;
    let spentCents = 0;

    for (let i = 0; i < stubs.length; i++) {
      const v = stubs[i];
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const likelihood = hhLikelihood({ primaryType: v.primary_type, types: null, name: v.name });
      const decided = resolveEnrichAction(verdict, likelihood);

      if (decided.action !== "extract") {
        socialSkipped++;
        continue;
      }
      qualifies++;

      if (args.dryRun) {
        console.log(`  ⟳ ${v.name}  (${verdict.hhSignalUrls.length} HH link(s))`);
        continue;
      }

      const extracted = await extractHappyHours({
        venueName: v.name,
        websiteUrl: verdict.kind === "real" ? verdict.url : null,
        otherUrl: null,
        cityName: city.name,
        priorityUrls: decided.priorityUrls,
      });
      spentCents += extracted.costCents;

      // Ledger every model call (stage 'seed', same as enrich).
      await sql`
        INSERT INTO ai_usage_ledger
          (month, model, input_tokens, output_tokens, cost_cents, stage, city_id, prompt_hash)
        VALUES
          (${month}, ${extracted.model}, ${extracted.usage.inputTokens}, ${extracted.usage.outputTokens},
           ${extracted.costCents}, 'seed'::ai_stage, ${city.id}, ${extracted.promptHash})
      `;

      if (extracted.happyHours.length === 0) {
        stillEmpty++;
        console.log(`  ◦ ${v.name}: still no window (conf ${extracted.confidence.toFixed(2)})`);
        continue;
      }

      const { active, hidden } = await attachWindows(sql, v.id, extracted);
      windowsLive += active;
      windowsHidden += hidden;

      if (active > 0) {
        // Promote the stub to a live listing.
        await sql`
          UPDATE venues
          SET data_completeness = 'complete'::data_completeness,
              last_verified_at = now(), updated_at = now()
          WHERE id = ${v.id}
        `;
        venuesRecovered++;
        console.log(`  ✓ ${v.name}: +${active} live window(s)${hidden ? ` (+${hidden} hidden)` : ""}`);
      } else if (hidden > 0) {
        console.log(`  ⊘ ${v.name}: +${hidden} window(s) hidden for review`);
      } else {
        stillEmpty++;
        console.log(`  ◦ ${v.name}: windows already present (no change)`);
      }
    }

    console.log("\n── Re-extract complete ───────────────────────────────────");
    console.log(`  stubs examined:          ${stubs.length}`);
    console.log(`  qualified (real site):   ${qualifies}`);
    console.log(`  social-only (skipped):   ${socialSkipped}`);
    if (!args.dryRun) {
      console.log(`  venues recovered → live: ${venuesRecovered}`);
      console.log(`  windows added (live):    ${windowsLive}`);
      console.log(`  windows hidden:          ${windowsHidden}`);
      console.log(`  still no window:         ${stillEmpty}`);
      console.log(`  spend:                   $${(spentCents / 100).toFixed(2)}`);
    } else {
      console.log(`\n  Re-run without --dry-run to extract (≈ $${(qualifies * 0.03).toFixed(2)} for the ${qualifies} that qualify).`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
