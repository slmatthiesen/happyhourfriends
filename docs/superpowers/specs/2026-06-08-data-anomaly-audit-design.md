# Data anomaly audit + auto-fix system — design (2026-06-08)

## Problem

We are spot-checking hundreds of stored venues by hand and finding records that "don't
make sense" — without a fixed list of what to look for. The grounding example
(Oakland, 2026-06-08):

**London Bar & Grill** (`london-bar-grill`) stored two *active* happy-hour windows, both
labelled "days assumed Mon–Fri (none stated)":

| window | source_url | note |
|---|---|---|
| Mon–Fri 16:00–19:00 | `…/` (homepage) | days assumed |
| Mon–Fri 18:00–21:00 | `…/menu/` | days assumed (spurious — dinner-menu times) |

The venue's own `/happy-hour/` page plainly states **"Happy Hour Monday–Friday 4–7"** in
raw HTML. The correct answer is a single window, `Mon–Fri 16:00–19:00`, sourced from
`/happy-hour/`, days *stated* (not assumed).

### Root cause (diagnosed, reproduced)

The Oakland data was written by the **free deterministic parser** (`lib/places/parseHhText.ts`,
the free-first fast-path in `seed:enrich`), not the paid model extractor. Running the
parser per-page reproduces the defect exactly:

- `/` → `16:00–19:00`, **days assumed** (parser didn't see days on the homepage).
- `/happy-hour/` → `16:00–19:00`, **days REAL** (`notes=null` — it read "Monday–Friday").
- `/menu/` → `18:00–21:00`, days assumed, **`plausible=false`** (dinner times, not HH).

Three distinct bugs, all upstream of any audit:

- **(A) `freeExtract` dedup keeps the wrong twin.** `lib/ai/freeExtract.ts` dedups windows
  by `days|start|end`. The homepage's *assumed-days* window and `/happy-hour/`'s
  *real-days* window share an identical key (assumed days coincidentally equal the real
  `{1–5}`), so they collapse and **whichever page parsed first wins**. The homepage version
  (assumed days, generic `source=/`) survived; the authoritative `/happy-hour/` version was
  discarded. Had the real days differed (e.g. Mon–Thu), two conflicting rows would persist.
- **(B) Suspect leak.** The `/menu/` window is `plausible=false`; `freeExtract` marks it
  `suspect`, which should persist hidden (`active=false`) — but it reached `active=t`.
- **(C) Escalation gate too lax.** When every free window is assumed-days or implausible,
  the free fast-path still returns a confident `confidence:1` result, so `seed:enrich`
  **never escalates to the paid model extractor** — which fetches `/happy-hour/` and returns
  the correct single window (verified via `debug-extract`, conf 0.85).

The deterministic shape gate `reconcileWindows` (`lib/places/windowReconcile.ts`, wired into
`persistExtractedWindows`) would catch the *overlap* (two windows sharing `{1–5}` whose
clock ranges overlap → both hidden → stub) on a fresh pull — better than wrong, but it
neither corrects provenance (A happens before it) nor recovers the real `Mon–Fri 4–7`.
This data also predates the reconcile wiring.

## Goal

A locally-run, idempotent system that:

1. **Detects** fishy stored data — both the failure modes we can name (rules) and the
   weirdness we can't (an in-session agent sniff-test), without a metered per-venue API loop.
2. **Fixes** flagged venues by re-fetching their own pages — auto-applying high-confidence
   corrections through the audited write path, reporting the rest for operator spot-check.
3. **Remembers** which venues it has cleared, so each is checked once and never re-spent on.

Plus a prerequisite **root-cause fix** (A/B/C) so new pulls stop creating this.

## Design principles

- **Free by default, no metered API loop.** Detection rules and the re-fetch/re-parse fix
  are $0 (plain HTTP + deterministic parser). The "does this look weird?" judgment is done
  by the agent already in this CLI session, not a billed Anthropic-API call per venue.
  Paid-model re-extraction is opt-in via an explicit flag.
- **Idempotent.** A `data_audit` ledger records every venue checked; subsequent runs skip
  cleared venues unless `--recheck`.
- **Never hard-delete.** Corrections flow through the existing audited engine
  (`audit_log`, reversible); spurious windows are soft-deactivated, not deleted — consistent
  with `realnessGate` / `windowReconcile`.
- **Build on, don't duplicate.** Reuse `reconcileWindows` for shape verdicts
  (overlap / operating-hours / duplicate); the audit layer adds *provenance* rules
  (assumed-days-avoidable, homepage-sourced) and the *re-fetch-and-correct* step reconcile
  lacks.
- **Extensible catalog.** Recurring patterns the agent surfaces get promoted into
  deterministic rules over time.

## Prerequisite: root-cause fixes (SEPARATE fast PR, lands first)

Small, well-tested, off `origin/main` (all three files — `freeExtract.ts`, the persist
path — are already on main). Stops new fishy data immediately and makes the audit fixer
produce correct output.

- **(A) — DONE.** `freeExtract.ts` cross-page dedup now keeps the **best-provenance** twin,
  not whichever parsed first. `parseHhText` exposes a `daysAssumed` boolean; freeExtract
  scores each window `(daysAssumed ? 0 : 1000) + scoreHhUrl(sourceUrl)` and keeps the highest
  per `days|start|end` key (stated days dominate any URL signal; HH-specific source breaks
  ties), preserving first-seen order. London's `/happy-hour/` real-days window now wins over
  the homepage's assumed-days twin.
- **(B) — DONE.** Bug confirmed live: `seed:enrich` has its **own** persist that set
  `active = !verdict.suspect`, ignoring the free-parser `suspect` flag (and running no
  reconcile gate) — so the implausible `/menu/` 6–9 PM window went `active=t`. Both the
  active-count tally and the insert now route through a new shared pure helper
  `windowShouldBeActive({ realnessSuspect, freeSuspect })` (in `realnessGate.ts`), so a
  free-parser-suspect window is hidden. Fully consolidating enrich onto
  `persistExtractedWindows` (to also inherit the reconcile gate) is a follow-up that depends
  on the Spokane reconcile work merging to main.
- **(C) — DEFERRED (policy, not a bug).** Auto-escalating a "thin" free result (all windows
  assumed-days or implausible) to the *paid* model was considered, but A+B alone already fix
  london, and auto-escalation (a) spends money per venue and (b) conflicts with the operator's
  assume-Mon-Fri rule, under which an all-assumed-days result is an *accepted* outcome rather
  than a failure. So enrich's free-first path is unchanged; deliberate paid re-extraction
  belongs to the audit fixer's opt-in `--escalate-paid` flag.

Unit tests (all $0, no DB/AI): `test-parse-hh-text.ts` (the `daysAssumed` boolean),
`test-hh-outcomes.ts` (cross-page dedup keeps the real-days/HH-specific twin, order-
independent), `test-realness-gate.ts` (`windowShouldBeActive` truth table). End-to-end
proof: the fixed free parser over london's three live pages yields one ACTIVE
`Mon–Fri 16:00–19:00` from `/happy-hour/` and hides the `/menu/` 6–9 PM twin.

## Components

### 1. `lib/audit/anomalyRules.ts` — pure rule catalog (unit-tested, $0)

```
auditVenue(input: VenueAuditInput): AnomalyFlag[]
```

`VenueAuditInput` carries the venue's `{ websiteUrl }` and its windows
`{ daysOfWeek, startTime, endTime, allDay, active, sourceUrl, notes }[]` plus any
`reconcileWindows` verdicts. `AnomalyFlag = { code, severity, evidence }`.

Initial catalog (each a small pure predicate; `severity` ∈ `auto_fixable | report`):

| code | fires when | severity |
|---|---|---|
| `assumed_days_avoidable` | a window's `notes` = the assumed-days marker AND the venue has an HH-specific page reachable (homepage anchors `/happy-hour`‑shaped href, or a path-guess resolves 200) | auto_fixable |
| `homepage_sourced_hh` | an active HH window's `sourceUrl` is the bare domain or `/` | report |
| `overlapping_windows` | `reconcileWindows` returns `overlap_conflict` among active rows | report |
| `duplicate_windows` | same `days|start|end` across active rows with differing source | auto_fixable |
| `operating_hours_active` | `reconcileWindows` flags `operating_hours` yet row is active | report |
| `implausible_active` | a `plausible=false`-shaped window is active (the B leak, retroactive) | auto_fixable |

Severity governs whether a re-fetch correction may auto-apply vs. report-only.

### 2. `scripts/audit-data.ts` — scan + ledger (`audit:data`)

- Args: `--city <slug> --state <code>` (per the repo's city-arg requirement) or all-cities
  mode; `--recheck` to re-scan cleared venues; `--emit-batches` for the agent layer.
- Loads venues not present in `data_audit` (or all, with `--recheck`), runs `auditVenue`.
- Writes a review report: `docs/<city>-data-audit-<date>.{md,csv,json}` — venue, flags,
  current windows, source URLs, website.
- Records each scanned venue in **`data_audit`** (see migration below) with its rule flags
  and `resolution='scanned'`.

### 3. Agent batch-review — the in-session "sniff test" (process, $0)

`audit:data --emit-batches` writes batches of un-reviewed venue data (stored windows +
source URLs, data-only, compact) to `docs/audit-batches/<city>-<n>.md`. This Claude Code
session — or spawned subagents — reads each batch, flags novel weirdness the rules don't
encode, and writes verdicts back to `data_audit` (`agent_verdict`, optional new flags).
No Anthropic-API billing: it reuses the session the operator is already in. Recurring
patterns get promoted into Component 1's catalog.

### 4. `scripts/audit-fix.ts` — re-fetch + correct (`audit:fix`)

For each venue with `auto_fixable` flags (and, with a flag, `report`-severity ones):

1. Re-fetch the venue's pages (plain HTTP via the existing triage + fetch path — `$0`).
2. Re-run the **fixed** free parser → `reconcileWindows`.
3. Compare the resulting window-set to what's stored.
4. **High-confidence** correction — a single coherent set, real days, sourced from an
   HH-specific page, no overlap — auto-applies through the audited engine
   (`persistExtractedWindows` / apply engine): correct the kept window's days + source,
   soft-deactivate windows not in the new set. Reversible via `audit_log`.
5. Otherwise → report only.
6. Update `data_audit.resolution` (`fixed` | `reported` | `clean`) and `fix_applied`.

**Cost posture: free-only by default.** Paid-model re-extraction is opt-in
(`--escalate-paid`), for venues the free re-parse can't resolve.

## Data model — migration `00NN_data_audit`

```
data_audit (
  id            uuid pk,
  venue_id      uuid fk venues unique,
  audited_at    timestamptz not null,
  flags         jsonb not null default '[]',   -- AnomalyFlag[]
  agent_verdict text,                            -- in-session review note, nullable
  resolution    text not null,                  -- scanned | clean | fixed | reported
  fix_applied   boolean not null default false
)
```

One row per venue (unique `venue_id`); `audit_data` upserts. Idempotency = "skip venues
already in `data_audit` unless `--recheck`."

## Data flow

```
[prereq PR: fix A/B/C in freeExtract + escalation]
         │
audit:data ──rules──▶ data_audit + report ──emit-batches──▶ agent review ──▶ data_audit
                                                                                 │
                                                                          audit:fix
                                                                    (re-fetch, free parser)
                                                          ┌──────────────┴──────────────┐
                                                  high-confidence                    ambiguous
                                              auto-apply (audited)                  report only
                                                          └──────────────┬──────────────┘
                                                              operator spot-checks report
```

## Testing

- **Rules:** pure-function unit tests (`scripts/test-anomaly-rules.ts`, tsx, no DB/AI) with
  fixtures incl. the london window-set → expects `assumed_days_avoidable` +
  `homepage_sourced_hh` + (the `/menu/` row) `overlapping_windows`.
- **Prereq A/B/C:** the london three-page fixture (above).
- **Fixer:** an integration check in a rolled-back transaction (mirroring
  `scripts/test-neighborhood-assignment.ts`) that runs `audit:fix` against a seeded
  london-shaped venue and asserts: one active `Mon–Fri 16:00–19:00` from `/happy-hour/`,
  the `/menu/` window deactivated, an `audit_log` entry written.
- **Idempotency:** second `audit:data` run skips cleared venues; `--recheck` re-scans.

## Rollout

1. **Prereq PR** (A/B/C + tests) → merge to main.
2. Land migration + `lib/audit/anomalyRules.ts` + `audit:data` + `audit:fix` + tests.
3. Run `audit:data --city oakland --state ca`; review report; `audit:fix` → london
   auto-corrects to `Mon–Fri 16:00–19:00 /happy-hour/`, `/menu/` row deactivated.
4. Agent batch-review pass over Oakland → promote any recurring novel pattern into the
   rule catalog.
5. Sweep the other cities (idempotent; free by default).

## Out of scope

- Per-venue metered Anthropic-API anomaly judging (decided: in-session agent + rules).
- Auto-resolving overlap conflicts to a "winner" (reconcile already hides all for review).
- Venue-metadata audits beyond HH windows (type/neighborhood/name) — a later catalog
  extension once the HH audit is proven.
- Hard-deleting any row (audit only deactivates / corrects via the reversible engine).
- A recurring cron (start as an operator-run CLI; schedule later if desired).
