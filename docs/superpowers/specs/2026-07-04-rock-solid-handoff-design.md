# Rock-solid + handoff design — 2026-07-04

Goal: make the live product operationally rock-solid, hand-off-able to any operator via
deterministic runbooks, then onboard San Francisco as the showcase + validation run.

Approved 2026-07-04 with three operator modifications (city-by-city audit rollout starting
Sacramento; Tacoma Reddit cross-reference next; stub-junk suppression added as a
first-class workstream).

## Deliverable shape

Operator runbooks — no scheduled autonomy, no new orchestration infra. Exactly one new
script (`pnpm doctor`). Everything else is consolidation, pruning, and running the
existing levers to completion.

### 1. `docs/runbook-onboard-city.md`

Evolution of `new-city-runbook.md` (same 10 phases; `onboard:city` stays the paid-middle
automation). Deltas:

- Add the weak-offerings sweep (`audit:weak-offerings`) + `pnpm doctor` to the Phase 6
  audit step.
- Note `--resume-recall` is mandatory-to-completion (capped runs false-negative the
  catch rate — Spokane 3/22 capped vs 9/22 complete).
- Add stub-junk curation (see §4) as a pre-go-live step: a new city ships with its stub
  list already curated.

### 2. `docs/runbook-audit-city.md` (new)

Consolidates `all-cities-audit-runbook.md` + audit half of `OPERATOR-CHEATSHEET.md` +
`social-list-coverage-audit.md` into ONE recurring per-city cycle. Steps, each labeled
$0 or $-gated:

1. `pnpm doctor --city <slug> --state <code>` — $0 health gate (see §3)
2. `reconcile:windows --apply` — $0
3. `regate` — $0 (mandatory after any gate change)
4. `audit:data` + `audit:provenance` — $0, report → edit → `--apply`
5. `audit:weak-offerings` — $0 sweep (junk names, bare windows, time anomalies,
   event-page sources)
6. Stub-junk curation (§4) — $0, report → veto → apply
7. Bare-window heal — PAID (`reextract:stubs --bare`, batch), quote first, $5 gate
8. Social-list diff — when a Reddit/FB thread surfaces; per-venue decision tree
   (categories a–e) from the social-list runbook; recall v2 to completion for
   category (b); crowdsource residual (e) is accepted, never chased with spend
9. `spotcheck:free` — $0 eyeball of live windows

City list is dynamic (query live cities), never hardcoded.

### 3. `pnpm doctor` — the one new script

$0 all-cities health gate; one pass/fail row per live city:

- neighborhood coverage ≥95% with poly>0
- recall coverage (`seen_via_hh_recall IS TRUE = 0` ⇒ FAIL — structural guard so the
  pre-v2 cohort can never silently regenerate)
- bare-window count
- junk/weak-offering count
- provenance flags outstanding
- junk-stub count (stubs matching the §4 drop criteria still visible)
- stub ratio (informational, not pass/fail — high stub rate is inherent)

Each FAIL prints the runbook step that fixes it. `--city/--state` scopes to one city.

### 4. Stub-junk suppression (operator modification #3)

Problem: a city page with ~50 live venues and ~200 "needs info" stubs looks broken, and
many of those stubs are junk (dead restaurant, no alcohol, no realistic HH).

Approach: reuse the existing curation tooling — do NOT build a new classifier:

- `cleanup:stubs` (tiered keep/hide/delete via `classifyStub`, built #228, never yet
  `--applied`) and `gate:stub-sites` (#246 — hides no-alcohol/dead-site stubs, never
  hides published HH) are the levers.
- Quality bar stays STRICT (memory `project_curation-quality-bar`): drop = no-live-HH
  stub AND (no alcohol evidence OR dead site). Hide is reversible; delete only on the
  confident tier. Deletes never resurrect (guard already exists).
- Runbook step: run report → operator veto (CSV edit) → apply. Doctor tracks the
  residual junk-stub count.
- If after curation the visible stub list is still unacceptably long, a UI cap/ranking
  on the "needs info" section is a candidate follow-up — data curation first, UI second.

### 5. `docs/OPERATIONS.md` — the handoff index

One page: links to the two runbooks + cheat sheet, the ~20 surviving operational scripts
grouped by lifecycle stage (onboard / audit / heal / sync / eval), the cost table, and
the never-do list (no manual venue patching; discovery ONCE per city; enrich always
`--batch`; no promoting from heuristics; first-party sources only). Load-bearing agent
memories (spend gates, anti-patterns) get folded INTO the docs so handoff does not
depend on any agent's memory files.

## Script + repo cleanup

- Delete served-their-purpose one-off scripts + their package.json entries (~30). Kill
  list produced with one-line justifications for operator veto BEFORE any deletion.
- Group surviving package.json scripts by lifecycle stage.
- Archive dated report artifacts from `docs/` root into `docs/audits/archive/`.
- Delete `scripts/tmp-*` (batch-endpoint and Sevy's investigations — both landed).
  `tmp-reddit-fetch.ts` is promoted to `scripts/fetch-reddit.ts` (the audit runbook
  depends on it).

## Explicitly out of scope

- Instagram scraping/scanning — no reliable source exists (operator confirmed even
  manual scanning fails). IG-only happy hours are category-(e) crowdsource residual;
  the contribution loop is the lever.
- Contribution auto-apply (the known future density unlock) — separate effort.
- Scheduled/cron autonomy — operator runs the runbooks.
- UI changes beyond (possibly) the stub-list cap in §4, which itself is a follow-up.

## Execution phases

- **Phase 0 — Land in-flight work.** v23 + undercapture fix + golden already merged
  (#282–284). Remaining: venue-page copy tweak, `audit:weak-offerings` script + report
  docs, this spec, tmp-script deletion → fresh branch off origin/main → PR → merge.
- **Phase 1 — Script prune + reorg** (treehouse worktree). Kill list → veto → delete;
  package.json regroup; docs archive sweep. Gate: typecheck + test:ci + build green.
- **Phase 2 — Docs + doctor** (same worktree/PR series). Write the two runbooks +
  OPERATIONS.md + `pnpm doctor`. Gate: doctor runs green-or-explained on all 16 cities.
- **Phase 3 — Audit rollout, city by city.** Sacramento first, then Tacoma with the
  operator's 3 Reddit threads as the social-list cross-reference. Then remaining live
  cities in operator-chosen order. Paid steps quoted per city; $5 combined gate.
- **Phase 4 — Onboard San Francisco** via the hardened onboarding runbook. Already
  scoped on `feat/onboard-san-francisco` (boundary needs SF Bay subtraction + west
  coast clip; keep Treasure Island ≥37.830). Est. $10–22 — explicit sign-off before
  paid steps.

## Success criteria

1. `pnpm doctor` exists and every live city is green or has an explained exception.
2. An operator with no session history can onboard a city and audit a city using only
   `docs/OPERATIONS.md` and the two runbooks.
3. package.json operational scripts ≤ ~40, each documented.
4. Sacramento + Tacoma audited through the runbook (including Tacoma Reddit diff).
5. SF live on prod with the standard gates passed.
