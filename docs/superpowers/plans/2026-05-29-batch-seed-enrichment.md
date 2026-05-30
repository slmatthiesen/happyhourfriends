# Batch-API seed enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run seed happy-hour enrichment through the Anthropic Message Batches API (~50% cost) via a `--batch` flag on `seed:enrich`, and add a Tucson, AZ city row so the pipeline can run there.

**Architecture:** Approach A from the spec — each candidate is one single-shot batch request that keeps the server-side `web_search`/`web_fetch` + `record_happy_hours` custom tool; the model calling `record_happy_hours` ends the request and its input is our data. Requests that don't return a clean record fall back to the existing on-demand agentic loop. One command does Google prep → submit → poll (300s) → collect → write, resumable via a gitignored state file. Submission moderation is untouched.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (`messages.batches`), `postgres.js`, `tsx`. No test framework in this repo — verification is `tsc --noEmit` + `eslint` + framework-free `tsx -e` assertion snippets + a guarded `--limit` smoke run.

**Spec:** `docs/superpowers/specs/2026-05-29-batch-seed-enrichment-design.md`

## File structure

- Modify `lib/ai/pricing.ts` — add optional `{ batch }` 0.5× discount to `costCents`.
- Modify `lib/ai/extractHappyHours.ts` — export `buildExtractRequest`, `parseRecordedExtract`, `normaliseRawExtract`; re-implement the loop on top (no behavior change).
- Create `lib/ai/batch.ts` — `createBatch`, `pollBatch`, `streamResults` over `messages.batches`.
- Create `lib/ai/enrichBatchState.ts` — read/write/find/delete the `.enrich-batch/<city>-<batchId>.json` state file.
- Modify `.gitignore` — ignore `.enrich-batch/`.
- Modify `scripts/seed-enrich-candidates.ts` — extract a shared `persistExtraction` helper; add the `--batch` phased orchestration + report.
- Modify `scripts/seed-cities.ts` — add the Tucson city row.

---

### Task 1: Batch discount in pricing

**Files:**
- Modify: `lib/ai/pricing.ts`

- [ ] **Step 1: Add the `batch` option to `costCents`**

Replace the `costCents` function in `lib/ai/pricing.ts` with:

```ts
/**
 * Cost of a call in whole cents, rounded up (conservative for budget capping).
 * Pass { batch: true } for Message Batches API calls — billed at 50% of standard.
 */
export function costCents(
  model: string,
  usage: Usage,
  opts?: { batch?: boolean },
): number {
  const { inputPerM, outputPerM } = priceFor(model);
  const dollars =
    (usage.inputTokens / 1_000_000) * inputPerM +
    (usage.outputTokens / 1_000_000) * outputPerM;
  const discounted = opts?.batch ? dollars * 0.5 : dollars;
  return Math.ceil(discounted * 100);
}
```

- [ ] **Step 2: Verify discount halves cost**

Run:
```bash
npx tsx -e "import {costCents} from './lib/ai/pricing'; const u={inputTokens:1_000_000,outputTokens:1_000_000}; const full=costCents('claude-haiku-4-5',u); const half=costCents('claude-haiku-4-5',u,{batch:true}); if(full!==600||half!==300){console.error('FAIL',{full,half});process.exit(1)} console.log('PASS full',full,'batch',half)"
```
Expected: `PASS full 600 batch 300`

- [ ] **Step 3: Commit**

```bash
git add lib/ai/pricing.ts && git commit -m "feat(pricing): 50% batch discount option in costCents"
```

---

### Task 2: Refactor extractHappyHours into reusable build + parse

**Files:**
- Modify: `lib/ai/extractHappyHours.ts`

Goal: expose `buildExtractRequest` (the single request params), `normaliseRawExtract` (raw JSON → §13-clean result), and `parseRecordedExtract` (a returned `Message` → parsed result + `recorded` flag). Re-implement `extractHappyHours()` on top of them with no behavior change.

- [ ] **Step 1: Add the `Message` + params imports**

