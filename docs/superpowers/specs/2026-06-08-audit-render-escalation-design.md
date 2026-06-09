# Audit render-escalation: recover happy-hour menus behind JS/PDF — design (2026-06-08)

## Problem

We keep missing happy-hour menus on venue sites even though the data is plainly published.
Grounding case **Oeste - Bar** (Oakland): its happy-hour *specials* live on `/happy-hour-menu`,
a Webflow page whose "Happy Hour" link resolves to a **PDF**. We store only Tue–Sun
17:00–19:00 *times* (no specials), sourced from the homepage.

Traced live, the failure is NOT where you'd expect — almost every tier works:

| step | status |
|---|---|
| Sitemap lists the HH page | ❌ Webflow's sitemap lists only `/menus`, never the sub-page |
| Triage discovers `/happy-hour-menu` | ✅ found via homepage anchors (in our priority URLs) |
| Headless render resolves it to the PDF | ✅ `renderUrl()` → `isPdf: true`, captures the PDF |
| Model reads PDFs | ✅ proven (Bottega, Bellanico) |
| **Result has the specials** | ❌ — see below |

**Root cause: the free-first fast-path short-circuits before the render/PDF tier.** The
deterministic free parser (`parseHhText`/`freeExtract`, run with `noRender: true`) finds
happy-hour *times* in the homepage HTML, returns a confident `$0` result, and the pipeline
never escalates to render the unread `/happy-hour-menu` PDF where the actual specials are.
This was confirmed twice: both the `audit:fix` free pass and an operator-targeted
`reextract --venue --url <pdf>` came back `$0`, sourced from the homepage, with **zero
offerings** — even when handed the PDF URL. The render+PDF capability exists and works on
this exact venue; a cost optimization is bypassing it.

## Insight (the unifying trigger)

The thing to escalate on is **not the venue's category** (stub vs flagged vs complete).
It is one uniform signal:

> **The venue has an HH-specific page that the free pass could not extract from** — because
> it's a JS shell, resolves to a PDF/image, or yields happy-hour times but **no offerings**.

A JS-walled *stub* and a homepage-sourced *"complete"* venue like Oeste are the **same
problem** — an unread HH page — and must go through the **same** escalation loop.

## Goal

Add an opt-in, cost-gated **render-escalation** step to the audit: for every venue with an
unread HH-specific page, run the paid extractor (render ON, reads PDFs/images) and apply the
recovered windows **+ offerings** reversibly. Audit-scoped first; the detector is then liftable
into the shared `seed:enrich`/`reextract` free paths (phase 2, out of scope here).

## Design principles

- **One trigger, uniform.** `needsRenderEscalation` keys on "unread HH page," not on
  stub/flagged/complete. Stubs ∪ flagged venues are the candidate set; the *condition* decides.
- **Free detection, paid escalation.** Detecting the unread page is `$0` (triage + free pass we
  already run). Only the escalation (render + model) costs money, bounded to venues that have a
  real HH page to read.
- **Cost-gated + opt-in.** `--escalate-paid` is off by default. Dry-run prints
  *"N venues would escalate, est. $X"* and spends nothing; only `--apply --escalate-paid` pays.
  Honors `[[feedback_cost_quote_accuracy]]` / `[[feedback_verify_cost_before_claiming_free]]`.
- **Reversible, one persist path.** Recovered windows + offerings land through the existing
  audited persist (`persistExtractedWindows`); superseded prior windows are soft-deactivated with
  `audit_log` rows. Never hard-delete.
- **Build on, don't duplicate.** Reuse `triageSite`, `buildExtractRequest`, `freeExtractFromPages`
  (free pass), `extractHappyHours` (paid, render-on), `scoreHhUrl`, `computeCorrection`,
  `persistExtractedWindows`. New code is the detector + the loop wiring.

## Components

### 1. `lib/audit/renderEscalation.ts` — the detector (pure, unit-tested, $0)

```
needsRenderEscalation(input: EscalationInput): EscalationVerdict
```

`EscalationInput`:
- `priorityUrls: string[]` — what triage discovered/ranked (from `resolveEnrichAction`).
- `readUrls: string[]` — URLs the free pass actually extracted usable content from
  (`built.pages[].url`).
