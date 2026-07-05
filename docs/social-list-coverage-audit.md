# Social-list → coverage-audit runbook

The template for diffing a **locals' list** (Reddit / FB "best happy hour" thread) against
the DB, triaging every miss into a fix category, and applying the right lever — without
burning paid budget on a blunt instrument. This is the engine the operator runs whenever
they surface a coverage gap from social media; **it is NOT "run recall on the city."**

The deliverable is a **per-venue triage table**, not a batch job. Spokane (2026-07-04) is
the calibration example throughout — 3 Reddit threads, ~36 recs.

> Background-subagents CANNOT use `tmp-reddit-fetch.ts` (headless Chrome) or write outside
> the allowlist — fetch social lists on the **main thread**. DB queries via
> `tsx scripts/db-query.ts "..."` (no `cd` — it breaks the allowlist).

## Why this exists

Two distinct coverage-miss patterns live in memory, and they need different fixes:

- **Out-of-boundary** — misses cluster *outside* the discovery polygon (city-limits vs
  metro). Fix = expand the boundary. See memory `project_coverage-misses-boundary-scope`.
- **Stale recall / extraction** — misses are *in-boundary* downtown institutions. Fix =
  re-run adaptive recall v2 **to completion**, then heal stubs. See memory
  `project_recall-v2-gap-cohort`.

This runbook is the decision procedure that picks between them, venue by venue.

## Step 0 — Fetch the social list

Reddit bot-walls `curl` and Jina. Use the headless-Chrome fetcher (main thread):

```bash
tsx scripts/tmp-reddit-fetch.ts "<reddit-thread-url>" > /tmp/<city>-reddit-N.json
# extract top-level recs (recommendations live in depth 0–1 comments):
jq -r '.title, (.comments[] | select(.depth=="0" or .depth=="1") | "• " + .body)' /tmp/<city>-reddit-N.json
```

Build the **unique venue-name list** from the bodies. (~36 for Spokane across 3 threads.)

## Step 1 — Baseline + per-venue diff

Baseline counts (note: `seen_via_hh_recall` is **boolean**, not int):

```bash
tsx scripts/db-query.ts "SELECT c.slug,
  (SELECT count(*) FROM seed_candidates sc WHERE sc.city_id=c.id) AS candidates,
  (SELECT count(*) FROM seed_candidates sc WHERE sc.city_id=c.id AND sc.seen_via_hh_recall IS TRUE) AS via_recall,
  (SELECT count(*) FROM venues v WHERE v.city_id=c.id) AS venues,
  (SELECT count(*) FROM venues v WHERE v.city_id=c.id AND v.data_completeness='verified') AS verified,
  (SELECT count(*) FROM happy_hours hh JOIN venues v ON hh.venue_id=v.id WHERE v.city_id=c.id) AS hh_windows
FROM cities c WHERE c.slug='<slug>' AND c.state='<ST>';"
```

Per-venue hit across **both** tables (the diff). Put the rec names in a `VALUES` list:

```bash
tsx scripts/db-query.ts "WITH names(n) AS (VALUES ('Venue One'),('Venue Two'),(...))
SELECT n.n AS name,
  (SELECT string_agg(v.name||' [ven#'||v.id||',dc='||coalesce(v.data_completeness::text,'null')||
    ',hh='||(SELECT count(*)::text FROM happy_hours hh WHERE hh.venue_id=v.id)||']',' | ')
   FROM venues v WHERE v.city_id=(SELECT id FROM cities WHERE slug='<slug>' AND state='<ST>')
   AND v.name ILIKE '%'||n.n||'%') AS venue_hit,
  (SELECT string_agg(sc.name||' [via='||coalesce(sc.seen_via_hh_recall::text,'null')||']',' | ')
   FROM seed_candidates sc WHERE sc.city_id=(SELECT id FROM cities WHERE slug='<slug>' AND state='<ST>')
   AND sc.name ILIKE '%'||n.n||'%') AS seed_hit
FROM names n;"
```

## Step 2 — Categorize EACH miss (the decision tree)

Read `venue_hit` + `seed_hit` per venue and bucket:

| Category | Signal | Fix |
|---|---|---|
| **(a) Out-of-boundary** | absent from both tables; PIP-test coords → outside polygon | expand to metro boundary (`build-aggregate-boundary.ts`) → re-discover |
| **(b) Recall miss** | absent from both tables; **in-polygon** downtown venue | adaptive recall v2 **to completion** (Step 3) → re-diff |
| **(c) Stub / extraction miss** | in `venues` as `dc=stub` with `hh=0` | `reextract:stubs` (per-venue or batch) |
| **(d) Wrong Google entity** | entity exists but wrong venue (e.g. "Stagnaro INC." ≠ wharf restaurant) | reseed with the right `google_place_id` |
| **(e) Not-in-Google / no-HH-label** | absent after a **complete** v2 sweep; generic bar with no Google "happy hour" association | **crowdsource / operator target** — recall structurally cannot reach these |

**Decide the fix from the category MIX, not a blanket sweep.** If (a) dominates it's a
boundary problem; if (b)+(c) dominate it's a recall+enrich problem; (e) is always residual.

## Step 3 — Run adaptive recall v2 (for category (b) only)

**Critical:** recall is cheap and idempotent (dedupes on `google_place_id`), but you MUST
run it **to completion** or you'll under-count the catch rate and false-negative the lever.