In the type import block at the top (currently importing from `@anthropic-ai/sdk/resources/messages`), add `Message` and `MessageCreateParamsNonStreaming`:

```ts
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  ToolChoiceTool,
  ToolUnion,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
```

- [ ] **Step 2: Add the new exported types + functions** (insert just above `export async function extractHappyHours`)

```ts
/** The single batch/extraction request params, plus the metadata callers need to price + attribute it. */
export interface ExtractRequest {
  params: MessageCreateParamsNonStreaming;
  promptHash: string;
  model: string;
}

/** Build the one-shot request used by both the on-demand loop and the Batch API. */
export function buildExtractRequest(input: ExtractInput): ExtractRequest {
  const loaded = loadPrompt("seed-extract-hh.md");
  const { system: rawSystem, user: rawUser } = splitPrompt(loaded.content);
  const system = fillPlaceholders(rawSystem, input);
  const userText = fillPlaceholders(rawUser, input);
  return {
    params: {
      model: MODELS.extractor,
      max_tokens: 8192,
      system,
      tools: TOOLS,
      messages: [{ role: "user", content: userText }],
    },
    promptHash: loaded.hash,
    model: MODELS.extractor,
  };
}

/** Normalised, §13-clean extraction plus how many raw windows the model proposed before filtering. */
export interface NormalisedExtract {
  happyHours: ExtractedHappyHour[];
  confidence: number;
  summary: string;
  /** Count of windows the model proposed before §13/denylist filtering — lets callers tell "model found nothing" from "all dropped". */
  rawWindowCount: number;
}

/** §13 normalisation shared by the loop and the batch path. */
export function normaliseRawExtract(raw: RawExtract): NormalisedExtract {
  const happyHours: ExtractedHappyHour[] = (raw.happyHours ?? [])
    .map(normaliseHappyHour)
    .filter((hh): hh is ExtractedHappyHour => hh !== null);
  return {
    happyHours,
    confidence: Math.min(1, Math.max(0, raw.confidence ?? 0)),
    summary: raw.summary ?? "",
    rawWindowCount: (raw.happyHours ?? []).length,
  };
}

/** Parse a single returned Message: pull the record_happy_hours tool call (or salvage JSON text). */
export function parseRecordedExtract(
  message: Message,
): NormalisedExtract & { recorded: boolean } {
  const recordCall = message.content.find(
    (b): b is ToolUseBlock =>
      b.type === "tool_use" && b.name === "record_happy_hours",
  );
  if (recordCall) {
    return { ...normaliseRawExtract(recordCall.input as RawExtract), recorded: true };
  }
  // No clean tool call — try to salvage JSON the model left as text.
  let fallbackText = "";
  for (const block of message.content) {
    if (block.type === "text") fallbackText = block.text;
  }
  if (fallbackText) {
    try {
      return { ...normaliseRawExtract(parseJsonResponse<RawExtract>(fallbackText)), recorded: false };
    } catch {
      /* fall through to empty */
    }
  }
  return { happyHours: [], confidence: 0, summary: "", rawWindowCount: 0, recorded: false };
}
```

- [ ] **Step 3: Re-implement `extractHappyHours()` on the new helpers**

Replace the body of `extractHappyHours` (everything inside the function) with:

```ts
export async function extractHappyHours(
  input: ExtractInput,
): Promise<ExtractResult> {
  const { params, promptHash, model } = buildExtractRequest(input);
  const messages: MessageParam[] = [...params.messages];

  const summedUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  const forceRecord: ToolChoiceTool = { type: "tool", name: "record_happy_hours" };

  let lastMessage: Message | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastTurn = turn === MAX_TURNS - 1;
    const response = await anthropic().messages.create({
      ...params,
      messages,
      ...(lastTurn ? { tool_choice: forceRecord } : {}),
    });
    lastMessage = response;

    summedUsage.inputTokens += response.usage.input_tokens;
    summedUsage.outputTokens += response.usage.output_tokens;

    if (process.env.EXTRACT_DEBUG) {
      console.error(
        `[extract] turn ${turn} stop=${response.stop_reason} blocks=[${response.content
          .map((b) => (b.type === "tool_use" ? `tool_use:${b.name}` : b.type))
          .join(", ")}]`,
      );
    }

    const recorded = response.content.some(
      (b) => b.type === "tool_use" && b.name === "record_happy_hours",
    );
    if (recorded) break;

    // web_fetch runs server-side → pause_turn; resume by echoing content back.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    // Model ended without recording — nudge it to call the tool next turn.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content:
        "Call record_happy_hours now with everything you found (happyHours: [] and confidence 0 if none).",
    });
  }

  const parsed = lastMessage
    ? parseRecordedExtract(lastMessage)
    : { happyHours: [], confidence: 0, summary: "", rawWindowCount: 0, recorded: false };

  return {
    happyHours: parsed.happyHours,
    confidence: parsed.confidence,
    summary: parsed.summary,
    usage: summedUsage,
    costCents: calcCostCents(model, summedUsage),
    promptHash,
    model,
  };
}
```

Note: `RawExtract` is already declared in this file; `parseJsonResponse` and `calcCostCents` are already imported. No other edits needed.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (the two pre-existing Phase 0 issues are unrelated).

- [ ] **Step 5: Verify parse extracts a record tool call**

Run:
```bash
npx tsx -e "
import {parseRecordedExtract} from './lib/ai/extractHappyHours';
const msg={content:[{type:'tool_use',name:'record_happy_hours',input:{happyHours:[{daysOfWeek:[1,2,3,4,5],allDay:false,startTime:'16:00',endTime:'18:00',locationWithinVenue:'bar',sourceUrl:'https://x.test/hh',offerings:[{kind:'drink',category:'beer',sourceUrl:'https://x.test/hh'}]}],confidence:0.8,summary:'ok'}}],usage:{input_tokens:10,output_tokens:5}};
const r=parseRecordedExtract(msg as any);
if(!r.recorded||r.happyHours.length!==1||r.rawWindowCount!==1){console.error('FAIL',JSON.stringify(r));process.exit(1)}
const prose={content:[{type:'text',text:'no json here'}],usage:{input_tokens:1,output_tokens:1}};
const p=parseRecordedExtract(prose as any);
if(p.recorded||p.happyHours.length!==0){console.error('FAIL prose',JSON.stringify(p));process.exit(1)}
console.log('PASS recorded',r.happyHours.length,'prose recorded',p.recorded);
"
```
Expected: `PASS recorded 1 prose recorded false`

- [ ] **Step 6: Commit**

```bash
git add lib/ai/extractHappyHours.ts && git commit -m "refactor(extract): split buildExtractRequest + parseRecordedExtract from the loop"
```

---

### Task 3: Batch helpers

**Files:**
- Create: `lib/ai/batch.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Thin wrappers over the Anthropic Message Batches API for the seed-enrichment
 * batch path. Each request is a single-shot extraction (see lib/ai/extractHappyHours).
 */
import type {
  MessageBatch,
  MessageBatchIndividualResponse,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";

import { anthropic } from "@/lib/ai/anthropic";

export interface BatchRequest {
  custom_id: string;
  params: MessageCreateParamsNonStreaming;
}

/** Submit a batch; returns the batch id. */
export async function createBatch(requests: BatchRequest[]): Promise<string> {
  const batch = await anthropic().messages.batches.create({ requests });
  return batch.id;
}

/**
 * Poll until the batch finishes (processing_status === "ended"). Logs progress
 * each tick. Default 300s — local single-venue extraction alone can exceed 60s,
 * so tighter polling buys nothing for a job that can take hours.
 */
export async function pollBatch(
  id: string,
  opts?: { intervalMs?: number; onTick?: (b: MessageBatch) => void },
): Promise<MessageBatch> {
  const intervalMs = opts?.intervalMs ?? 300_000;
  for (;;) {
    const batch = await anthropic().messages.batches.retrieve(id);
    opts?.onTick?.(batch);
    if (batch.processing_status === "ended") return batch;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Async-iterate the per-request results once the batch has ended. */
export async function* streamResults(
  id: string,
): AsyncGenerator<MessageBatchIndividualResponse> {
  for await (const result of await anthropic().messages.batches.results(id)) {
    yield result;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/batch.ts && git commit -m "feat(ai): Message Batches API helpers (create/poll/stream)"
```

