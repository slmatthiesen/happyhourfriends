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
 * Runs via the **Batch API by default** (~50% cheaper, async submit+poll — same path
 * as seed:enrich). Use --quick for the synchronous, live-output path (good for small
 * samples). --dry-run is $0 either way (triage only).
 *
 * Usage:
 *   tsx scripts/reextract-stubs.ts --city tucson --dry-run      # $0: triage only, who qualifies
 *   tsx scripts/reextract-stubs.ts --city tucson [--limit N]    # PAID, BATCH (~$0.015/venue)
 *   tsx scripts/reextract-stubs.ts --city tucson --quick        # PAID, synchronous (~$0.03/venue)
 *
 * Required env: DATABASE_URL, ANTHROPIC_API_KEY (for the real run), GOOGLE_PLACES_API_KEY optional.
 */
import "dotenv/config";
import postgres from "postgres";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import {
  extractHappyHours,
  buildExtractRequest,
  parseRecordedExtract,
  extractorMetadata,
  type ExtractResult,
} from "@/lib/ai/extractHappyHours";
import { createBatch, pollBatch, streamResults, type BatchRequest } from "@/lib/ai/batch";
import { costCents } from "@/lib/ai/pricing";
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

/** A stub that passed triage and is ready to extract. */
interface Qualified {
  venue: StubVenue;
  websiteUrl: string | null;
  priorityUrls: string[];
}

interface Counters {
  venuesRecovered: number;
  windowsLive: number;
  windowsHidden: number;
  stillEmpty: number;
  spentCents: number;
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
    quick: a.includes("--quick"), // synchronous path; default is the Batch API
    collect: get("--collect"), // resume: persist an already-ended batch by id
  };
}

/** Attach extracted windows to an EXISTING venue. Mirrors persistExtraction's inserts. */
async function attachWindows(
  sql: Sql,
  venueId: string,
  extracted: ExtractResult,
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

/** Ledger + attach + promote for one extracted result. Shared by both paths. */
async function persistResult(
  sql: Sql,
  cityId: string,
  month: string,
  v: StubVenue,
  extracted: ExtractResult,
  c: Counters,
): Promise<void> {
  c.spentCents += extracted.costCents;
  await sql`
    INSERT INTO ai_usage_ledger
      (month, model, input_tokens, output_tokens, cost_cents, stage, city_id, prompt_hash)
    VALUES
      (${month}, ${extracted.model}, ${extracted.usage.inputTokens}, ${extracted.usage.outputTokens},
       ${extracted.costCents}, 'seed'::ai_stage, ${cityId}, ${extracted.promptHash})
  `;

  if (extracted.happyHours.length === 0) {
    c.stillEmpty++;
    console.log(`  ◦ ${v.name}: still no window (conf ${extracted.confidence.toFixed(2)})`);
    return;
  }

  const { active, hidden } = await attachWindows(sql, v.id, extracted);
  c.windowsLive += active;
  c.windowsHidden += hidden;

  if (active > 0) {
    await sql`
      UPDATE venues
      SET data_completeness = 'complete'::data_completeness,
          last_verified_at = now(), updated_at = now()
      WHERE id = ${v.id}
    `;
    c.venuesRecovered++;
    console.log(`  ✓ ${v.name}: +${active} live window(s)${hidden ? ` (+${hidden} hidden)` : ""}`);
  } else if (hidden > 0) {
    console.log(`  ⊘ ${v.name}: +${hidden} window(s) hidden for review`);
  } else {
    c.stillEmpty++;
    console.log(`  ◦ ${v.name}: windows already present (no change)`);
  }
}

/** Synchronous path: one live model call per venue (use for small samples). */
async function runQuick(
  sql: Sql, cityId: string, cityName: string, month: string, qualified: Qualified[], c: Counters,
) {
  for (const q of qualified) {
    const extracted = await extractHappyHours({
      venueName: q.venue.name,
      websiteUrl: q.websiteUrl,
      otherUrl: null,
      cityName,
      priorityUrls: q.priorityUrls,
    });
    await persistResult(sql, cityId, month, q.venue, extracted, c);
  }
}

/** Default path: submit every request as one Batch (~50% cheaper), poll, then persist. */
async function runBatch(
  sql: Sql, cityId: string, cityName: string, month: string, qualified: Qualified[], c: Counters,
) {
  const { model, promptHash } = extractorMetadata();
  const requests: BatchRequest[] = [];
  const ctx: Record<string, StubVenue> = {};

  // Build each request (fetches pages ourselves — free). Skip venues with no fetchable
  // content: no point paying for an empty request.
  for (const q of qualified) {
    const built = await buildExtractRequest({
      venueName: q.venue.name,
      websiteUrl: q.websiteUrl,
      otherUrl: null,
      cityName,
      priorityUrls: q.priorityUrls,
    });
    if (built.fetchedUrls.length === 0) {
      c.stillEmpty++;
      console.log(`  ◦ ${q.venue.name}: no fetchable content (skipped)`);
      continue;
    }
    requests.push({ custom_id: q.venue.id, params: built.params });
    ctx[q.venue.id] = q.venue;
  }

  if (requests.length === 0) {
    console.log("Nothing to submit (no venue had fetchable content).");
    return;
  }

  console.log(`Submitting ${requests.length} request(s) to the Batch API…`);
  const batchId = await createBatch(requests);
  console.log(`  batch ${batchId} — polling (this can take a while; ~50% cheaper than --quick)`);
  await pollBatch(batchId, {
    onTick: (b) =>
      console.log(
        `  …${b.processing_status}: ${b.request_counts.succeeded} ok / ${b.request_counts.errored} err / ${b.request_counts.processing} processing`,
      ),
  });

  for await (const res of streamResults(batchId)) {
    const v = ctx[res.custom_id];
    if (!v) continue;
    if (res.result.type !== "succeeded") {
      c.stillEmpty++;
      console.log(`  ✗ ${v.name}: batch request ${res.result.type}`);
      continue;
    }
    const message: Message = res.result.message;
    const parsed = parseRecordedExtract(message);
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
      costCents: costCents(model, usage, { batch: true }),
      promptHash,
      model,
    };
    await persistResult(sql, cityId, month, v, extracted, c);
  }
}

