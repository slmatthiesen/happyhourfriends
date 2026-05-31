/**
 * Stage B — Seed enrichment for a city (PRD §7.3).
 *
 * Loads unprocessed seed_candidates (processed_at IS NULL) for the target city
 * and discovers happy hour info via the AI extractor. Two execution paths:
 *
 *   (default, on-demand)  one extractHappyHours() agentic call per candidate.
 *   (--batch)             Message Batches API — ~50% cheaper, async, polls to
 *                         completion. Prep (Google Place Details) happens up front,
 *                         the AI runs in the batch, results are written on collect.
 *                         Resumable via a gitignored .enrich-batch/ state file.
 *                         Requests that don't return a clean record fall back to the
 *                         on-demand loop. See docs/superpowers/specs/2026-05-29-…
 *
 * Outcomes (both paths):
 *   confirmed_hh   → venue row + happy_hours/offerings with a source_url per row.
 *   no_hh_found    → venue row (status=active, dataCompleteness=stub) — "help wanted".
 *   error          → seed_candidate.outcome='error'; no venue row.
 *
 * Every AI call is recorded in ai_usage_ledger (stage='seed'); batch rows carry the
 * 50% discount. Processing is idempotent: candidates with processed_at set are skipped.
 *
 * Usage:
 *   tsx scripts/seed-enrich-candidates.ts [--city tacoma] [--limit N] [--batch]
 *
 * Required env vars:
 *   DATABASE_URL       Postgres connection string
 *   ANTHROPIC_API_KEY  Anthropic API key
 */
