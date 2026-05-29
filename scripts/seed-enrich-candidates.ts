/**
 * Stage B — Seed enrichment for Tacoma (PRD §7.3).
 *
 * Loads unprocessed seed_candidates (processed_at IS NULL) for the target city
 * and runs the Stage 2 AI verifier against each one to discover happy hour info.
 * Outcomes:
 *   confirmed_hh     → venue row inserted, then extractHappyHours() populates
 *                       happy_hours + offerings with a source_url per row (PRD §13).
 *                       Completeness becomes 'complete' when sourced rows land,
 *                       otherwise it stays 'partial'.
 *   no_hh_explicit   → venue row inserted (status=no_happy_hour, dataCompleteness=stub)
 *   no_hh_found      → venue row inserted (status=active, dataCompleteness=stub)
 *                       → renders as "help wanted" on the site
 *   error            → seed_candidate.outcome='error'; no venue row created
 *
 * Every AI call is recorded in ai_usage_ledger (stage='seed').
 * Processing is idempotent: candidates with processed_at set are skipped.
 * Venue rows are upserted on google_place_id when present.
 *
 * Usage:
 *   tsx scripts/seed-enrich-candidates.ts [--city tacoma] [--limit N]
 *
 * Required env vars:
 *   DATABASE_URL       Postgres connection string
 *   ANTHROPIC_API_KEY  Anthropic API key
 */
