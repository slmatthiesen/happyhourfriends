# Rank stub candidates — local HH-likelihood shortlist

**Date:** 2026-06-01
**Branch:** cluster-schema-seed-pipeline
**Status:** approved (approach B)

## Problem

~290 venues are stubs (no active `happy_hours`). Many genuinely have a happy hour
that is findable by a human, but the free plain-`fetch` harvest only recovered ~18
of them (only 24/292 surfaced HH text to plain HTML). The operator can reliably
hand-find a real HH when pointed at the right venue + URL. We need to **rank the
stubs by probability of having a findable HH**, local-only (no Anthropic/Google
API, no network), so the operator works the highest-yield candidates first.

## Non-goals

- No JS rendering / headless crawl (explicitly ruled out this round).
- No network calls, no API spend.
- No DB writes. This is a report generator only.
- No new priors — reuse `lib/places/hhLikelihood.ts` as-is.

## Inputs (all local)

1. **DB** — stub venues (`data_completeness = 'stub'`, or no active `happy_hours`),
   joined to `seed_candidates` via `resulting_venue_id` (fallback `google_place_id`)
   to recover Google `primary_type`, `types[]`, `rating`, `user_rating_count`,
   `business_status`. Plus `venues.{name,type,website_url,price_level}`.
2. **`docs/hh-harvest.jsonl`** — per-venue plain-fetch result from the last harvest
   (`{venueId, name, city, website, signal, sources[]}`). Joined by `venueId`,
   fallback name+city.

## Scoring

Per stub venue:

- **base = `hhLikelihood({ venueType: venues.type, primaryType, types, name })`**
  (null when no signal → treat as 0 for sorting but flag "no type signal").
- **+ harvest boost** — if the harvest `signal === true` and the venue is still a
  stub, add a large boost (e.g. `+0.40`, capped at 1.0). This is the strongest
  evidence: we already saw HH text on the site, it just wasn't cleanly applicable
  (no days / all-day-ambiguous / JS-skipped leftover). Carry the matched snippet
  into the "why".
- **+ popularity tiebreak** — small bump from `rating` × log(`user_rating_count`),
  scaled to at most ~`+0.05`, used only to order venues with equal prior.
- **business status** — `CLOSED_PERMANENTLY` → drop from ranked list (list under a
  "closed, skipped" footer). `OPERATIONAL`/null → keep.
- **reachability flag** — no `website_url` → keep but tag `[no site — search by
  name]`; does not zero the score (operator can still find by name).

Final score = `min(1, base + harvestBoost) ` then popularity as a secondary sort key.

## Output

`docs/stub-candidates-ranked-2026-06-01.md`, grouped by city, sorted by score desc:

| # | venue | type | score | why | where to check |

- **why**: e.g. `sports_bar prior 0.62`; `+harvest: "HH 3–6pm" (no days)`.
- **where to check**: harvest source URL if present → else `<website>/happy-hour`
  guess → else `search "<name> <city> happy hour"`.
- A `--- low-yield below (type prior < 0.35) ---` divider so the operator focuses
  on the top of each city.
- Footer: counts (total stubs, ranked, no-site, closed-skipped) per city.

Also emit `docs/stub-candidates-ranked-2026-06-01.json` (same rows) for any
follow-up tooling.

## CLI

`npm run rank:stubs` → `tsx scripts/rank-stub-candidates.ts`
- `--city <slug>` (default: all cities)
- `--limit N` (cap rows per city in the markdown; JSON keeps all)
- `--min-score X` (optional floor; default none — divider handles focus)
- Report-only; no `--apply` (nothing to apply).

Env: `DATABASE_URL` only. Reads `docs/hh-harvest.jsonl` if present (warns + proceeds
on type-prior-only if missing).

## Reuse / structure

- `lib/places/hhLikelihood.ts` — priors (unchanged).
- New pure helper `lib/places/stubRank.ts` — `scoreStub(input) -> { score, reasons[] }`
  so the math is unit-testable without DB/fs. The script does I/O (DB query, jsonl
  read, markdown render) and calls the pure scorer.
- `scripts/test-stub-rank.ts` (npm `test:stub-rank`) — table-driven checks of the
  scorer: type prior passthrough, harvest boost cap, closed drop, no-site flag,
  popularity ordering.

## Verification

- `npm run test:stub-rank` passes.
- `tsc --noEmit` + `eslint` clean.
- Spot-check the top ~10 of one city against the harvest snippets: every harvest-
  boosted row must cite a real snippet (no fabricated "why").