/**
 * Resume: persist an already-ended batch by id (custom_id === venue id). Recovers
 * results when the original poll was killed before the batch finished — no re-spend,
 * the results live on Anthropic for 24h. Idempotent (attachWindows ON CONFLICT DO NOTHING).
 */
async function runCollect(sql: Sql, batchId: string, month: string, c: Counters) {
  const { model, promptHash } = extractorMetadata();
  let seen = 0;
  for await (const res of streamResults(batchId)) {
    seen++;
    const rows = await sql<(StubVenue & { city_id: string })[]>`
      SELECT v.id, v.name, v.website_url, v.type::text AS type, sc.primary_type, v.city_id
      FROM venues v
      LEFT JOIN seed_candidates sc ON sc.resulting_venue_id = v.id
      WHERE v.id = ${res.custom_id}
    `;
    const v = rows[0];
    if (!v) {
      console.log(`  ? ${res.custom_id}: no matching venue (skipped)`);
      continue;
    }
    if (res.result.type !== "succeeded") {
      console.log(`  ✗ ${v.name}: ${res.result.type}`);
      continue;
    }
    const message: Message = res.result.message;
    const parsed = parseRecordedExtract(message);
    const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
    const extracted: ExtractResult = {
      happyHours: parsed.happyHours,
      confidence: parsed.confidence,
      summary: parsed.summary,
      venueType: parsed.venueType,
      usage,
      costCents: costCents(model, usage, { batch: true }),
      promptHash,
      model,
    };
    await persistResult(sql, v.city_id, month, v, extracted, c);
  }
  console.log(`\n  collected ${seen} result(s) from ${batchId}`);
}

async function main() {
  const args = parseArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  if (!args.dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY required for the real run (use --dry-run for a $0 preview).");
    process.exit(1);
  }

  try {
    // Resume mode: persist an already-submitted batch by id (no re-spend).
    if (args.collect) {
      const c: Counters = { venuesRecovered: 0, windowsLive: 0, windowsHidden: 0, stillEmpty: 0, spentCents: 0 };
      console.log(`[COLLECT] pulling results from ${args.collect}…`);
      await runCollect(sql, args.collect, firstOfCurrentMonth(), c);
      console.log("\n── Collect complete ──────────────────────────────────────");
      console.log(`  venues recovered → live: ${c.venuesRecovered}`);
      console.log(`  windows added (live):    ${c.windowsLive}`);
      console.log(`  windows hidden:          ${c.windowsHidden}`);
      console.log(`  ledgered spend (batch):  $${(c.spentCents / 100).toFixed(2)}`);
      return;
    }

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

    const mode = args.dryRun ? "DRY RUN" : args.quick ? "QUICK (sync)" : "BATCH";
    const perVenue = args.quick ? 0.03 : 0.015;
    console.log(
      `[${mode}] ${stubs.length} stub venue(s) with a website in ${city.name}.\n` +
        (args.dryRun
          ? "Triage only — no model calls, no spend.\n"
          : `Estimated cost: ~$${(stubs.length * perVenue).toFixed(2)}.\n`),
    );

    // Triage every stub ($0): keep the ones with a real, extractable site.
    const qualified: Qualified[] = [];
    let socialSkipped = 0;
    for (const v of stubs) {
      const verdict = await triageSite({ websiteUri: v.website_url, name: v.name, cityName: city.name });
      const likelihood = hhLikelihood({ primaryType: v.primary_type, types: null, name: v.name });
      const decided = resolveEnrichAction(verdict, likelihood);
      if (decided.action !== "extract") {
        socialSkipped++;
        continue;
      }
      qualified.push({
        venue: v,
        websiteUrl: verdict.kind === "real" ? verdict.url : null,
        priorityUrls: decided.priorityUrls,
      });
      if (args.dryRun) console.log(`  ⟳ ${v.name}  (${verdict.hhSignalUrls.length} HH link(s))`);
    }

    const month = firstOfCurrentMonth();
    const c: Counters = { venuesRecovered: 0, windowsLive: 0, windowsHidden: 0, stillEmpty: 0, spentCents: 0 };

    if (!args.dryRun) {
      if (args.quick) await runQuick(sql, city.id, city.name, month, qualified, c);
      else await runBatch(sql, city.id, city.name, month, qualified, c);
    }

    console.log("\n── Re-extract complete ───────────────────────────────────");
    console.log(`  stubs examined:          ${stubs.length}`);
    console.log(`  qualified (real site):   ${qualified.length}`);
    console.log(`  social-only (skipped):   ${socialSkipped}`);
    if (!args.dryRun) {
      console.log(`  venues recovered → live: ${c.venuesRecovered}`);
      console.log(`  windows added (live):    ${c.windowsLive}`);
      console.log(`  windows hidden:          ${c.windowsHidden}`);
      console.log(`  still no window:         ${c.stillEmpty}`);
      console.log(`  spend:                   $${(c.spentCents / 100).toFixed(2)}`);
    } else {
      console.log(
        `\n  Re-run without --dry-run to extract (≈ $${(qualified.length * 0.015).toFixed(2)} batch / ` +
          `$${(qualified.length * 0.03).toFixed(2)} --quick for the ${qualified.length} that qualify).`,
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
