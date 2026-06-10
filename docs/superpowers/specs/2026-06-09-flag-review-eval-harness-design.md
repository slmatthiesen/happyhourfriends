# Flag-review eval harness — design

**Date:** 2026-06-09
**Status:** approved by operator (approach A, report-only)

## Problem

Operator keep/hide verdicts in `/admin/flags` are labeled training data for the anomaly
rule catalog — keep = "every flag on this venue was a false alarm", hide = "the flag was
right (and `audit_log` records which window)". Nothing closed the loop: rule changes
shipped with hand-picked unit fixtures, not against the operator's accumulated judgments.

A structural blocker: a hide MUTATES the data the flag fired on (`active=false`, venue
demoted), so labels detach from their inputs unless inputs are snapshotted.

## Design

1. **`data_audit.audit_input` jsonb (migration 0020).** `audit:data` stores the exact
   rule inputs — `{websiteUrl, hoursJson, windows}` — at scan time. Every subsequent
   operator verdict automatically labels pinned inputs.
2. **`export:flag-labels`** (`scripts/export-flag-labels.ts`, $0 read-only) → corpus
   `data/flag-review-goldens.json`. NOT committed — `/data/*.json` is gitignored for
   anti-scrape reasons (public repo; the corpus contains venue HH data) and the file is
   regenerable from the local DB in one command. Uses `audit_input` when present; for verdicts
   that predate the column it reconstructs scan-time inputs from current rows +
   `audit_log` (flag-review hides flipped back to active). Case shape:
   `{city, venue, slug, label: kept|hidden, note, flagsAtVerdict, hiddenWindows, input}`.
3. **`eval:flags`** (`scripts/eval-flag-rules.ts` over pure `lib/audit/flagEval.ts`) —
   $0, hermetic, **report-only** (always exits 0 on a valid corpus; operator wants to
   watch the catch-rate evolve before gating CI). Re-runs `auditVenue` on every case and
   prints: kept-now-silent / hidden-still-caught summary, per-code keptHits (false
   alarms) vs hiddenHits (retained catches), and every disagreement.
4. **Iteration loop:** operator adjudicates → corpus grows (re-export) → disagreements
   drive rule hypotheses → each rule PR carries the before/after eval output.
   `scripts/test-flag-eval.ts` unit-tests the scorer (in ci-tests.sh).

## Decisions

- **Report-only for now** — tighten to "no new hidden-silent regressions vs baseline"
  once the corpus is a few hundred labels.
- **Venue-level agreement** for v1 (hidden = "≥1 flag still fires"); window-level
  attribution deferred (flag output isn't per-window).
- Deterministic rules first; the same corpus can later score an LLM sniff-test judge.

## First eval (16 cases: 11 kept / 5 hidden)

1/11 kept now pass silently (the PR #64 HH-page exemption); 5/5 hidden still caught.
Top false-alarm codes on kept data: `implausible_active` (6), `homepage_sourced_hh` (4),
`assumed_days_avoidable` (3) — the mining queue for the next rule changes.