import "dotenv/config";
import postgres from "postgres";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import {
  extractHappyHours,
  buildExtractRequest,
  parseRecordedExtract,
  type ExtractResult,
} from "@/lib/ai/extractHappyHours";
import { costCents } from "@/lib/ai/pricing";
import { createBatch, pollBatch, streamResults, type BatchRequest } from "@/lib/ai/batch";
import {
  writeBatchState,
  findBatchState,
  deleteBatchState,
  type PrepContext,
  type BatchState,
} from "@/lib/ai/enrichBatchState";
import { firstOfCurrentMonth } from "@/lib/ai/budget";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";
import {
  fetchPlaceDetails,
  fetchPlacePhoto,
  PlaceDetailsQuotaError,
} from "@/lib/places/placeDetails";
import { saveVenuePhoto } from "@/lib/places/venuePhoto";
import { isDenylistedChain, isLikelyNoHappyHourFormat } from "@/lib/places/chainDenylist";
import { slugify, placeIdSuffix } from "@/lib/places/venueSlug";
import { deriveVenueType, isVenueType, type VenueType } from "@/lib/places/venueType";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { city: string; limit: number | null; batch: boolean } {
  const argv = process.argv.slice(2);
  const getFlag = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitStr = getFlag("--limit");
  return {
    city: getFlag("--city") ?? "tacoma",
    limit: limitStr != null ? parseInt(limitStr, 10) : null,
    batch: argv.includes("--batch"),
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
  primary_type: string | null;
  types: string[] | null;
}

interface CityRow {
  id: string;
  slug: string;
  name: string;
}

type Sql = ReturnType<typeof postgres>;

type SeedOutcome = "confirmed_hh" | "no_hh_explicit" | "no_hh_found" | "error";

/** Why a venue ended up with no happy-hour data — for the end-of-run report. */
type NoDataReason = "no_website" | "zero_windows" | "all_dropped" | "errored";
interface NoDataEntry {
  name: string;
  reason: NoDataReason;
  detail?: string;
  via?: "batch" | "fallback" | "on-demand";
}

// ---------------------------------------------------------------------------
// Shared DB writers (used by on-demand, batch collect, and fallback paths)
// ---------------------------------------------------------------------------

/** Has this candidate already been collected (processed_at set)? Used to make the
 *  batch collect loop idempotent so a resumed run never re-writes a venue's
 *  offerings or re-records its ledger spend. */
async function isCandidateProcessed(sql: Sql, candidateId: string): Promise<boolean> {
  const [r] = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM seed_candidates
    WHERE id = ${candidateId} AND processed_at IS NOT NULL
    LIMIT 1
  `;
  return !!r;
}

/**
 * Insert (or find existing) the venue row, returning its id.
 *
 * venues has TWO unique constraints: google_place_id AND (city_id, slug). Slug is
 * name-derived, so same-name multi-location chains (PRD §13: dedup on place_id, NEVER
 * name — El Güero ×3, Oregano's ×3, etc.) collide on (city_id, slug). ON CONFLICT can
 * only target one constraint, so a slug collision on a NEW place_id throws 23505.
 *
 * We enforce slug uniqueness at INSERT time, not via a pre-read: a read-then-insert is
 * TOCTOU — two same-name candidates collected in the same run race against each other's
 * reads and one still lands the base slug twice. Instead, on a slug-constraint 23505 we
 * retry with a place_id-suffixed slug (then a numeric backstop). This is correct
 * regardless of ordering/timing, so it survives crashed-then-resumed runs.
 */
async function insertVenueRow(
  sql: Sql,
  args: {
    cityId: string;
    ctx: PrepContext;
    completeness: "complete" | "stub";
    lastVerified: Date | null;
    venueType: VenueType;
  },
): Promise<string | null> {
  const { cityId, ctx, completeness, lastVerified, venueType } = args;
  const baseSlug = slugify(ctx.name);

  const doInsert = async (slug: string) => {
    // INSERT uses ON CONFLICT DO NOTHING — hours_json is only set on first insert;
    // re-enrich does NOT refresh it. Use `npm run backfill:hours` (task C5) to update existing venues.
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO venues
        (city_id, name, slug, address, lat, lng, google_place_id,
         website_url, phone, price_level, hours_json, type, status, data_completeness, last_verified_at)
      VALUES
        (${cityId}, ${ctx.name}, ${slug},
         ${ctx.address}, ${ctx.lat}, ${ctx.lng},
         ${ctx.googlePlaceId}, ${ctx.siteUrl}, ${ctx.phone},
         ${ctx.priceLevel}, ${sql.json((ctx.hoursJson ?? null) as never)}, ${venueType}::venue_type, 'active'::venue_status,
         ${completeness}::data_completeness, ${lastVerified}::timestamptz)
      ON CONFLICT (${ctx.googlePlaceId ? sql`google_place_id` : sql`city_id, slug`})
        DO NOTHING
      RETURNING id
    `;
    return inserted[0]?.id ?? null;
  };

  // Candidate slugs to try in order: base, then place_id-suffixed, then numbered.
  // Without a place_id we can't disambiguate, so we only try the base (the
  // ON CONFLICT (city_id, slug) target absorbs a collision as a no-op).
  const suffix = ctx.googlePlaceId ? placeIdSuffix(ctx.googlePlaceId) : null;
  const slugCandidates = suffix
    ? [baseSlug, `${baseSlug}-${suffix}`, `${baseSlug}-${suffix}-2`, `${baseSlug}-${suffix}-3`]
    : [baseSlug];

  let venueId: string | null = null;
  for (let i = 0; i < slugCandidates.length; i++) {
    try {
      venueId = await doInsert(slugCandidates[i]);
      break; // inserted, or absorbed by ON CONFLICT (no row) — either way, done trying
    } catch (err) {
      // Retry ONLY on a (city_id, slug) unique violation with another slug to try.
      const isSlugDup =
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "23505" &&
        String((err as { constraint_name?: string }).constraint_name ?? "").includes("slug");
      if (isSlugDup && i < slugCandidates.length - 1) continue;
      throw err;
    }
  }

  // No row returned means ON CONFLICT (google_place_id) absorbed an existing venue —
  // fetch its id so callers can still attach happy hours / mark the candidate.
  if (!venueId && ctx.googlePlaceId) {
    const [ex] = await sql<{ id: string }[]>`
      SELECT id FROM venues WHERE google_place_id = ${ctx.googlePlaceId}
    `;
    venueId = ex?.id ?? null;
  }
  return venueId;
}