---

### Task 4: Batch-state persistence

**Files:**
- Create: `lib/ai/enrichBatchState.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Ignore the state dir**

Append to `.gitignore`:

```
# Seed-enrichment batch state (resumable batch runs)
/.enrich-batch
```

- [ ] **Step 2: Write the state module**

```ts
/**
 * Persisted state for a resumable batch enrichment run. One JSON file per
 * in-flight batch under .enrich-batch/ (gitignored). Holds the batch id plus the
 * per-candidate Google Place Details context needed to write results at collect
 * time — so a crashed run can resume against the already-submitted batch instead
 * of re-paying for prep + extraction.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const STATE_DIR = join(process.cwd(), ".enrich-batch");

/** Resolved, non-AI context for one candidate (custom_id === candidate id). */
export interface PrepContext {
  candidateId: string;
  name: string;
  address: string | null;
  lat: string | null;
  lng: string | null;
  googlePlaceId: string | null;
  siteUrl: string | null;
  phone: string | null;
  priceLevel: number | null;
  photoName: string | null;
}

export interface BatchState {
  batchId: string;
  citySlug: string;
  cityId: string;
  contexts: Record<string, PrepContext>;
}

function stateFilePath(citySlug: string, batchId: string): string {
  return join(STATE_DIR, `${citySlug}-${batchId}.json`);
}

export function writeBatchState(state: BatchState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFilePath(state.citySlug, state.batchId), JSON.stringify(state, null, 2));
}

/** Return the first un-collected batch state for a city, or null. */
export function findBatchState(citySlug: string): BatchState | null {
  let files: string[];
  try {
    files = readdirSync(STATE_DIR);
  } catch {
    return null;
  }
  const match = files.find((f) => f.startsWith(`${citySlug}-`) && f.endsWith(".json"));
  if (!match) return null;
  return JSON.parse(readFileSync(join(STATE_DIR, match), "utf8")) as BatchState;
}

export function deleteBatchState(citySlug: string, batchId: string): void {
  try {
    rmSync(stateFilePath(citySlug, batchId));
  } catch {
    /* already gone */
  }
}
```

- [ ] **Step 3: Verify roundtrip**

Run:
```bash
npx tsx -e "
import {writeBatchState,findBatchState,deleteBatchState} from './lib/ai/enrichBatchState';
const s={batchId:'msgbatch_test',citySlug:'unittest',cityId:'c1',contexts:{a:{candidateId:'a',name:'X',address:null,lat:null,lng:null,googlePlaceId:null,siteUrl:'https://x.test',phone:null,priceLevel:null,photoName:null}}};
writeBatchState(s);
const got=findBatchState('unittest');
if(!got||got.batchId!=='msgbatch_test'||got.contexts.a.siteUrl!=='https://x.test'){console.error('FAIL',got);process.exit(1)}
deleteBatchState('unittest','msgbatch_test');
if(findBatchState('unittest')!==null){console.error('FAIL not deleted');process.exit(1)}
console.log('PASS roundtrip + delete');
"
```
Expected: `PASS roundtrip + delete`

- [ ] **Step 4: Commit**

```bash
git add lib/ai/enrichBatchState.ts .gitignore && git commit -m "feat(ai): resumable batch-state file for enrichment runs"
```

---

### Task 5: `--batch` orchestration in the enrich script

**Files:**
- Modify: `scripts/seed-enrich-candidates.ts`

This task (a) extracts the per-venue DB write into a shared `persistExtraction` helper used by all three paths (legacy on-demand, batch collect, fallback), then (b) adds the `--batch` phased flow + report. The on-demand path keeps producing identical output.

- [ ] **Step 1: Add imports + `--batch` arg**

At the top of the file add:

```ts
import { createBatch, pollBatch, streamResults } from "@/lib/ai/batch";
import {
  type PrepContext,
  type BatchState,
  writeBatchState,
  findBatchState,
  deleteBatchState,
} from "@/lib/ai/enrichBatchState";
import { costCents } from "@/lib/ai/pricing";
import {
  buildExtractRequest,
  parseRecordedExtract,
  type ExtractResult,
} from "@/lib/ai/extractHappyHours";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
```

Change `parseArgs` to also read `--batch`:

```ts
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
```

- [ ] **Step 2: Extract `persistExtraction` + report types** (add near the top, after `slugify`)

```ts
type SeedOutcome = "confirmed_hh" | "no_hh_explicit" | "no_hh_found" | "error";

