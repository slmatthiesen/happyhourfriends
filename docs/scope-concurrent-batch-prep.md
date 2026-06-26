# Scope: concurrent batch-prep for `seed:enrich --batch`

**Status:** scoped, not implemented (2026-06-25). Surfaced during Sacramento onboarding —
626-candidate prep ran sequentially at ~30–45s/candidate ≈ 4–6h before batch submit.

## Root cause

`prepAndSubmit` in `scripts/seed-enrich-candidates.ts` (~L1024–1210) is a sequential
`for` loop. Per candidate it does two network-bound awaits that dominate wall-clock:

- `triageSite` (~L1079) — fetches the site to detect dead/parked/no-site.
- `buildExtractRequest` (~L1137) — fetches all pages + PDFs + images via `lib/ai/siteContent`.

The free-first gates (`freeExtractFromPages`, `hasSignal`) are cheap; the cost is the fetches.

The **on-demand** path already solved this: `mapWithConcurrency(candidates, enrichConcurrency,
processCandidate, {minSpacingMs})` at ~L712, default concurrency 6 via `SEED_ENRICH_CONCURRENCY`,
start-throttled by `SEED_ENRICH_SPACING_MS` (default 100ms).

## Fix

Refactor the prep loop body into a per-candidate async worker; run it through the existing
`mapWithConcurrency` (`lib/async/mapWithConcurrency.ts`, already imported). Reuse the same
`enrichConcurrency` knob + `minSpacingMs`.

### The real work is concurrency-safety, not pool wiring

1. **Move shared-state mutation to a post-pool fold.** Today the loop mutates `tally.*`,
   `requests.push(...)`, `contexts[id]=...` inline — these race under a pool. Each worker should
   instead *return* a discriminated result:
   `{kind:'request', customId, params, ctx}` | `{kind:'filtered'|'skipped'|'killed'|'stub'|'full'|'hidden', …}`.
   After `Promise.all`, fold into `tally`/`requests`/`contexts` in index order — identical to the
   on-demand fold at ~L723. Deterministic, no races, stable batch ordering.
2. **DB writes stay inside the worker** (`persistExtraction`, `markProcessed`, existence SELECT,
   `UPDATE seed_candidates`). The on-demand path already runs these exact functions concurrently
   on the same `sql` pool; `persistExtraction` carries its TOCTOU/idempotency guard (~L211–214).
   No new locking. DB pool is sized `enrichConcurrency + 2` — fine for the default.
3. **Nested concurrency multiplies egress.** `siteContent` fetches pages with its own
   `FETCH_CONCURRENCY`, so total in-flight fetches = `enrichConcurrency × FETCH_CONCURRENCY`.
   Keep default 6; `minSpacingMs` staggers starts. Comment it so it isn't a surprise; the knob
   dials down if a run trips a host/API limit.
4. **Fail-fast preserved.** `mapWithConcurrency` rejects on the first worker throw, leaving the
   rest `processed_at IS NULL` for resume — matches the current `throw`-aborts-everything behavior.

### Out of scope

The Anthropic batch *poll* wait (server-side async, not our CPU). Only prep is parallelized.

## Effort / win / risk

- **Effort:** one function refactored (~80-line loop → worker + fold), reuse existing primitive;
  extend the hermetic enrich test to cover concurrent prep ordering + tally determinism.
- **Win:** ~6h → ~20–40 min prep on a large city (free-first short-circuits make most workers cheap).
- **Risk:** medium — load-bearing persist path under concurrency, but the on-demand path already
  exercises this exact concurrency on the same persist functions. The change is "move the right
  mutations to the fold," not new territory.
