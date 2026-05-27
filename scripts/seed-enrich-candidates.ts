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
import { verify } from "@/lib/ai/verifier";
import { extractHappyHours } from "@/lib/ai/extractHappyHours";
import { firstOfCurrentMonth } from "@/lib/ai/budget";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";
import { fetchPlaceDetails } from "@/lib/places/placeDetails";

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

// ---------------------------------------------------------------------------
// Interpret verify() result into a seedOutcome
// ---------------------------------------------------------------------------

type SeedOutcome = "confirmed_hh" | "no_hh_explicit" | "no_hh_found" | "error";

function interpretOutcome(
  confirmed: boolean | null,
  confidence: number,
  evidence: { supportsChange: boolean }[],
  summary: string,
): SeedOutcome {
  if (confirmed === true && confidence >= 0.5) {
    return "confirmed_hh";
  }

  // Explicit "no happy hour" signal: confirmed=false with real evidence
  if (confirmed === false && evidence.length > 0) {
    return "no_hh_explicit";
  }

  // Lower-confidence negative or no evidence at all
  const lowerSummary = summary.toLowerCase();
  const explicitNegativeKeywords = [
    "no happy hour",
    "does not have a happy hour",
    "discontinued happy hour",
    "no longer offer",
    "does not offer happy hour",
  ];
  const hasExplicitNegative = explicitNegativeKeywords.some((kw) =>
    lowerSummary.includes(kw),
  );
  if (hasExplicitNegative) {
    return "no_hh_explicit";
  }

  return "no_hh_found";
}

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
    let nNoHhExplicit = 0;
    let nNoHhFound = 0;
    let nError = 0;
    let nSkipped = 0;
    const month = firstOfCurrentMonth();

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(
        `[${i + 1}/${candidates.length}] ${candidate.name} (id=${candidate.id})…`,
      );

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
        // Canonical website from Place Details so verify + extract start from the
        // venue's real site (not a guess) — this is what makes extraction work.
        const details =
          placesKey && candidate.google_place_id
            ? await fetchPlaceDetails(placesKey, candidate.google_place_id)
            : null;
        const siteUrl = details?.websiteUri ?? null;

        // ---- Run the Stage 2 verifier ----------------------------------------
        const result = await verify({
          venueName: candidate.name,
          websiteUrl: siteUrl,
          otherUrl: null,
          diffSummary:
            "Find this venue's current happy hour schedule and deals from its own website and social channels. " +
            "Return confirmed=true only if you find specific happy hour offers with times. " +
            "Return confirmed=false if you find an explicit statement that there is no happy hour. " +
            "Return confirmed=null if you cannot determine either way.",
        });

        console.log(
          `  → confirmed=${result.confirmed}, confidence=${result.confidence.toFixed(2)}, ` +
            `cost=${result.costCents}¢, tokens=${result.usage.inputTokens}in/${result.usage.outputTokens}out`,
        );

        // ---- Interpret result -----------------------------------------------
        outcome = interpretOutcome(
          result.confirmed,
          result.confidence,
          result.evidence,
          result.summary,
        );

        // Extract a website URL from evidence if available (best effort).
        // Prefer a supporting website source; fall back to any website evidence.
        const evidenceWebsiteUrl: string | null =
          siteUrl ??
          (result.evidence.find(
            (e) => e.source === "website" && e.url && e.supportsChange,
          ) ??
            result.evidence.find((e) => e.source === "website" && e.url))?.url ??
          null;

        // ---- Insert/upsert venue row ----------------------------------------
        if (outcome !== "error") {
          // Confirmed venues are inserted as 'partial', then upgraded to 'complete'
          // below if the structured extraction pass finds sourced happy_hours rows
          // (PRD §13 — every HH/offering row carries its own source_url).

          const venueStatus =
            outcome === "no_hh_explicit" ? "no_happy_hour" : "active";
          const completeness =
            outcome === "confirmed_hh" ? "partial" : "stub";
          const slug = slugify(candidate.name);

          // Upsert on google_place_id when present; otherwise straight insert.
          let venueId: string | null = null;

          if (candidate.google_place_id) {
            const rows = await sql<{ id: string }[]>`
              INSERT INTO venues
                (city_id, name, slug, address, lat, lng,
                 google_place_id, website_url, status, data_completeness)
              VALUES
                (${city.id}, ${candidate.name}, ${slug},
                 ${candidate.address}, ${candidate.lat}, ${candidate.lng},
                 ${candidate.google_place_id}, ${evidenceWebsiteUrl},
                 ${venueStatus}::venue_status, ${completeness}::data_completeness)
              ON CONFLICT (google_place_id) DO NOTHING
              RETURNING id
            `;

            if (rows.length > 0) {
              venueId = rows[0].id;
            } else {
              // Row already existed (DO NOTHING) — look it up
              const existing = await sql<{ id: string }[]>`
                SELECT id FROM venues WHERE google_place_id = ${candidate.google_place_id}
              `;
              venueId = existing[0]?.id ?? null;
            }
          } else {
            // No place_id: insert only (no unique constraint to conflict on)
            const rows = await sql<{ id: string }[]>`
              INSERT INTO venues
                (city_id, name, slug, address, lat, lng,
                 google_place_id, website_url, status, data_completeness)
              VALUES
                (${city.id}, ${candidate.name}, ${slug},
                 ${candidate.address}, ${candidate.lat}, ${candidate.lng},
                 ${null}, ${evidenceWebsiteUrl},
                 ${venueStatus}::venue_status, ${completeness}::data_completeness)
              ON CONFLICT (city_id, slug) DO NOTHING
              RETURNING id
            `;
            venueId = rows[0]?.id ?? null;
          }

          resultingVenueId = venueId;

          // ---- Structured happy-hour extraction (PRD §3.3/§3.5/§13) ----------
          // Run whenever we're not sure there's NO happy hour. verify() uses a raw
          // fetch and misses JS/PDF menus; the web_fetch extractor is the authoritative
          // HH finder, so let it try and drive the final outcome. Each returned row
          // carries a source_url (the extractor drops unsourced rows).
          if (outcome !== "no_hh_explicit" && venueId) {
            try {
              const extracted = await extractHappyHours({
                venueName: candidate.name,
                websiteUrl: evidenceWebsiteUrl,
                otherUrl: null,
              });

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

              let hhInserted = 0;
              for (const hh of extracted.happyHours) {
                const hhRows = await sql<{ id: string }[]>`
                  INSERT INTO happy_hours
                    (venue_id, day_of_week, start_time, end_time,
                     location_within_venue, notes, active, source_url)
                  VALUES
                    (${venueId}, ${hh.dayOfWeek}, ${hh.startTime}, ${hh.endTime},
                     ${hh.locationWithinVenue}::location_within_venue,
                     ${hh.notes}, true, ${hh.sourceUrl})
                  ON CONFLICT DO NOTHING
                  RETURNING id
                `;
                if (hhRows.length === 0) continue;
                hhInserted++;
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

              if (hhInserted > 0) {
                // The extractor found sourced HH — that's the authoritative signal.
                outcome = "confirmed_hh";
                await sql`
                  UPDATE venues
                  SET data_completeness = ${"complete"}::data_completeness,
                      last_verified_at = now(),
                      updated_at = now()
                  WHERE id = ${venueId}
                `;
              }
              console.log(`  → extracted ${hhInserted} sourced happy-hour row(s)`);
            } catch (err) {
              console.error(`  extraction failed for ${candidate.id}:`, err);
            }
          }
        }

        // ---- Record AI usage in ledger --------------------------------------
        await sql`
          INSERT INTO ai_usage_ledger
            (month, model, input_tokens, output_tokens, cost_cents,
             stage, city_id, prompt_hash)
          VALUES
            (${month}, ${result.model},
             ${result.usage.inputTokens}, ${result.usage.outputTokens},
             ${result.costCents}, ${"seed"}::ai_stage,
             ${city.id}, ${result.promptHash})
        `;
      } catch (err) {
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
      else if (outcome === "no_hh_explicit") nNoHhExplicit++;
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
    console.log(`  no_hh_explicit:  ${nNoHhExplicit}`);
    console.log(`  no_hh_found:     ${nNoHhFound}`);
    console.log(`  error:           ${nError}`);
    console.log(`  skipped (existing): ${nSkipped}`);
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