/** Why a venue ended up with no happy-hour data — for the end-of-run report. */
type NoDataReason = "no_website" | "zero_windows" | "all_dropped" | "errored";
interface NoDataEntry {
  name: string;
  reason: NoDataReason;
  detail?: string;
  via?: "batch" | "fallback" | "on-demand";
}

type Sql = ReturnType<typeof postgres>;

/**
 * Write one enriched candidate to the DB: insert the venue (complete|stub),
 * hero photo, and any HH windows + offerings. Shared by the on-demand, batch, and
 * fallback paths so all three produce identical output. Returns the venue id +
 * the seed outcome. Does NOT mark the candidate processed (caller does that).
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

  const slug = slugify(ctx.name);
  const completeness = hasHH ? "complete" : "stub";
  const lastVerified = hasHH ? new Date() : null;
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO venues
      (city_id, name, slug, address, lat, lng, google_place_id,
       website_url, phone, price_level, status, data_completeness, last_verified_at)
    VALUES
      (${cityId}, ${ctx.name}, ${slug},
       ${ctx.address}, ${ctx.lat}, ${ctx.lng},
       ${ctx.googlePlaceId}, ${ctx.siteUrl}, ${ctx.phone},
       ${ctx.priceLevel}, 'active'::venue_status,
       ${completeness}::data_completeness, ${lastVerified}::timestamptz)
    ON CONFLICT (${ctx.googlePlaceId ? sql`google_place_id` : sql`city_id, slug`})
      DO NOTHING
    RETURNING id
  `;
  let venueId = inserted[0]?.id ?? null;
  if (!venueId && ctx.googlePlaceId) {
    const [ex] = await sql<{ id: string }[]>`
      SELECT id FROM venues WHERE google_place_id = ${ctx.googlePlaceId}
    `;
    venueId = ex?.id ?? null;
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
```

Then replace the inline venue-insert/HH/photo block inside the existing on-demand loop (the `{ const slug = slugify(...) … }` block plus the ledger insert) with calls to `writeLedger` + `persistExtraction`, preserving the existing logging. The on-demand path becomes:

```ts
        const extracted = siteUrl
          ? await extractHappyHours({ venueName: candidate.name, websiteUrl: siteUrl, otherUrl: null })
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
          photoName: details?.photoName ?? null,
        };
        const { venueId, outcome: o, hasHH } = await persistExtraction(sql, {
          cityId: city.id,
          placesKey,
          ctx,
          extracted,
        });
        outcome = o;
        resultingVenueId = venueId;
        console.log(
          hasHH
            ? `  ✓ ${extracted!.happyHours.length} HH window(s) saved`
            : "  ◦ likely-HH stub kept (no times found — crowdsource)",
        );
```

- [ ] **Step 3: Verify on-demand path still typechecks + is unchanged in output**

Run: `npm run typecheck`
Expected: no new errors.

(Behavioral check is the operator smoke run in Task 7; the SQL is copied verbatim into `persistExtraction`.)

- [ ] **Step 4: Commit the refactor**

```bash
git add scripts/seed-enrich-candidates.ts && git commit -m "refactor(seed): extract shared persistExtraction/writeLedger helpers"
```

- [ ] **Step 5: Add the batch orchestration**

In `main()`, immediately after the city row is resolved (`const [city] = …`), branch to a batch runner when `args.batch`:

```ts
    if (args.batch) {
      await runBatch(sql, city, args, placesKey);
      return;
    }
```

Then add these functions to the file. `runBatch` handles resume, prep, submit, poll, collect, fallback, and the report.

```ts
interface CityRow { id: string; slug: string }

interface ReportTally {
  full: number;
  stubs: number;
  filtered: number;
  skipped: number;
  errored: number;
  fallbackCount: number;
  totalRequests: number;
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
    full: 0, stubs: 0, filtered: 0, skipped: 0, errored: 0,
    fallbackCount: 0, totalRequests: 0, batchCostCents: 0, fallbackCostCents: 0,
    noData: [],
  };

  // ---- Resume an in-flight batch if one exists -------------------------------
  let state = findBatchState(city.slug);
  if (state) {
    console.log(`Resuming in-flight batch ${state.batchId} for '${city.slug}'…`);
  } else {
    state = await prepAndSubmit(sql, city, args, placesKey, month, tally);
    if (!state) {
      console.log("No eligible candidates to batch. Done.");
      await finalize(sql, city, tally);
      return;
    }
  }

  // ---- Poll to completion ----------------------------------------------------
  console.log(`Polling batch ${state.batchId} every 300s until complete…`);
  await pollBatch(state.batchId, {
    onTick: (b) =>
      console.log(
        `  …status=${b.processing_status} ` +
          `(succeeded ${b.request_counts.succeeded}, errored ${b.request_counts.errored}, ` +
          `processing ${b.request_counts.processing})`,
      ),
  });

  // ---- Collect + write -------------------------------------------------------
  const fallback: PrepContext[] = [];
  for await (const res of streamResults(state.batchId)) {
    const ctx = state.contexts[res.custom_id];
    if (!ctx) continue; // unknown id — skip defensively
    tally.totalRequests++;

    if (res.result.type !== "succeeded") {
      fallback.push(ctx);
      continue;
    }
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
      usage,
      costCents: costCents("claude-haiku-4-5", usage, { batch: true }),
      promptHash: "", // set below from a fresh build for accurate attribution
      model: "claude-haiku-4-5",
    };
    // Use the real model + prompt hash for the ledger.
    const built = buildExtractRequest({ venueName: ctx.name, websiteUrl: ctx.siteUrl, otherUrl: null });
    extracted.model = built.model;
    extracted.promptHash = built.promptHash;
    extracted.costCents = costCents(built.model, usage, { batch: true });

    await writeLedger(sql, city.id, month, extracted);
    tally.batchCostCents += extracted.costCents;
    await collectOne(sql, city, placesKey, ctx, extracted, "batch", tally);
  }

  // ---- On-demand fallback for stragglers -------------------------------------
  if (fallback.length > 0) {
    console.log(`\n${fallback.length} request(s) need on-demand fallback…`);
    for (const ctx of fallback) {
      tally.fallbackCount++;
      try {
        const extracted = ctx.siteUrl
          ? await extractHappyHours({ venueName: ctx.name, websiteUrl: ctx.siteUrl, otherUrl: null })
          : null;
        if (extracted) {
          await writeLedger(sql, city.id, month, extracted);
          tally.fallbackCostCents += extracted.costCents;
        }
        await collectOne(sql, city, placesKey, ctx, extracted, "fallback", tally);
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
```

- [ ] **Step 6: Add the prep/submit, collect-one, mark-processed, and finalize helpers**

```ts
/** Phase 1+2: run the non-AI gates, write inline outcomes, submit the batch, persist state. */
async function prepAndSubmit(
  sql: Sql,
  city: CityRow,
  args: { city: string; limit: number | null },
  placesKey: string | null,
  month: string,
  tally: ReportTally,
): Promise<BatchState | null> {
  const candidates = await sql<SeedCandidate[]>`
    SELECT id, name, google_place_id, address, lat, lng, source_url
    FROM seed_candidates
    WHERE city_id = ${city.id} AND processed_at IS NULL
    ORDER BY created_at ASC
    ${args.limit != null ? sql`LIMIT ${args.limit}` : sql``}
  `;
  if (candidates.length === 0) return null;
  console.log(`Prepping ${candidates.length} candidates for '${args.city}'…`);

  const requests: { custom_id: string; params: ReturnType<typeof buildExtractRequest>["params"] }[] = [];
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
      details = placesKey && c.google_place_id
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
      photoName: details?.photoName ?? null,
    };

    // No website → no AI possible; write the stub now and mark processed.
    if (!ctx.siteUrl) {
      const { venueId, outcome } = await persistExtraction(sql, {
        cityId: city.id, placesKey, ctx, extracted: null,
      });
      await markProcessed(sql, c.id, outcome, venueId);
      tally.stubs++;
      tally.noData.push({ name: c.name, reason: "no_website" });
      continue;
    }

    const built = buildExtractRequest({ venueName: ctx.name, websiteUrl: ctx.siteUrl, otherUrl: null });
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