import "dotenv/config";
import postgres from "postgres";
import { extractHappyHours } from "@/lib/ai/extractHappyHours";
import { firstOfCurrentMonth } from "@/lib/ai/budget";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";
import {
  fetchPlaceDetails,
  fetchPlacePhoto,
  PlaceDetailsQuotaError,
} from "@/lib/places/placeDetails";
import { saveVenuePhoto } from "@/lib/places/venuePhoto";
import { isDenylistedChain, isLikelyNoHappyHourFormat } from "@/lib/places/chainDenylist";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { city: string; limit: number | null } {
  const argv = process.argv.slice(2);
  const getFlag = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitStr = getFlag("--limit");
  return {
    city: getFlag("--city") ?? "tacoma",
    limit: limitStr != null ? parseInt(limitStr, 10) : null,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeedCandidate {
  id: string;
  name: string;
  google_place_id: string | null;
  address: string | null;
  lat: string | null;
  lng: string | null;
  source_url: string | null;
}

// ---------------------------------------------------------------------------
// Slugify helper (mirrors import-neighborhoods.ts)
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

type SeedOutcome = "confirmed_hh" | "no_hh_explicit" | "no_hh_found" | "error";

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

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "\nSetup required — ANTHROPIC_API_KEY is not set.\n" +
        "  1. Go to https://console.anthropic.com/settings/keys\n" +
        "  2. Create an API key and set a workspace spend limit of $30/mo as a backstop (PRD §10.5)\n" +
        "  3. Add to .env:  ANTHROPIC_API_KEY=<your-key>\n" +
        "  4. Re-run:  tsx scripts/seed-enrich-candidates.ts\n" +
        "\nEstimated one-time cost for full Tacoma seed: ~$16 (PRD §7.3).\n",
    );
    process.exit(0);
  }

  const placesKey = process.env.GOOGLE_PLACES_API_KEY ?? null;
  const sql = postgres(dbUrl, { max: 1 });

  try {
    // ---- Resolve city row --------------------------------------------------
    const [city] = await sql<{ id: string; slug: string }[]>`
      SELECT id, slug FROM cities WHERE slug = ${args.city}
    `;
    if (!city) {
      throw new Error(
        `City '${args.city}' not found — run npm run seed:cities first.`,
      );
    }

    // ---- Load unprocessed candidates ---------------------------------------
    const candidates: SeedCandidate[] = await sql<SeedCandidate[]>`
      SELECT id, name, google_place_id, address, lat, lng, source_url
      FROM seed_candidates
      WHERE city_id = ${city.id}
        AND processed_at IS NULL
      ORDER BY created_at ASC
      ${args.limit != null ? sql`LIMIT ${args.limit}` : sql``}
    `;

    if (candidates.length === 0) {
      console.log(
        `No unprocessed seed_candidates found for '${args.city}'. ` +
          "Run seed-discover-tacoma.ts first.",
      );
      return;
    }

    console.log(
      `Enriching ${candidates.length} candidates for '${args.city}'…`,
    );

    let nConfirmed = 0;
    let nNoHhFound = 0;
    let nError = 0;
    let nSkipped = 0;
    let nFiltered = 0;
    const month = firstOfCurrentMonth();

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(
        `[${i + 1}/${candidates.length}] ${candidate.name} (id=${candidate.id})…`,
      );

      // National-chain gate (defensive — discovery already filters these). Mark
      // processed, no venue, no AI.
      if (isDenylistedChain(candidate.name)) {
        console.log("  ↷ skip — national chain");
        await sql`
          UPDATE seed_candidates
          SET processed_at = now(), updated_at = now()
          WHERE id = ${candidate.id}
        `;
        nFiltered++;
        continue;
      }

      // Format gate: buffets / AYCE / all-you-can-eat — these don't run happy hours
      // (already discounted by format). No venue, no AI. Operator directive 2026-05-27.
      if (isLikelyNoHappyHourFormat(candidate.name)) {
        console.log("  ↷ skip — buffet/AYCE format");
        await sql`
          UPDATE seed_candidates
          SET processed_at = now(), updated_at = now()
          WHERE id = ${candidate.id}
        `;
        nFiltered++;
        continue;
      }

      // Skip candidates already mapped to a venue (deduped by place_id) — don't re-pay
      // to enrich something we already have (e.g. hand-seeded venues after backfill).
      if (candidate.google_place_id) {
        const [existing] = await sql<{ id: string }[]>`
          SELECT id FROM venues WHERE google_place_id = ${candidate.google_place_id}
        `;
        if (existing) {
          console.log("  ↷ skip — already a venue (place_id matched)");
          await sql`
            UPDATE seed_candidates
            SET processed_at = now(), resulting_venue_id = ${existing.id}, updated_at = now()
            WHERE id = ${candidate.id}
          `;
          nSkipped++;
          continue;
        }
      }

      let outcome: SeedOutcome = "error";
      let resultingVenueId: string | null = null;

      try {
        // ---- Place Details: alcohol gate + website + price tier + photo ------
        // One Google call (no AI). Gates out non-alcohol venues before any AI spend,
        // and supplies the canonical website the extractor reads.
        // Quota-exhausted (429) escapes via PlaceDetailsQuotaError below — we abort
        // the whole run rather than poisoning every remaining candidate as
        // "no website" (2026-05-27 incident).
        const details =
          placesKey && candidate.google_place_id
            ? await fetchPlaceDetails(placesKey, candidate.google_place_id)
            : null;

        // Alcohol gate — only when details actually came back (don't false-skip on an
        // API hiccup). Non-alcohol venues are marked processed with no venue, no AI.
        if (details && !details.servesAlcohol) {
          console.log("  ↷ filtered — Google reports no alcohol served");
          await sql`
            UPDATE seed_candidates
            SET processed_at = now(), updated_at = now()
            WHERE id = ${candidate.id}
          `;
          nFiltered++;
          continue;
        }

        const siteUrl = details?.websiteUri ?? null;

        // ---- Single AI pass: extract HH straight from the venue's site -------
        const extracted = siteUrl
          ? await extractHappyHours({
              venueName: candidate.name,
              websiteUrl: siteUrl,
              otherUrl: null,
            })
          : null;

        if (extracted) {
          await sql`
            INSERT INTO ai_usage_ledger
              (month, model, input_tokens, output_tokens, cost_cents,
               stage, city_id, prompt_hash)
            VALUES
              (${month}, ${extracted.model},
               ${extracted.usage.inputTokens}, ${extracted.usage.outputTokens},
               ${extracted.costCents}, ${"seed"}::ai_stage,
               ${city.id}, ${extracted.promptHash})
          `;
          console.log(
            `  → confidence=${extracted.confidence.toFixed(2)}, cost=${extracted.costCents}¢, ` +
              `${extracted.happyHours.length} window(s)`,
          );
        } else {
          console.log("  → no website on file");
        }

        const hasHH = (extracted?.happyHours.length ?? 0) > 0;
        outcome = hasHH ? "confirmed_hh" : "no_hh_found";

        // We KEEP the venue even when we couldn't find times: it passed the chain +
        // alcohol + area gates, so it's a likely-HH local spot. With HH → 'complete'
        // (sorts into the table); without → 'stub' (shows at the bottom as
        // "likely has a happy hour — help us add times", crowdsourced). Only genuine
        // junk (chains, non-alcohol, out-of-area) was already filtered upstream.
        {
          const slug = slugify(candidate.name);
          const completeness = hasHH ? "complete" : "stub";
          const lastVerified = hasHH ? new Date() : null;
          const inserted = await sql<{ id: string }[]>`
            INSERT INTO venues
              (city_id, name, slug, address, lat, lng, google_place_id,
               website_url, phone, price_level, status, data_completeness, last_verified_at)
            VALUES
              (${city.id}, ${candidate.name}, ${slug},
               ${candidate.address}, ${candidate.lat}, ${candidate.lng},
               ${candidate.google_place_id ?? null}, ${siteUrl}, ${details?.phone ?? null},
               ${details?.priceLevel ?? null}, 'active'::venue_status,
               ${completeness}::data_completeness, ${lastVerified}::timestamptz)
            ON CONFLICT (${candidate.google_place_id ? sql`google_place_id` : sql`city_id, slug`})
              DO NOTHING
            RETURNING id
          `;
          let venueId = inserted[0]?.id ?? null;
          if (!venueId && candidate.google_place_id) {
            const [ex] = await sql<{ id: string }[]>`
              SELECT id FROM venues WHERE google_place_id = ${candidate.google_place_id}
            `;
            venueId = ex?.id ?? null;
          }
          resultingVenueId = venueId;

          // ---- Hero photo (download once, store locally) ---------------------
          if (venueId && placesKey && details?.photoName) {
            const photo = await fetchPlacePhoto(placesKey, details.photoName);
            if (photo) {
              const path = await saveVenuePhoto(venueId, photo.bytes);
              if (path) {
                await sql`UPDATE venues SET hero_image_url = ${path}, updated_at = now() WHERE id = ${venueId}`;
              }
            }
          }

          // ---- Insert HH rows (one row per window, days clustered) -----------
          if (venueId && extracted && hasHH) {
            for (const hh of extracted.happyHours) {
              const days = [...new Set(hh.daysOfWeek)].sort((a, b) => a - b);
              const hhRows = await sql<{ id: string }[]>`
                INSERT INTO happy_hours
                  (venue_id, days_of_week, all_day, start_time, end_time,
                   location_within_venue, notes, active, source_url)
                VALUES
                  (${venueId}, ${days}, ${hh.allDay},
                   ${hh.startTime}, ${hh.endTime},
                   ${hh.locationWithinVenue}::location_within_venue,
                   ${hh.notes}, true, ${hh.sourceUrl})
                ON CONFLICT DO NOTHING
                RETURNING id
              `;
              if (hhRows.length === 0) continue;
              const hhId = hhRows[0].id;
              for (const off of hh.offerings) {
                await sql`
                  INSERT INTO offerings
                    (happy_hour_id, kind, category, name, price_cents,
                     original_price_cents, discount_cents, description,
                     conditions, active, source_url)
                  VALUES
                    (${hhId}, ${off.kind}::offering_kind,
                     ${off.category}::offering_category, ${off.name},
                     ${off.priceCents}, ${off.originalPriceCents},
                     ${off.discountCents}, ${off.description},
                     ${off.conditions}, true, ${off.sourceUrl})
                `;
              }
            }
          }
          console.log(
            hasHH
              ? `  ✓ ${extracted!.happyHours.length} HH window(s) saved`
              : "  ◦ likely-HH stub kept (no times found — crowdsource)",
          );
        }
      } catch (err) {
        // Quota exhausted → ABORT the whole run; the candidate is NOT marked processed
        // so it gets retried tomorrow / after the operator bumps the quota.
        if (err instanceof PlaceDetailsQuotaError) {
          console.error(`\n${err.message}\n`);
          console.error(
            `Aborting run at candidate ${i + 1}/${candidates.length}. ` +
              `${i} candidate(s) processed so far; the rest stay unprocessed for retry.`,
          );
          throw err;
        }
        console.error(`  ERROR processing candidate ${candidate.id}:`, err);
        outcome = "error";
        // Continue loop — never throw out of the per-candidate iteration.
      }

      // ---- Mark candidate as processed -------------------------------------
      try {
        await sql`
          UPDATE seed_candidates
          SET processed_at      = now(),
              outcome           = ${outcome}::seed_outcome,
              resulting_venue_id = ${resultingVenueId},
              updated_at        = now()
          WHERE id = ${candidate.id}
        `;
      } catch (err) {
        console.error(
          `  ERROR updating seed_candidate ${candidate.id} after processing:`,
          err,
        );
      }

      // Tally
      if (outcome === "confirmed_hh") nConfirmed++;
      else if (outcome === "no_hh_found") nNoHhFound++;
      else nError++;

      // Conservative pace — brief pause between candidates to avoid rate limits.
      if (i < candidates.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // ---- Assign neighborhoods by point-in-polygon --------------------------
    // Enriched venues carry lat/lng (from Places), so this fills neighborhood_id.
    const assigned = await assignNeighborhoods(sql, city.id);

    // ---- Summary ------------------------------------------------------------
    console.log("\n── Enrichment complete ──────────────────────────────────");
    console.log(`  confirmed_hh:    ${nConfirmed}`);
    console.log(`  neighborhoods assigned: ${assigned}`);
    console.log(`  no_hh_found:     ${nNoHhFound}`);
    console.log(`  error:           ${nError}`);
    console.log(`  skipped (existing): ${nSkipped}`);
    console.log(`  filtered (no alcohol): ${nFiltered}`);
    console.log(`  total:           ${candidates.length}`);
    console.log(
      "\nNOTE: confirmed_hh venues run a structured-extraction pass; those with sourced" +
        "\nhappy_hours rows are upgraded to dataCompleteness='complete'. Operator should" +
        "\nspot-check the first ~50 (PRD §7.3 Stage C).",
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