- `freeWindows: { offerings: unknown[] }[] | null` — the free `ExtractResult.happyHours` (or null).

`EscalationVerdict = { escalate: boolean; reason: "unread_hh_page" | "hh_page_no_offerings" | null; hhPages: string[] }`.

Logic (pure; `scoreHhUrl` is the only dependency):
- `hhPages = priorityUrls.filter(u => scoreHhUrl(u) > 0)`. If empty → `{escalate:false}` (nothing
  richer to read).
- `unreadHhPage = hhPages.some(u => !readUrls.includes(normalize(u)))` → reason `unread_hh_page`.
- `noOfferings = freeWindows && freeWindows.length > 0 && freeWindows.every(w => w.offerings.length === 0)`
  → with `hhPages` non-empty, reason `hh_page_no_offerings`.
- `escalate = unreadHhPage || noOfferings`.

Both Oeste conditions hold (the homepage windows carry no offerings AND `/happy-hour-menu` is
unread), so it escalates. A venue whose HH is fully captured (offerings present, HH page read)
does not.

### 2. `audit:fix --escalate-paid` — the escalation loop (extends `scripts/audit-fix.ts`)

- **Candidate set:** venues in the city with a `website_url` that are **stubs OR audit-flagged**
  (`data_completeness='stub'` OR have ≥1 `data_audit` flag). Excludes confident-complete venues.
- For each candidate: triage → `buildExtractRequest({noRender:true})` → `freeExtractFromPages`
  (all `$0`) → `needsRenderEscalation(...)`.
