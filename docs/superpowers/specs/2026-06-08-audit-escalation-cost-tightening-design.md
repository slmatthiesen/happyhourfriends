# Audit render-escalation: cost tightening (confirmed-only + free-first routing) — design (2026-06-08)

**Amends** `2026-06-08-audit-render-escalation-design.md`. The render-escalation it specced
WORKS (recovers PDF/JS HH menus — Oeste proven) but is **cost-inefficient**: Oakland
`--escalate-paid --preview` spent **$1.09 across ~66 paid calls, ~62 of which found nothing**
(~6% hit rate). This amendment makes it smart+cheap without losing recoveries.

## Root cause (two wrong levers — both code-grounded)

1. **The detector escalates GUESSED paths.** `needsRenderEscalation` (lib/audit/renderEscalation.ts:39)
   filters `priorityUrls`, but `siteVerdictFromFetch` (lib/places/siteTriage.ts:362-383) FLATTENS
   four sets — `rankedMedia ∪ confirmed ∪ declared ∪ guesses` — into `hhSignalUrls`. So a *guessed*
   `/happy-hour-menu` (one of 12 `GUESS_MENU_PATHS`) scores ≥60 and escalates the same as a real
   nav-linked page. Oakland: **72 of 111 escalations were the guessed `/happy-hour-menu`**, +13
   guessed `/happy-hour`. Webflow/Wix **soft-404** unknown paths to a 200 catch-all, so the guess
   passes `hasSignal` and reaches the paid model. (Many also hard-404 — those die free at fetchUrl,
   but the detector still counted them "unread HH page" → escalate.)
2. **`extractAndDiff` passes `forcePaid: true`** (scripts/audit-fix.ts), bludgeoning past the
   free-first short-circuit in `extractHappyHours` (lib/ai/extractHappyHours.ts:589) so EVERY flagged
   venue hits the model — even when a $0 render+free-parse would have sufficed.

`isDenylistedSource` (the §13 aggregator host denylist) matched **0 of 111** Oakland candidates —
the aggregator-shaped URLs (`…-happy-hours-specials`, embedded `beermenus`) sit on *first-party*
hosts. It stays as a correct, cheap safety net but is NOT what saves the money here.

## The fix

**Pre-filters (all $0, before any model spend):**
1. **Triage exposes confirmed vs guessed.** Add `confirmedHhUrls` to `SiteVerdict` /
   `resolveEnrichAction` = `rankedMedia ∪ confirmed(anchors+Wix routes) ∪ declared(sitemap)`,
   **excluding `guesses`**. `hhSignalUrls` is unchanged — the free HTTP pass still probes guesses
   (cheap, occasionally finds a real unlinked page); guesses simply can no longer escalate.
2. **Detector uses `confirmedHhUrls`** (not `priorityUrls`) and drops `isDenylistedSource` hosts.
   → 111 candidates collapse to the ~10-15 with a real, unread HH page. *This is the cost lever.*

**Phase-2 routing — replace `forcePaid` with an explicit route over the fetched pages.**
Naive "just flip `forcePaid:false`" is WRONG: the internal free-first short-circuits on ANY clean
window, so a thin HTML window (times, no offerings) would short-circuit and NEVER read a linked PDF
holding the actual offerings (the `hh_page_no_offerings` intent). So route explicitly:

```
route(pages, freeResult):
  no usable pages                       → skip   ($0)
  any page is PDF/image                 → model  (free parser can't read a doc — Oeste ✓)
  HTML, free-parse yields clean window
        WITH ≥1 offering                → free   ($0)
  HTML, free-parse miss / thin          → model  (the "then-model" fallback)
```

`freeExtractFromPages` already emits only `confidence:"clean"` windows and marks implausible ones
`suspect` (written hidden) — the built-in guard against plausible-but-wrong free rows. Update
`--estimate` to count `PDF/image + free-parse-misses` as billable so the preview is honest.

## Scope (operator: "audit first, then lift")

Build the detector+route as a **shared, reuse-ready routine** (`recoverVenueHappyHours`-shaped:
triage → confirmed-detect → fetch/render → free-first route → model-on-miss → supersede), but
**wire it into the AUDIT only this pass**. Prove it on Oakland (free detection $0 + ~$0.20 paid
re-run). **Fast-follow (separate change): lift the same routine into `seed:enrich`/`reextract`** so
new cities stop accumulating these misses on the first pass. (Normal enrich already renders +
free-firsts — seed-enrich-candidates.ts:614 sets neither `noRender` nor `forcePaid` — what it lacks
is the confirmed-unread-HH detector + targeting + supersede; that's what the shared routine adds.)

## Validation (TDD, golden fixtures from render-probed real venues)
- **Triage:** confirmed set excludes a guessed `/happy-hour`; includes Oeste's nav-linked `/happy-hour-menu`.
- **Detector:** Oeste (confirmed, unread) escalates; Ashby/Bombera (guessed `/happy-hour-menu`, real 404) do NOT; an aggregator-host page does not.
- **Route (pure fn):** PDF-page→model; thin-HTML-window+PDF→model; HTML-clean+offerings→free; empty→skip.

## Expected impact
Oakland: ~66 paid → model fires only on PDFs/images (~2) + HTML free-parse-misses; the ~70 guessed
paths vanish at $0. ≈ **$0.10-0.30 vs $1.09**, equal-or-better recoveries (free-parse adds $0 HTML
captures; a miss falls back to the full model, so nothing is silently dropped — though a free HTML
capture may carry fewer offerings than the model would, the cost-for-recall tradeoff chosen).

## Cached-wins application (done 2026-06-08, recorded here)
`--apply-from oakland-2026-06-09.json`: 4 high-conf committed, 107 reported. Verified live:
**Oeste** (3 win/30 off) + **East End** (complete, 1 win/2 off). **alaMar** + **RnR** windows landed
but the realness/reconcile gates correctly HID them (alaMar: offerings-less; RnR: all-week + overlap)
→ stay stubs. 5 non-high-conf paid findings remain cached (incl. **D.Monaghans +7**), marked reported.

## Follow-on findings (not in scope; logged)
- **`isHighConfidenceCorrection` ⟂ realness/reconcile gates.** Auto-apply "high-conf" rows (alaMar,
  RnR) immediately went hidden. The auto-apply gate should agree with `windowShouldBeActive` so we
  don't "apply" rows that the gates suppress.
- **Free-parser recall (`parseHhText`) is the remaining ceiling.** Every HTML window it learns to
  read is a model call saved — the highest-leverage next investment after this lands.
