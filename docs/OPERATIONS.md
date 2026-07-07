# OPERATIONS — the operator index

Start here. Two runbooks cover everything an operator does; this page maps every living
script to its stage and records the hard rules. An operator with no session history
should be able to run the product from these three documents alone.

| I want to… | Go to |
|---|---|
| Take a new city from nothing → live on prod | `docs/runbook-onboard-city.md` |
| Health-check / heal a city that's already live | `docs/runbook-audit-city.md` |
| Diff a Reddit/FB "best happy hours" thread against the DB | `docs/social-list-coverage-audit.md` |
| Push local curation to prod | `docs/pushing-data-to-prod.md` (`pnpm push:prod`) |
| Ship merged code (main) to prod | `docs/deploying-code-to-prod.md` (`pnpm deploy:prod`) |
| Understand the AI pipeline end-to-end | `docs/pipeline-flow.md`, `PRD.md` |

The single health entry point is **`pnpm doctor`** — $0, one PASS/FAIL row per live
city, every FAIL names the runbook step that fixes it.

## Never-do list (non-negotiable)

- **Never hand-patch venue/HH data.** A misextraction means fix the extractor or gate,
  then re-run it. (Manual entry exists ONLY for `hh_probe_status='blocked'` venues.)
- **Never promote from heuristics.** Live = verified only; deletes never resurrect.
- **First-party sources only.** Never seed from aggregators (Yelp, Groupon,
  ultimatehappyhours, …). The source guard in `lib/ai/extractHappyHours.ts` enforces it.
- **Discovery runs ONCE per city.** Google bills per tile with no local ledger. Recall
  (`--hh-recall-only`) is the cheap idempotent exception.
- **Enrich is ALWAYS `--batch`.** ~50% cheaper; ask before non-batch.
- **$5 combined spend gate.** Sum ALL in-flight paid jobs (`pnpm ai:spend` spans
  sessions); STOP ≥$5 and get sign-off.
- **Prod is additive-only user data.** No full reloads; `push:prod` skips prod-newer
  venues. Operator handles deploys — merging ≠ deploying. `pnpm deploy:prod` is the
  one-command ship (git pull → build → migrate → restart over SSM); Claude builds/edits
  this tooling but does not run it against prod unasked.
- **One branch per task off `origin/main`; integrate only via GitHub PRs.**

## Script map (the ~40 you'll actually run)

**Onboarding pipeline** (order = runbook order):
`seed:cities` → `onboard:city` (wraps discover → enrich `--batch` → regate → combo-drop
behind one cost confirm) · piecewise: `seed:discover`, `seed:enrich`, `scope:venues`,
`gen:onboarding-review` · break-glass: `reset:city-venues`

**Neighborhoods:** `import:osm-neighborhoods`, `import:locality-neighborhoods` (metro
slugs only), `generate:cardinal-districts` (always pass `--downtown`),
`backfill:neighborhoods`, `backfill:neighborhood-tiers`, `analyze:neighborhood-coverage`
(cross-city gate: ≥95% + poly>0), `restore:neighborhoods` (revert lever),
`import:neighborhoods` (city-GIS import), `import:osm-open-space` (discovery tile mask)

**Audit & heal:** `doctor` · `reconcile:windows` · `regate` · `audit:data` ·
`audit:provenance` · `audit:quality` (destructive curation — run LAST) ·
`audit:bare-windows` · `audit:weak-offerings` · `audit:hh-anomalies` ·
`audit:venue-sites` · `audit:fix` (paid corrections; `--estimate` first) ·
`spotcheck:free` · `review:hidden` (run with every heal) · `review:meal-specials` ·
`reextract:stubs` (paid) · `reextract:stubs:free` ($0) · `promote:own-site-hh` ·
`apply:chain-happy-hours` · `backfill:offering-names` · `clean:junk-offerings` ·
`reverify:all-day`