/**
 * Write one enriched candidate to the DB: insert the venue (complete|stub), hero
 * photo, and any HH windows + offerings. Identical output across all three paths.
 * Returns the venue id + outcome. Does NOT mark the candidate processed.
 */
async function persistExtraction(
  sql: Sql,
  args: {
    cityId: string;
    placesKey: string | null;
    ctx: PrepContext;
    extracted: ExtractResult | null;
  },
): Promise<{ venueId: string | null; outcome: SeedOutcome; hasHH: boolean }> {
  const { cityId, placesKey, ctx, extracted } = args;
  const hasHH = (extracted?.happyHours.length ?? 0) > 0;
  const outcome: SeedOutcome = hasHH ? "confirmed_hh" : "no_hh_found";

  const completeness = hasHH ? "complete" : "stub";
  const lastVerified = hasHH ? new Date() : null;

  const base = deriveVenueType({
    primaryType: ctx.primaryType,
    types: ctx.types,
    name: ctx.name,
  });
  // A confident extractor venueType (finer than the Google base) overrides it.
  const finalType =
    extracted?.venueType && isVenueType(extracted.venueType) ? extracted.venueType : base;

  const venueId = await insertVenueRow(sql, {
    cityId,
    ctx,
    completeness,
    lastVerified,
    venueType: finalType,
  });

  // Set type when the row doesn't have one yet. For a fresh INSERT this is a no-op
  // (the INSERT already set it); for an ON CONFLICT DO NOTHING (pre-existing venue)
  // it fills the gap. The `type IS NULL` guard ensures we never clobber a value a
  // human edit / AI refine / earlier run already set.
  if (venueId) {
    await sql`UPDATE venues SET type = ${finalType}::venue_type, updated_at = now()
              WHERE id = ${venueId} AND type IS NULL`;
  }

  if (venueId && placesKey && ctx.photoName) {
    const photo = await fetchPlacePhoto(placesKey, ctx.photoName);
    if (photo) {
      const path = await saveVenuePhoto(venueId, photo.bytes);
      if (path) {
        await sql`UPDATE venues SET hero_image_url = ${path}, updated_at = now() WHERE id = ${venueId}`;
      }
    }
  }

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
  return { venueId, outcome, hasHH };
}

async function writeLedger(
  sql: Sql,
  cityId: string,
  month: string,
  extracted: ExtractResult,
): Promise<void> {
  await sql`
    INSERT INTO ai_usage_ledger
      (month, model, input_tokens, output_tokens, cost_cents,
       stage, city_id, prompt_hash)
    VALUES
      (${month}, ${extracted.model},
       ${extracted.usage.inputTokens}, ${extracted.usage.outputTokens},
       ${extracted.costCents}, ${"seed"}::ai_stage,
       ${cityId}, ${extracted.promptHash})
  `;
}