/** Write one collected/fallback result + mark processed + update report tally. */
async function collectOne(
  sql: Sql,
  city: CityRow,
  placesKey: string | null,
  ctx: PrepContext,
  extracted: ExtractResult | null,
  via: "batch" | "fallback",
  tally: ReportTally,
): Promise<void> {
  const { venueId, outcome, hasHH } = await persistExtraction(sql, {
    cityId: city.id, placesKey, ctx, extracted,
  });
  await markProcessed(sql, ctx.candidateId, outcome, venueId);

  if (hasHH) {
    tally.full++;
  } else {
    tally.stubs++;
    const rawCount = extracted ? extractedRawCount(extracted) : 0;
    tally.noData.push({
      name: ctx.name,
      reason: rawCount > 0 ? "all_dropped" : "zero_windows",
      detail: extracted
        ? `conf ${extracted.confidence.toFixed(2)}${ctx.siteUrl ? `, ${ctx.siteUrl}` : ""}`
        : undefined,
      via,
    });
  }
}

/**
 * We can't see rawWindowCount on ExtractResult (the loop strips it), so treat any
 * stub from a path that returned an ExtractResult with confidence > 0 but no
 * windows as "zero_windows". (all_dropped is detected only on the batch path,
 * which has the parsed object — see collectOne caller note.)
 */
