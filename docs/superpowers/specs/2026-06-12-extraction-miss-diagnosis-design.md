# Extraction-miss diagnosis pass — design

**Date:** 2026-06-12
**Status:** approved (brainstorm), pre-implementation
**Author:** operator + Claude

## Problem

~50 venues across all 8 cities carry operator notes written during flag review — ground
truth about what the happy hour actually is, or why a capture was wrong ("you captured the
data wrong, try again"). These notes were meant to make extraction smarter. They don't:
`data_audit.operator_note` is a **write-only sink**. Its only readers display it
(`/admin/flags`), benchmark a model against it without acting (`adjudicate-flags --eval`),
or export it to an eval corpus (`export-flag-labels`). **No code path turns a note into a
recall fix or a re-extraction.**

Consequence: the "what to HIDE" notes partly fed the gate-rule mining loop (that is where
`meal_special` / `shop_page_source` / `platform_website_url` came from), but the "what we
MISSED / got WRONG" notes — increasingly the majority — drove nothing. Recall has not been
improving, and we cannot currently see, across cities, where capture leaks.

## End goals (operator)

Better new-city runs · better re-extraction · don't drop valid venues · don't include
invalid venues. This pass produces the evidence those four need; it does not itself change
the extractor.

## Scope

**In:** the ~50 venues that carry an operator note across all 8 cities — the union of
`data_audit.operator_note` (parked lane, 39) and `data_audit.agent_verdict` (where
`keepFlaggedVenue` stashes the kept/hidden note, 50). These are the label-rich, ground-truth
cases. (The ~30 notes left directly on `happy_hours` via `audit_log` are a stretch goal, not
required for the rollup.)

**Out (deliberately):**
- Applying notes or mutating any venue data.
- Writing the extractor/gate code fixes (separate work, TDD, prioritized by this pass's rollup).
- Auditing the discovery funnel for silently-dropped venues with NO note — that is **phase 2**,
  which reuses the taxonomy below as detectors.

## The failure taxonomy (the reusable core)

Every noted venue is classified into exactly one primary category (sub-cause noted in prose).
This vocabulary is the deliverable that outlives the report: phase-2 funnel detectors and any
future notes→fix wiring speak in these terms.

| Code | Category | Definition | Typical fix surface |
|------|----------|------------|---------------------|
| A | Discovery miss | The page carrying the HH was never fetched (triage/sitemap gap, opaque slug, wrong path guess). | `siteTriage`, sitemap, `pickDeclaredPages` |
| B | Fetch/render miss | Page was found but unreadable: JS-walled SPA, PDF/image not followed, or hard bot-wall. | render tier, PDF/media follow, (bot-wall = new capability) |
| C | Recall miss | Content was readable but the extractor produced no window, fewer days, or dropped a window. | extractor prompt/schema, day expansion |
| D | Wrong capture | Extractor produced WRONG data: operating-hours-as-HH, wrong window chosen live, garbled/over-priced offerings, duplicate rows. | reconcile gate, `offeringSanity`, dedup, prompt |
| E | Over-hide | The correct window WAS captured but a gate (realness/reconcile) hid it (false positive). | gate thresholds/rules |
| F | Working as intended | The note reflects a policy call (member-only, casino, all-day suppression) or already-correct data — not a bug. | none (confirm) |

A venue may show more than one symptom; it gets the **primary** category that, if fixed,
recovers the venue, with secondaries noted.

## How it runs

Two stages, clean boundary between deterministic gathering and judgment:

1. **Packet assembly — `$0`, scriptable, reusable.** A script (`scripts/diagnose-misses.ts`)
   builds one structured "diagnostic packet" per noted venue from local data only:
   - operator note (ground truth) + `data_audit.flags` + resolution
   - stored windows (active + hidden) with offerings, and `source_url`s
   - venue `website_url`, `hours_json`
   - a free triage pass (`triageSite`) showing which pages discovery finds, and a free
     HH-signal scan — so we can see discovery vs extraction separately, at no cost.

   Output: `docs/diagnosis-packets-<date>.json` (machine) — also the phase-2 reuse point.
   No model calls, no web extraction spend; triage's page probes are the only network.

2. **Diagnosis — judgment, main thread.** Claude reads each packet, fetches the live site
   where the packet is ambiguous (main-thread `WebFetch`; background agents can't web-fetch
   per env constraints — no extraction spend), classifies A–F with a one-line root cause and
   a proposed fix, and writes the report. A venue that genuinely needs a paid re-extract to
   disambiguate is quoted first and stays under the $5/run gate.

## Deliverable

`docs/extraction-miss-diagnosis-<date>.md`:
- **Per-venue table:** city · venue · note (truth) · stored · what the site actually has ·
  **category (A–F)** · root cause · **proposed fix**.
- **Rollup:** category distribution overall and by city, ranked by frequency → the
  highest-leverage extractor/gate fix to do first.
- **Golden candidates:** ground-truth → expected-extraction cases, ready to become tests
  that lock each fix (TDD for the fix phase).

## Success criteria

- Every one of the ~50 noted venues classified A–F with a root cause and a proposed fix.
- A ranked fix list where the top item is justified by frequency across cities (not one venue).
- ≥1 golden test candidate captured per distinct recall/correctness bug.
- Zero venue-data mutations; zero unplanned spend.

## Non-goals / risks

- This is diagnosis, not repair. Resist "while I'm here" fixes — they skip the prioritization
  that is the whole point.
- Site content drifts; a packet's triage is a snapshot. The live-site read in stage 2 is the
  tiebreaker, and the report dates its evidence.
- Operator notes are ground truth for intent, but a note can itself be stale (site changed
  since). Flag, don't silently override.