async function markProcessed(
  sql: Sql,
  candidateId: string,
  outcome: SeedOutcome,
  venueId: string | null,
  opts?: { skipOutcome?: boolean },
): Promise<void> {
  if (opts?.skipOutcome) {
    await sql`
      UPDATE seed_candidates SET processed_at = now(), updated_at = now()
      WHERE id = ${candidateId}
    `;
    return;
  }
  await sql`
    UPDATE seed_candidates
    SET processed_at = now(), outcome = ${outcome}::seed_outcome,
        resulting_venue_id = ${venueId}, updated_at = now()
    WHERE id = ${candidateId}
  `;
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
        "\nEstimated one-time cost for full Tacoma seed: ~$16 on-demand (~$8 with --batch).\n",
    );
    process.exit(0);
  }

  const placesKey = process.env.GOOGLE_PLACES_API_KEY ?? null;
  const sql = postgres(dbUrl, { max: 1 });

  try {
    // ---- Resolve city row --------------------------------------------------
    const [city] = await sql<CityRow[]>`
      SELECT id, slug, name FROM cities WHERE slug = ${args.city}
    `;
    if (!city) {
      throw new Error(
        `City '${args.city}' not found — run npm run seed:cities first.`,
      );
    }

    // ---- Batch path branches off here --------------------------------------
    if (args.batch) {
      await runBatch(sql, city, args, placesKey);
      return;
    }

    // ---- Load unprocessed candidates ---------------------------------------
    const candidates: SeedCandidate[] = await sql<SeedCandidate[]>`
      SELECT id, name, google_place_id, address, lat, lng, source_url,
             primary_type, types
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

      // National-chain gate (defensive — discovery already filters these).
      if (isDenylistedChain(candidate.name)) {
        console.log("  ↷ skip — national chain");
        await markProcessed(sql, candidate.id, "no_hh_found", null, { skipOutcome: true });
        nFiltered++;
        continue;
      }

      // Format gate: buffets / AYCE — these don't run happy hours.
      if (isLikelyNoHappyHourFormat(candidate.name)) {
        console.log("  ↷ skip — buffet/AYCE format");
        await markProcessed(sql, candidate.id, "no_hh_found", null, { skipOutcome: true });
        nFiltered++;
        continue;
      }

      // Skip candidates already mapped to a venue (deduped by place_id).
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
        const details =
          placesKey && candidate.google_place_id
            ? await fetchPlaceDetails(placesKey, candidate.google_place_id)
            : null;

        // Alcohol gate — only when details actually came back.
        if (details && !details.servesAlcohol) {
          console.log("  ↷ filtered — Google reports no alcohol served");
          await markProcessed(sql, candidate.id, "no_hh_found", null, { skipOutcome: true });
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
              cityName: city.name,
            })
          : null;

        if (extracted) {
          await writeLedger(sql, city.id, month, extracted);
          console.log(
            `  → confidence=${extracted.confidence.toFixed(2)}, cost=${extracted.costCents}¢, ` +
              `${extracted.happyHours.length} window(s)`,
          );
        } else {
          console.log("  → no website on file");
        }

        const ctx: PrepContext = {
          candidateId: candidate.id,
          name: candidate.name,
          address: candidate.address,
          lat: candidate.lat,
          lng: candidate.lng,
          googlePlaceId: candidate.google_place_id,
          siteUrl,
          phone: details?.phone ?? null,
          priceLevel: details?.priceLevel ?? null,
          hoursJson: details?.openingPeriods ?? null,
          photoName: details?.photoName ?? null,
          primaryType: candidate.primary_type ?? null,
          types: candidate.types ?? null,
        };
        const persisted = await persistExtraction(sql, {
          cityId: city.id,
          placesKey,
          ctx,
          extracted,
        });
        outcome = persisted.outcome;
        resultingVenueId = persisted.venueId;
        console.log(
          persisted.hasHH
            ? `  ✓ ${extracted!.happyHours.length} HH window(s) saved`
            : "  ◦ likely-HH stub kept (no times found — crowdsource)",
        );
      } catch (err) {
        // Quota exhausted → ABORT; the candidate is NOT marked processed so it retries.
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
      }

      // ---- Mark candidate as processed -------------------------------------
      try {
        await markProcessed(sql, candidate.id, outcome, resultingVenueId);
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

      // Conservative pace between candidates to avoid rate limits.
      if (i < candidates.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // ---- Assign neighborhoods by point-in-polygon --------------------------
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

// ---------------------------------------------------------------------------
// Batch path (--batch)
// ---------------------------------------------------------------------------

interface ReportTally {
  full: number;
  stubs: number;
  filtered: number;
  skipped: number;
  errored: number;
  fallbackCount: number;
  totalRequests: number;
  alreadyDone: number;
  batchCostCents: number;
  fallbackCostCents: number;
  noData: NoDataEntry[];
}

async function runBatch(
  sql: Sql,
  city: CityRow,
  args: { city: string; limit: number | null },
  placesKey: string | null,
): Promise<void> {
  const month = firstOfCurrentMonth();
  const tally: ReportTally = {
    full: 0,
    stubs: 0,
    filtered: 0,
    skipped: 0,
    errored: 0,
    fallbackCount: 0,
    totalRequests: 0,
    alreadyDone: 0,
    batchCostCents: 0,
    fallbackCostCents: 0,
    noData: [],
  };

  // ---- Resume an in-flight batch if one exists -----------------------------
  let state = findBatchState(city.slug);
  if (state) {
    console.log(`Resuming in-flight batch ${state.batchId} for '${city.slug}'…`);
  } else {
    state = await prepAndSubmit(sql, city, args, placesKey, tally);
    if (!state) {
      console.log("No eligible candidates to batch.");
      await finalize(sql, city, tally);
      return;
    }
  }

  // ---- Poll to completion --------------------------------------------------
  console.log(`Polling batch ${state.batchId} every 300s until complete…`);
  await pollBatch(state.batchId, {
    onTick: (b) =>
      console.log(
        `  …status=${b.processing_status} ` +
          `(succeeded ${b.request_counts.succeeded}, errored ${b.request_counts.errored}, ` +
          `processing ${b.request_counts.processing})`,
      ),
  });

  // ---- Collect + write -----------------------------------------------------
  // model + promptHash are input-independent (prompt template + configured model),
  // so resolve once for ledger attribution rather than per result.
  const { model: extractorModel, promptHash } = buildExtractRequest({
    venueName: "",
    websiteUrl: null,
    otherUrl: null,
  });

  const fallback: PrepContext[] = [];
  for await (const res of streamResults(state.batchId)) {
    const ctx = state.contexts[res.custom_id];
    if (!ctx) continue; // unknown id — skip defensively

    // Idempotent resume: if this candidate was already collected on a prior (crashed)
    // run, skip it entirely — don't re-write its venue/offerings or re-record spend.
    if (await isCandidateProcessed(sql, ctx.candidateId)) {
      tally.alreadyDone++;
      continue;
    }
    tally.totalRequests++;

    if (res.result.type !== "succeeded") {
      fallback.push(ctx);
      continue;
    }

    // Per-item resilience: a single malformed record (bad slug, non-array happyHours,
    // a DB hiccup) must NOT abort the whole collect — it would force a resume that just
    // surfaces the next bad item. Mirror the on-demand path: catch per item, record an
    // error, and keep going. The batch results are still on Anthropic's side, so a
    // genuinely transient failure can be retried by re-running (the candidate stays
    // unprocessed because we only markProcessed on success).
    try {
      const message: Message = res.result.message;
      const parsed = parseRecordedExtract(message);
      if (!parsed.recorded) {
        fallback.push(ctx);
        continue;
      }

      const usage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
      const extracted: ExtractResult = {
        happyHours: parsed.happyHours,
        confidence: parsed.confidence,
        summary: parsed.summary,
        venueType: parsed.venueType,
        usage,
        costCents: costCents(extractorModel, usage, { batch: true }),
        promptHash,
        model: extractorModel,
      };

      await writeLedger(sql, city.id, month, extracted);
      tally.batchCostCents += extracted.costCents;

      const persisted = await persistExtraction(sql, { cityId: city.id, placesKey, ctx, extracted });
      await markProcessed(sql, ctx.candidateId, persisted.outcome, persisted.venueId);

      if (persisted.hasHH) {
        tally.full++;
        console.log(`  ✓ ${ctx.name}: ${extracted.happyHours.length} window(s)`);
      } else {
        tally.stubs++;
        tally.noData.push({
          name: ctx.name,
          reason: parsed.rawWindowCount > 0 ? "all_dropped" : "zero_windows",
          detail: `conf ${extracted.confidence.toFixed(2)}${ctx.siteUrl ? `, ${ctx.siteUrl}` : ""}`,
          via: "batch",
        });
        console.log(`  ◦ ${ctx.name}: stub (no usable windows)`);
      }
    } catch (err) {
      // Per-item resilience: record the failure and keep going. We do NOT
      // markProcessed, so the candidate stays unprocessed and a re-run retries it.
      console.error(`  collect error for ${ctx.name}:`, err);
      tally.errored++;
      tally.noData.push({ name: ctx.name, reason: "errored", detail: String(err), via: "batch" });
    }
  }

  // ---- On-demand fallback for stragglers -----------------------------------
  if (fallback.length > 0) {
    console.log(`\n${fallback.length} request(s) need on-demand fallback…`);
    for (const ctx of fallback) {
      tally.fallbackCount++;
      console.log(`  fallback: ${ctx.name}…`);
      try {
        const extracted = ctx.siteUrl
          ? await extractHappyHours({ venueName: ctx.name, websiteUrl: ctx.siteUrl, otherUrl: null, cityName: city.name })
          : null;
        if (extracted) {
          await writeLedger(sql, city.id, month, extracted);
          tally.fallbackCostCents += extracted.costCents;
        }
        const persisted = await persistExtraction(sql, { cityId: city.id, placesKey, ctx, extracted });
        await markProcessed(sql, ctx.candidateId, persisted.outcome, persisted.venueId);
        if (persisted.hasHH) {
          tally.full++;
        } else {
          tally.stubs++;
          tally.noData.push({
            name: ctx.name,
            reason: ctx.siteUrl ? "zero_windows" : "no_website",
            detail: extracted ? `conf ${extracted.confidence.toFixed(2)}` : undefined,
            via: "fallback",
          });
        }
      } catch (err) {
        console.error(`  fallback error for ${ctx.name}:`, err);
        tally.errored++;
        tally.noData.push({ name: ctx.name, reason: "errored", detail: String(err), via: "fallback" });
        await markProcessed(sql, ctx.candidateId, "error", null);
      }
    }
  }

  deleteBatchState(city.slug, state.batchId);
  await finalize(sql, city, tally);
}

/** Phase 1+2: run the non-AI gates, write inline outcomes, submit the batch, persist state. */
async function prepAndSubmit(
  sql: Sql,
  city: CityRow,
  args: { city: string; limit: number | null },
  placesKey: string | null,
  tally: ReportTally,
): Promise<BatchState | null> {
  const candidates = await sql<SeedCandidate[]>`
    SELECT id, name, google_place_id, address, lat, lng, source_url,
           primary_type, types
    FROM seed_candidates
    WHERE city_id = ${city.id} AND processed_at IS NULL
    ORDER BY created_at ASC
    ${args.limit != null ? sql`LIMIT ${args.limit}` : sql``}
  `;
  if (candidates.length === 0) return null;
  console.log(`Prepping ${candidates.length} candidates for '${args.city}'…`);

  const requests: BatchRequest[] = [];
  const contexts: Record<string, PrepContext> = {};

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`[${i + 1}/${candidates.length}] prep ${c.name}…`);

    if (isDenylistedChain(c.name) || isLikelyNoHappyHourFormat(c.name)) {
      await markProcessed(sql, c.id, "no_hh_found", null, { skipOutcome: true });
      tally.filtered++;
      continue;
    }
    if (c.google_place_id) {
      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM venues WHERE google_place_id = ${c.google_place_id}
      `;
      if (existing) {
        await sql`
          UPDATE seed_candidates SET processed_at = now(),
            resulting_venue_id = ${existing.id}, updated_at = now() WHERE id = ${c.id}
        `;
        tally.skipped++;
        continue;
      }
    }

    let details = null;
    try {
      details =
        placesKey && c.google_place_id
          ? await fetchPlaceDetails(placesKey, c.google_place_id)
          : null;
    } catch (err) {
      if (err instanceof PlaceDetailsQuotaError) throw err;
      console.error(`  prep error for ${c.name}:`, err);
    }
    if (details && !details.servesAlcohol) {
      await markProcessed(sql, c.id, "no_hh_found", null, { skipOutcome: true });
      tally.filtered++;
      continue;
    }

    const ctx: PrepContext = {
      candidateId: c.id,
      name: c.name,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      googlePlaceId: c.google_place_id,
      siteUrl: details?.websiteUri ?? null,
      phone: details?.phone ?? null,
      priceLevel: details?.priceLevel ?? null,
      hoursJson: details?.openingPeriods ?? null,
      photoName: details?.photoName ?? null,
      primaryType: c.primary_type ?? null,
      types: c.types ?? null,
    };

    // No website → no AI possible; write the stub now and mark processed.
    if (!ctx.siteUrl) {
      const persisted = await persistExtraction(sql, {
        cityId: city.id,
        placesKey,
        ctx,
        extracted: null,
      });
      await markProcessed(sql, c.id, persisted.outcome, persisted.venueId);
      tally.stubs++;
      tally.noData.push({ name: c.name, reason: "no_website" });
      continue;
    }

    const built = buildExtractRequest({ venueName: ctx.name, websiteUrl: ctx.siteUrl, otherUrl: null, cityName: city.name });
    requests.push({ custom_id: c.id, params: built.params });
    contexts[c.id] = ctx;
  }

  if (requests.length === 0) return null;

  console.log(`Submitting batch of ${requests.length} request(s)…`);
  const batchId = await createBatch(requests);
  const state: BatchState = { batchId, citySlug: city.slug, cityId: city.id, contexts };
  writeBatchState(state); // persist immediately so a crash can resume
  console.log(`  batch id: ${batchId}`);
  return state;
}