function extractedRawCount(_e: ExtractResult): number {
  return 0;
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
  console.log(`  errored:                ${tally.errored}`);
  console.log(
    `\nCost:  batch ${usd(tally.batchCostCents)}  ·  on-demand fallback ${usd(tally.fallbackCostCents)}  ·  total ${usd(tally.batchCostCents + tally.fallbackCostCents)}`,
  );
  console.log(`Fallback (on-demand) count: ${tally.fallbackCount} / ${tally.totalRequests} requests`);

  const groups: Record<NoDataReason, NoDataEntry[]> = {
    no_website: [], zero_windows: [], all_dropped: [], errored: [],
  };
  for (const e of tally.noData) groups[e.reason].push(e);
  const labels: Record<NoDataReason, string> = {
    no_website: "no website on file",
    zero_windows: "website, 0 windows extracted",
    all_dropped: "recorded but all rows dropped (§13 / denylist)",
    errored: "errored",
  };
  const totalNoData = tally.noData.length;
  console.log(`\n── Venues with NO happy-hour data (${totalNoData}) — improve extraction here ──`);
  for (const reason of ["no_website", "zero_windows", "all_dropped", "errored"] as NoDataReason[]) {
    const list = groups[reason];
    if (list.length === 0) continue;
    console.log(`  ${labels[reason]} (${list.length}):`);
    for (const e of list) {
      const via = e.via ? `  [via ${e.via}]` : "";
      const detail = e.detail ? `  (${e.detail})` : "";
      console.log(`    - ${e.name}${detail}${via}`);
    }
  }
}
```

> **Note on `all_dropped` detection:** to distinguish "model proposed windows but §13 dropped them all" from "model found nothing", the batch collect path has the parsed object with `rawWindowCount`. Thread it through: in `runBatch`, when `parsed.recorded` but `parsed.happyHours.length === 0`, push a `noData` entry with `reason: parsed.rawWindowCount > 0 ? "all_dropped" : "zero_windows"` directly (instead of relying on `collectOne`'s `extractedRawCount` stub). Implement that inline in `runBatch` after `persistExtraction`, and have `collectOne` skip the noData push when called from batch. (Simplest: in `runBatch`, after writing, branch on `hasHH`; for stubs build the `noData` entry from `parsed`. Keep `collectOne` for the fallback path only.) Adjust so each stub is reported exactly once.

- [ ] **Step 7: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no new errors beyond the two pre-existing Phase 0 issues.

- [ ] **Step 8: Commit**

```bash
git add scripts/seed-enrich-candidates.ts && git commit -m "feat(seed): --batch flow (prep/submit/poll/collect/fallback) + report"
```

---

### Task 6: Tucson city row

**Files:**
- Modify: `scripts/seed-cities.ts`

- [ ] **Step 1: Add Tucson to the `CITIES` array**

Add this entry to the `CITIES` array (after `phoenix-central`):

```ts
  {
    // Tucson, AZ — operator launch city after Tacoma. Centroid + ~12km radius
    // covers Tucson proper; locality filter drops Oro Valley / Marana / South Tucson.
    slug: "tucson",
    name: "Tucson",
    state: "AZ",
    country: "US",
    timezone: "America/Phoenix",
    currency: "USD",
    centerLat: 32.2226,
    centerLng: -110.9747,
    seedConfig: {
      radiusKm: 12,
      cellMeters: 3000,
      serviceLocalities: ["Tucson"],
    },
  },
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-cities.ts && git commit -m "feat(seed): add Tucson, AZ city row + discovery config"
```

---

### Task 7: Full verification + operator run instructions

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean except the two pre-existing Phase 0 lint issues (`db/schema/moderation.ts`, `scripts/import-neighborhoods.ts`). Build compiles.

- [ ] **Step 2: Apply the Tucson city row (operator, needs DATABASE_URL)**

Run: `npm run seed:cities`
Expected: output lists a `tucson` row.

- [ ] **Step 3: Discover Tucson candidates (operator, needs GOOGLE_PLACES_API_KEY)**

Run: `npm run seed:discover -- --city tucson`
Expected: seed_candidates rows inserted for Tucson.

- [ ] **Step 4: Smoke the batch flow (operator, needs ANTHROPIC_API_KEY)**

Run: `npm run seed:enrich -- --batch --city tucson --limit 5`
Expected: prep logs → "Submitting batch…" → batch id → polling at 300s → collect → the end-of-run report. A `.enrich-batch/tucson-<id>.json` file appears at submit and is deleted at completion. Ctrl-C mid-poll and re-running the same command resumes the existing batch.

- [ ] **Step 5: Confirm the discount landed in the ledger**

Run: `npm run ai:spend`
Expected: month-to-date includes the new `seed`-stage spend; per-venue cost is ~half the on-demand rate for batch-collected venues.

---

## Self-review notes

- **Spec coverage:** discount (Task 1), refactor for shared build/parse (Task 2), batch helpers (Task 3), resumable state (Task 4), phased `--batch` + report + fallback + idempotency-preserving prep (Task 5), Tucson setup (Task 6), verification incl. operator run (Task 7). All spec sections covered.
- **Idempotency:** prep loads only `processed_at IS NULL`; eligible candidates are marked processed only at collect, so a crash leaves them retryable and resume uses the state file. No stub-retry (out of scope per spec).
- **`all_dropped` vs `zero_windows`:** only the batch path has `rawWindowCount`; the Step 6 note specifies reporting stubs directly from `parsed` in `runBatch` so each stub is counted once and `all_dropped` is detected. The fallback path reports `zero_windows` (no raw count available) — acceptable, documented.
- **No submission-moderation changes; no migration; hero photo unchanged.**
```