- Three modes for an escalation candidate, gated by flag (default → most → most):
  - **`--escalate-paid` (default dry-run, $0):** count it, add its `~$0.05` to the estimate, print
    `⏫ <name>: would escalate [<reason>] (HH page: <url>)`. NO spend, NO writes, NO extraction.
    This is the free "how many / how much" preview.
  - **`--escalate-paid --preview` (PAID extract, NO DB write):** run
    `extractHappyHours({venueName, websiteUrl, cityName, priorityUrls})` — render ON, reads the PDF
    (ledgers spend) — but **write nothing to the venue tables**. Instead emit the **review report**
    (below) showing, per venue, STORED vs FOUND vs PROPOSED CHANGE, and persist the extracted
    results to `docs/audit-escalation/<city>-<date>.json` so a later apply needs no re-extraction.
    This is the "show me before you do anything" gate the operator runs first.
  - **`--escalate-paid --apply` (PAID extract + write):** as `--preview`, then for high-confidence
    results apply immediately:
    - Land windows **+ offerings** via `persistExtractedWindows` (the ONE audited persist:
      reconcile gate + realness gate + offerings insert + promote-to-complete + ledger).
    - Soft-deactivate the venue's **prior** active windows not in the new set
      (`computeCorrection`'s deactivation set over `stored` vs the paid windows), each with an
      `audit_log` row. This removes the superseded homepage-sourced windows.
    - Update `data_audit.resolution='fixed'`, `fix_applied=true`.
    - Not high-confidence → report; `resolution='reported'`.
  - **`--apply-from <report.json>` (write only, no spend):** apply a previously-`--preview`ed report
    to the DB without re-extracting (mirrors `reextract --collect`: review the report, then commit
    it). Same persist + deactivate + ledger-of-prior-spend path; re-checks `isHighConfidenceCorrection`.
- **Without `--escalate-paid`:** behavior is unchanged (free-only) — escalation is purely additive.
- **Reporting:** final tally adds `escalated: N ($X spent)` alongside `fixed`/`reported`.

### 2b. Review report (the "before we do anything" output)

`--preview` writes `docs/<city>-escalation-review-<date>.md` + the apply-cache
`docs/audit-escalation/<city>-<date>.json`. Per escalated venue the markdown shows three blocks so
the operator can judge each change before committing:

- **STORED** — current active windows + offerings + source URLs (what users see now).
- **FOUND** — windows + offerings the paid render+PDF extraction returned, with the source URL it
  cited (e.g. `/happy-hour-menu`) and the model's confidence.
- **PROPOSED CHANGE** — the computed diff: which windows would be inserted (with offerings), which
  prior windows soft-deactivated, and whether it passes the high-confidence gate (so report-only
  cases are visible too).

The operator reviews this, then runs `--apply-from <report.json>` to commit only what they approve
(or re-runs `--apply` to do it in one pass once trusted).

### 3. Cost estimate + safety

- Per-venue estimate constant `ESCALATION_COST_EST_USD = 0.05` (≈ one render + one Sonnet extract;
  matches observed 3–5¢). Dry-run sums it across candidates and prints the total up front.
- `extractHappyHours` already ledgers real spend to `ai_usage_ledger`; the loop sums
  `result.costCents` for the run's actual total.
- Render is bounded by the existing `MAX_DOC_PAGES`/`MAX_DOC_BYTES` budget in `fetchPages` and the
  shared Chromium (`closeRenderBrowser()` in `finally`).

## Data flow

```
candidate venues (stubs ∪ flagged, w/ website)
        │  triage + free pass  ($0)
        ▼
 needsRenderEscalation? ──no──▶ (unchanged free behavior)
        │ yes
        ▼  mode?
   ┌──────────────┬──────────────────────┬───────────────────────┐
 default        --preview               --apply              --apply-from <json>
 (free)         (PAID, no write)        (PAID + write)       (write, no spend)
   │              │                       │                     │
 count+est$   extractHappyHours       extractHappyHours      read cached results
 print        (render→PDF→model)      (render→PDF→model)         │
   │              │                       │                     │
   │           REVIEW REPORT           ┌──┴── high-confidence? ──┴──┐
   │           (STORED vs FOUND        yes                         no
   │            vs PROPOSED)            │                           └─▶ resolution='reported'
   │           + cache json            ▼
   │              │            persistExtractedWindows (windows + OFFERINGS + reconcile + promote)
   │              │              + soft-deactivate superseded prior windows (audit_log)
   │           NO DB WRITE        + resolution='fixed'
   ▼              ▼
 (operator reviews report → --apply-from to commit)
```

## Testing

- **Detector (`scripts/test-render-escalation.ts`, pure, $0, in CI):** fixtures incl. the Oeste
  shape — priorityUrls containing `/happy-hour-menu` (scoreHhUrl>0) not in readUrls, free windows
  with empty offerings → `escalate:true, reason:"unread_hh_page"`; a fully-captured venue (HH page
  read, offerings present) → `escalate:false`; a venue with no HH-specific page → `escalate:false`.
- **Loop (manual / integration), the operator-facing sequence:**
  1. `audit:fix --city oakland --state ca --escalate-paid` (free dry-run) → lists Oeste + est cost,
     writes nothing, spends nothing.
  2. `… --escalate-paid --preview` → spends on extraction, writes the **review report**
     (`docs/oakland-escalation-review-<date>.md`) with Oeste's STORED (homepage times, no specials)
     vs FOUND (windows + offerings from `/happy-hour-menu` PDF) vs PROPOSED CHANGE — but NO DB write.
  3. operator reviews → `… --escalate-paid --apply-from docs/audit-escalation/oakland-<date>.json`
     commits it: ≥1 active window WITH offerings sourced from `/happy-hour-menu`, prior homepage
     windows deactivated, `audit_log` trail, spend ledgered. **This is the proof gate.**

## Rollout

1. Land `renderEscalation.ts` + detector tests (CI).
2. Extend `audit:fix` with `--escalate-paid` (dry-run cost quote + apply path).
3. Prove on Oeste (dry-run → `--apply --escalate-paid`), verify specials + reversibility.
4. Run Oakland `--escalate-paid` dry-run for a cost quote; apply on operator OK.

## Out of scope

- Lifting the detector into `seed:enrich` / `reextract` free paths (project-wide phase 2).
- New discovery/ranking changes (triage already finds the HH page; the gap was escalation).
- Hard-deleting rows; auto-applying low-confidence paid results.
- A render service swap (Firecrawl etc. — evaluated and dropped, `[[project_firecrawl-render-backend]]`).