**Stub curation & diagnostics:** `cleanup:stubs` (tiered keep/hide/delete) ·
`gate:stub-sites` · `scan:stub-signal` (pre-spend triage) · `scan:hh-signal` ·
`diagnose:no-hh` · `debug:extract` (one ~5¢ trace) · `fetch:reddit` · `remove:venues`

**Flags & evidence:** `adjudicate:flags` · `apply:adjudications` · `cleanup:evidence`

**Ops:** `ai:spend` (ledger, month-to-date) · `gsc:pull` (Search Console, report-only)

**Deploy code (SSM):** `deploy:prod` — the one-command ship (git pull → build →
migrate → restart, run as a single non-interactive SSM RunCommand; no manual
paste-into-shell)

**Prod sync (SSM — the AWS box has no open ports):** `push:prod` (THE command:
additive + republish-changed) · `push:data:additive:ssm` (insert-only subset) ·
`push:updates:ssm` · ⚠️ droplet-era direct-IP scripts still present but need an SSM
tunnel or migration before use: `push:deletions`, `pull:data`, `pull:queue`,
`publish:venue`

**Evals (paid, run around extractor/verifier changes only):** `eval:extractor`
(~$0.20 — before/after every extractor or prompt change, NOT for pure onboarding) ·
`eval:verifier`

**Tests:** `pnpm test:ci` runs all hermetic suites; `pnpm typecheck`; `pnpm build` is
the acceptance gate. Golden cases live in `scripts/fixtures/hh-golden/`.

## Cost table

| Action | Cost | Notes |
|---|---|---|
| doctor / audits / regate / reconcile / free re-extract | $0 | deterministic, local |
| Discovery (new city) | ~$1.50–5 | Google per-tile, NO ledger — estimate first, run ONCE |
| HH recall re-sweep | ~$0.12–1.20/city | idempotent, resume to completion |
| Enrich | ~$1–35/city | free-first + `--batch`; ~$0.05–0.08/venue |
| Bare-window heal | ~$0.015/venue | batch; `audit:bare-windows` is the $0 preview |
| Targeted re-extract | ~$0.01–0.03/venue | `--quick` for single venues |
| eval:extractor | ~$0.20/run | only around extractor changes |

## Data invariants (PRD §13)

Missing value → `null`, never a guess · every applied change carries a `source_url` ·
ISO days (1=Mon…7=Sun) · times are venue-local (never normalize to UTC) · dedup on
`google_place_id`, never name · prompts versioned in `/prompts/` with `prompt_hash`
in `ai_usage_ledger`.

## Retired scripts (recoverable from git history)

Removed 2026-07-05 (PR #286) after their investigations closed or successors landed —
`git log --diff-filter=D -- scripts/<name>` finds the deletion; check out the parent
commit to restore. One-off backfills (`backfill-timezones` — engine now defaults tz;
`backfill-place-ids`, `backfill-hours`, `backfill-google-neighborhoods`,
`backfill-venue-types` — discovery captures these per-candidate), superseded stub
curation (`drop-menu-platform-stubs`, `delete-empty-cuisine-stubs`,
`suppress-dead-end-stubs`, `triage-stub-sites`, `rank-stub-candidates`), closed
investigations (`scan-onsite-hh`, `scan-hidden-menu-json`, `scan-image-mismatch`,
`scan-menu-embeds`, `scan-squarespace-clickthrough`, `diagnose-misses`,
`find-missed-hh-docs`, `harvest-hh`, `apply-harvest`, `analyze-discovery-channels`,
`report-neighborhood-merges`, `cleanup-duplicate-windows`, `reverify` calibration
tools `eval-flag-rules`/`export-flag-labels`, `keep-flagged-venues`,
`prune-empty-venues`, `prune-by-place-type`, `purge-source-data`,
`recompute-audit-flags`, `reset-for-resource`, `export-candidates`), and dead
droplet-era sync paths (`sync-data-to-prod`, `push-data-to-prod`,
`push-data-additive`, `pull-data-upsert`).

Historical run artifacts (regate reports, per-city audits, onboarding reviews) live in
`docs/audits/archive/`.
