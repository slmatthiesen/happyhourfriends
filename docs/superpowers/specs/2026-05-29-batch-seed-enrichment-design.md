# Batch-API seed enrichment — design

**Date:** 2026-05-29
**Branch:** `cluster-schema-seed-pipeline`
**Status:** approved (brainstorm), pending implementation plan

## Goal

Run the seed happy-hour enrichment AI calls through the Anthropic **Message
Batches API** instead of on-demand `messages.create`, for ~50% cost reduction.
The enrichment is a background job ("we don't need them immediately, it can run
slowly"), so the up-to-24h batch turnaround is acceptable. Triggered by a
`--batch` flag on the existing `seed:enrich` script. Submission moderation
(classify / verify / interpret) is **out of scope** — those run while a user
waits on their submission and must stay on-demand.

## Background / constraint

The current extractor (`lib/ai/extractHappyHours.ts`) is a **multi-turn agentic
loop**: it calls server-side `web_search` + `web_fetch`, resumes on `pause_turn`,
and nudges the model if it ends a turn without calling `record_happy_hours`. The
Batch API runs each request as a **single invocation** — there is no client-side
loop to resume or nudge. So this is not a drop-in swap; it forces a decision
about how extraction maps onto one request.

**Chosen approach (A): single-shot batch, keep the server-side web tools.**
Each candidate becomes one batch request still carrying `web_search` +
`web_fetch` + the `record_happy_hours` custom tool. The server runs the web
fetches internally; when the model calls `record_happy_hours` (a *custom* tool),
the request ends with `stop_reason=tool_use` and that tool's input **is** our
data — exactly today's happy path (`extractHappyHours.ts:382`). We never execute
or return the tool result.

What we give up vs. the loop: the last-turn forced `tool_choice`, the `pause_turn`
resume, and the "you forgot to record" nudge. Because `max_uses` is only 2+4=6
(under the server's internal tool-loop limit), most requests land a clean record
in one shot. Any that don't (returned prose, `pause_turn`, errored, expired) are
routed to an **on-demand fallback** that re-runs the existing agentic loop for
that small set (full price). The run logs the fallback count so a large fallback
rate is visible.

Rejected alternatives:
- **B — pre-fetch ourselves + force record.** Deterministic, but loses Claude's
  JS rendering + native PDF reading; menus are usually PDFs (per CLAUDE.md), so
  recall drops, plus more engineering.
- **C — parallelize the loop, no Batch API.** No 50% discount (the stated goal)
  and not really batch processing.

## Operating model

**One command, polls to done, resumable.** `seed:enrich --batch` does the Google
prep, submits the batch, polls until complete, then writes everything. Blocks the
terminal (minutes to hours). A state file lets a re-run after Ctrl-C / crash
resume the existing batch instead of re-paying.

**Poll interval: 300s.** (Even 10 venues locally take >60s; no value in tighter
polling for a job that can take hours.)

## Detailed design

### 1. Refactor `lib/ai/extractHappyHours.ts` into reusable pieces

Pull request-building and result-parsing out of the loop so the loop and the
batch path share them:

- `buildExtractRequest(input): MessageCreateParams` — the single `messages.create`
  params (model, `max_tokens: 8192`, system, `TOOLS`, messages). `tool_choice`
  stays `auto` — we cannot force `record_happy_hours` while web tools are present.
  Reuses `fillPlaceholders`, `TOOLS`, `RECORD_TOOL`, prompt loading.
- `parseExtractResult(message): ExtractResult & { recorded: boolean }` — finds the
  `record_happy_hours` tool_use block, runs the existing `normaliseHappyHour` /
  `normaliseOffering` / §13 logic, clamps confidence, sums usage, computes cost.
  `recorded` is false when no record tool_use is present (prose-only / pause_turn).
- `extractHappyHours()` keeps its current public signature and behavior (the
  agentic loop), re-implemented on top of those two helpers. It is the **on-demand
  fallback** and remains unchanged from the caller's perspective.

### 2. New `lib/ai/batch.ts`

Thin wrappers over `anthropic().messages.batches`:
- `createBatch(requests: { custom_id, params }[]): Promise<string>` — returns batch id.
- `pollBatch(id, { intervalMs = 300_000 }): Promise<Batch>` — resolves when
  `processing_status === "ended"`; logs progress counts each poll.
- `streamResults(id): AsyncIterable<{ custom_id, result }>` — wraps
  `batches.results(id)`.

### 3. Pricing — batch discount

Extend `costCents(model, usage, opts?: { batch?: boolean })` in `lib/ai/pricing.ts`
to apply a 0.5× multiplier when `batch` is true (Batch API is half price).
Batch-collected ledger rows pass `batch: true`; fallback (on-demand) rows do not.
`ai:spend` is unaffected (still sums `cost_cents`).

### 4. `scripts/seed-enrich-candidates.ts` — add `--batch`, phased

When `--batch` is **not** passed, behavior is exactly as today (no regression).

When `--batch` is passed:

**Phase 1 — prep (synchronous, per candidate, no AI).** Run today's gates in
order: chain denylist, buffet/AYCE format, already-a-venue (place_id), then Place
Details (alcohol gate, `websiteUri`, `phone`, `priceLevel`, `photoName`).
- Filtered / skipped candidates → marked processed now (as today), no AI.
- Eligible candidate **with no website** → no AI is needed, so write the stub
  venue + mark processed inline now (today's `siteUrl == null` path).
- Eligible candidate **with a website** → build one batch request,
  `custom_id = candidate.id`, and stash its resolved context
  (`siteUrl, phone, priceLevel, photoName, name, address, lat, lng, place_id`)
  for the collect phase.

  These candidates are **not** marked processed until collect, so a crash leaves
  them for retry.

**Phase 2 — submit + persist state.** `createBatch(requests)`; immediately write
`.enrich-batch/<city>-<batchId>.json` (gitignored) holding `{ batchId, citySlug,
contexts: { [custom_id]: context } }`. Print the batch id.

**Phase 3 — poll.** `pollBatch(id, { intervalMs: 300_000 })` until ended.

**Phase 4 — collect + write.** For each result:
- `succeeded` + `recorded` → write ledger row (`batch: true`), insert venue
  (`complete` if ≥1 window else `stub`), insert HH + offerings, hero photo — via
  today's exact write logic. Mark candidate processed with `outcome` +
  `resulting_venue_id`.
- `succeeded` but **not** `recorded`, or `errored` / `expired` → add to the
  fallback set (do not mark processed yet).

**Phase 5 — on-demand fallback.** For each fallback candidate, run the existing
`extractHappyHours()` loop (full price), then write results the same way and mark
processed. Track the count.

**Phase 6 — finalize.** Neighborhood assignment (`assignNeighborhoods`), then the
report (below). Delete the state file once all results are collected and written.

### 5. Resumability

On `--batch` start, if `.enrich-batch/<city>-*.json` with an un-collected batch
exists for the city, skip phases 1–2 and jump to poll + collect using the stashed
contexts. Delete the state file when fully collected. Re-running after a crash
resumes the existing batch rather than re-paying. (Idempotency backstop: eligible
candidates aren't marked processed until collect, and already-processed candidates
are skipped by the `processed_at IS NULL` query, so a stale/orphan state never
double-writes a venue.)

### 6. End-of-run report

```
── Enrichment complete (batch) ───────────────────────────
Venues collected:        47        (new venue rows written this run)
  ├─ full data:          18        (≥1 happy-hour window, dataCompleteness=complete)
  └─ stubs (no data):    29        (kept as "help wanted", dataCompleteness=stub)

Not processed via batch:
  filtered:               9        (chain / buffet-AYCE / no alcohol)
  skipped (existing):     3        (already a venue)
  errored:                1

Cost:  batch $X.XX  ·  on-demand fallback $Y.YY  ·  total $Z.ZZ
Fallback (on-demand) count: 4 / 51 requests

── Venues with NO happy-hour data (29) — improve extraction here ──
  no website on file        (11):
    - Parkway Tavern
    - The Red Hot
    - …
  website, 0 windows extracted (15):
    - Cloverleaf  (conf 0.00, https://…)   [via batch]
    - …  [via fallback]
  recorded but all rows dropped (§13 / denylist) (2):
    - …  (source host)
  errored (1):
    - …  (error message)
```

Every venue that didn't get data is named and grouped by *why* — no website,
extractor returned nothing, all rows failed the §13/source guards, or errored —
with confidence and source URL where relevant, and whether it came from the batch
or the fallback path. This is the actionable list for improving the extractor
(directly surfaces the all-day-specials / no-published-times patterns noted in
CLAUDE.md).

## Behavior on an existing city (idempotency)

A re-run is **incremental, not a redo**. The `processed_at IS NULL` query means
already-processed candidates (both confirmed venues and stubs) are skipped, never
re-sent, never re-paid. For Tacoma (0 unprocessed candidates) a re-run is a no-op.
This is the desired behavior for fresh cities (Tucson next): run once, re-running
is safe and free.

Consequence: a re-run does **not** automatically retry the missing-data stubs.
Re-attempting extraction on stubs (e.g. after improving the extractor using the
report) is a **separate, deliberate function to be built later** — explicitly out
of scope here.

## Non-goals

- No changes to submission moderation (classify / verify / interpret).
- No DB migration — batch state lives in the gitignored `.enrich-batch/` file,
  which suits the single-command operating model.
- No stub-retry / re-arm capability (separate future function).
- Hero-photo fetch stays as-is (still broken per CLAUDE.md — Place Details returns
  no `photoName`; out of scope).

## Risks / tradeoffs

- **Can't force the record tool** while web tools are present → some fraction of
  requests return without a clean record and route to the full-price on-demand
  fallback. Expected small given `max_uses` 6; the report's fallback count makes a
  large rate visible so we can revisit.
- **Batch latency** up to 24h; accepted. The command blocks but is resumable.
- **`pause_turn`** results are treated as not-recorded → fallback.
- **Orphan batch** if the process dies between `createBatch` and the state-file
  write. Mitigated by writing the state file immediately after submit; worst case
  is one wasted batch, never a double-write (candidates aren't marked processed
  until collect).

## Acceptance

- `npm run seed:enrich -- --batch --city <slug> [--limit N]` submits a batch,
  polls at 300s, collects, and writes venues/HH/offerings identical in shape to
  the on-demand path.
- Ledger rows from batch results reflect the 0.5× discount.
- The end-of-run report prints the counts and the named no-data list as specified.
- A re-run with no unprocessed candidates is a no-op.
- Without `--batch`, the script behaves exactly as today.
- `tsc --noEmit` and `eslint` clean (modulo the two pre-existing Phase 0 issues).
```