```bash
# 1. plan ($0) — confirm adaptive, ~450m floor, cap, and dollar estimate
tsx scripts/seed-discover.ts --city <slug> --state <ST> --hh-recall-only --estimate --debug-drops
# 2. run (~$0.12–1.20 / city, flat — recall cap; <$5 gate individually)
tsx scripts/seed-discover.ts --city <slug> --state <ST> --hh-recall-only --debug-drops
# 3. IF the run reports "hit the N-call cap with M region(s) unvisited → saved to
#    .recall-state/<slug>.json", RESUME until "swept to completion":
tsx scripts/seed-discover.ts --city <slug> --state <ST> --hh-recall-only --resume-recall --debug-drops
```

Measure the delta with the **flag**, never the upsert counter:

```sql
-- RIGHT: count rows actually tagged recall-discovered
count(*) FILTER (WHERE seen_via_hh_recall IS TRUE)
-- WRONG: the "N upserts" log line counts ON-CONFLICT updates of existing candidates
```

Then re-run the Step 1 per-venue diff to see which category-(b) venues were caught. Anything
still absent after a **complete** sweep is category (e) — crowdsource, do not keep spending.

## Step 4 — Enrich / heal (the REAL cost)

Recall only inserts `seed_candidates`. To make them live:

- **Net-new candidates → `seed:enrich --batch`** (~$0.05–0.08/venue — this is the spend
  gate; quote combined in-flight paid jobs, hold at $5). Always `--batch` (~50% cheaper).
- **Stubs (category c) → `reextract:stubs`** (per-venue LLM or `$0` batch logic sweep).
- **Promote** happens through the standard persist path (`resolveVenue` →
  `persistExtractedWindows`); never hand-enter HH.

## Cost & spend gates

- Recall: flat **~$0.12–1.20/city** regardless of size (recall cap). Idempotent.
- Enrich: **~$0.05–0.08/venue batch** — the real cost. This is where the $5 gate bites.
- **Combined-quote rule:** sum ALL in-flight paid jobs across the session (ledger spans
  sessions); proceed `<$5`, `STOP ≥$5` and surface for sign-off.
- Always `--debug-drops` (writes `docs/<slug>-discovery-drops.json` — audit trail).

## Anti-patterns (do not do these)

1. **Don't batch-run recall on a cohort before validating on one city.** Spokane validated
   the lever (~41% catch) before any cohort spend was considered.
2. **Don't trust the upsert counter.** It counts `ON-CONFLICT` updates, not net-new. Use the
   `seen_via_hh_recall` flag.
3. **Don't conclude recall "misses" a venue until you've run `--resume-recall` to
   completion.** Spokane's capped run reported 3/22 caught; resuming the 4 saved downtown
   regions caught 6 more (→ 9/22), including the #1 rec.
4. **Don't blanket-categorize.** Triage per venue — the mix determines the fix, and (e) is
   always an irreducible crowdsource residual.

## Worked example — Spokane (2026-07-04)

3 Reddit threads → ~36 unique recs. Baseline: 289 candidates, `via_recall IS TRUE = 0`
(cohort member), 224 venues, **0 verified**, 243 HH windows. After triage:

| Bucket | Count | Example | Fix |
|---|---|---|---|
| Covered (complete + HH) | ~4 | Viking, Anthony's, ZOLA, South Perry Lantern | — |
| Covered (stub, has HH) | ~3 | Osprey, PJ's, Bistango | verify/promote |
| **Recall-caught by v2** | **9** | David's Pizza, Churchill's, Davenport, Dry Fly, Europa, Hogwash, Sorella, Mootsy's, Peacock Room | enrich net-new |
| Stub / extraction miss | 8 | Union Tavern, Elliott's, Steelhead, Humble Abode, Outlaw BBQ, Little Noodle, Emma Rue's, Luna | `reextract:stubs` |
| Crowdsource (no Google HH assoc) | ~11 | Satellite Diner, The Wave, Bulldog's, bonbon, June and Co, Lorėn, Francaise, Tavolata, Shaun O'Donnels, Bark, Maryhill | contribution / operator |
| Out-of-boundary (correct) | 1 | Piccolo (Liberty Lake) | — |

**The load-bearing number:** the initial capped run caught only **3/22** (14%) of the
absent cohort — and reported 4 downtown regions unvisited. `--resume-recall` drilled them
and caught **6 more** (→ 9/22, 41%), including David's Pizza (the top rec across all 3
threads). **Always resume to completion.**

**Total spend:** 30 + 13 = 43 Text-Search calls ≈ **$1.72**, under the $5 gate. Cohort
re-run (the other ~10 `via_recall=0` cities) would be ~$1.2 × 11 ≈ **$13** → STOP at $5,
quote combined, and only after each city is triaged to confirm recall is even the right
lever for it (Santa Cruz, by contrast, was a boundary problem, not recall).

## Structural guard (so the cohort stops regenerating)

Recall is default-on for **new** cities (since 2026-06-17). The gap is only the pre-adaptive-
v2 cohort (cities onboarded before 2026-06-23 and never re-swept). Add a recall-coverage
diagnostic — analogous to the neighborhood-coverage gate — that flags any live city with
`seen_via_hh_recall IS TRUE = 0` as a recall gap. That catches this cohort and any future
regression, instead of relying on a Reddit thread to surface it.