async function finalize(sql: Sql, city: CityRow, tally: ReportTally): Promise<void> {
  const assigned = await assignNeighborhoods(sql, city.id);
  const collected = tally.full + tally.stubs;
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

  console.log("\n── Enrichment complete (batch) ───────────────────────────");
  console.log(`Venues collected:        ${collected}`);
  console.log(`  ├─ full data:          ${tally.full}`);
  console.log(`  └─ stubs (no data):    ${tally.stubs}`);
  console.log(`neighborhoods assigned:  ${assigned}`);
  console.log("\nNot processed via batch:");
  console.log(`  filtered:               ${tally.filtered}`);
  console.log(`  skipped (existing):     ${tally.skipped}`);
  if (tally.alreadyDone > 0) {
    console.log(`  already collected (resume): ${tally.alreadyDone}`);
  }
  console.log(`  errored:                ${tally.errored}`);
  console.log(
    `\nCost:  batch ${usd(tally.batchCostCents)}  ·  on-demand fallback ${usd(tally.fallbackCostCents)}  ·  total ${usd(tally.batchCostCents + tally.fallbackCostCents)}`,
  );
  console.log(
    `Fallback (on-demand) count: ${tally.fallbackCount} / ${tally.totalRequests} requests`,
  );

  const order: NoDataReason[] = ["no_website", "zero_windows", "all_dropped", "errored"];
  const labels: Record<NoDataReason, string> = {
    no_website: "no website on file",
    zero_windows: "website, 0 windows extracted",
    all_dropped: "recorded but all rows dropped (§13 / denylist)",
    errored: "errored",
  };
  console.log(
    `\n── Venues with NO happy-hour data (${tally.noData.length}) — improve extraction here ──`,
  );
  for (const reason of order) {
    const list = tally.noData.filter((e) => e.reason === reason);
    if (list.length === 0) continue;
    console.log(`  ${labels[reason]} (${list.length}):`);
    for (const e of list) {
      const via = e.via ? `  [via ${e.via}]` : "";
      const detail = e.detail ? `  (${e.detail})` : "";
      console.log(`    - ${e.name}${detail}${via}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
