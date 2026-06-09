# Haiku HH-relevance gate at the shared extraction chokepoint

**Date:** 2026-06-09
**Branch:** `feat/hh-relevance-classifier` (off `feat/data-anomaly-audit` @ `55699c0`)
**Status:** design approved, spec for implementation plan

## Problem

Audit render-escalation (`audit:fix --escalate-paid`) over Oakland spent **$1.09 across
~111 calls but ~62 paid calls found nothing** (~6% hit rate). Root cause: Webflow/Wix/
Squarespace serve a **200 soft-404 catch-all** for unknown URLs, so speculatively-probed
paths (and aggregator/covid/operating-hours/hotel-package pages) reach the paid model and
get extracted-then-rejected. The interim fix (commit `55699c0`) gates the paid spend with
**brittle URL/keyword heuristics** — `isDrinkOrHhPageUrl`, `scoreHhUrl`-thresholds,
`matchesHappyHour` — inside `routeEscalation`. Those rules don't generalize: a bar's
`/specials` page *can* carry a real happy hour, and "Mon–Fri 4–6pm" on an `/about` page is
just operating hours. Rolling out to **50k US restaurants needs a smart content read, not
URL rules.**

Two further problems the URL-heuristic approach can't address:

1. **It only protects the audit.** `seed:enrich` and `reextract` funnel through the same
   `runExtractModel`, hit the same soft-404 catch-alls, and pay the full extractor to read
   "nothing here" — *accumulating* the very misses the audit later has to clean up. The fix
   must catch the waste **at capture time**, before audit escalation is ever needed.
2. **URL heuristics are both over- and under-inclusive** — they pay for `/drinks` pages
   that are just a wine list, and skip a `/menu` page that lists a real happy hour.

## Goal

Replace the brittle URL/keyword **paid-vs-skip relevance decision** with a single cheap
Haiku read — *"does this page describe a recurring happy hour?"* — placed at the **one
chokepoint all three pipelines share** (`extractHappyHours`). One relevance brain for
`seed:enrich`, `reextract`, and audit escalation. Cheaper overall (kills wasted full
extractions) **and** smarter (reads content, not URLs).

### Non-goals / explicitly preserved

- **Free deterministic parse stays the $0 fast-path** — a clean, stocked HTML window is
  applied with no model call at all. Haiku only gates the "free parser found nothing — is
  it worth the paid extractor?" decision.
- **Suspect-only windows are never escalated** — the durable fix in `55699c0` (parser
  noise: Marisol's 2am–8pm, Giuseppe's lunch/dinner hours). Unchanged.
- **PDFs/images always go to the (vision) extractor** — they are *not* gated by a separate
  Haiku read (see Cost model). The extractor itself returns `[]` on a junk doc.
- **URL signals (`scoreHhUrl`) remain for candidate _selection/ordering_** in triage and
  `needsRenderEscalation`. You cannot Haiku-read every URL to decide which pages to fetch.
  The "no URL rules" mandate applies to the **paid-vs-skip spend decision** — that, and
  only that, moves to Haiku. URL signals get a page *into* the queue; Haiku decides whether
  to *spend* on it.

## Cost model (why HTML is gated but docs are not)

Billing = input tokens + output tokens.

- **HTML:** the relevance read uses a small *snippet* of page text and emits a one-word
  verdict — tiny on both sides. The extraction it gates reads the *full* page and emits
  structured windows. On a junk HTML page the snippet read **saves** the full extraction.
  `relevance_input ≪ extraction_input` → clear win.
- **PDF/image (doc):** a vision relevance read cannot snippet — it must send the *entire*
  document block, the same expensive input the extraction sends. `relevance_input ≈
  extraction_input`. On a *real* HH doc (docs are our high-hit-rate source — Oeste), gating
  pays that big doc-input **twice** (relevance + extraction) to save only a small *output*
  on the rare junk doc. Net loss. → **Docs always go straight to the extractor**; its small
  output on a junk doc is the only "waste," and it's far cheaper than re-paying doc input.

The exception that would justify doc-gating — pre-extracting a text-layer PDF to cheap
text — is not how the pipeline reads PDFs today (native document blocks) and is out of scope.

## Architecture

### New module: `lib/ai/hhRelevance.ts`

```
classifyHhRelevance(input: {
  pages: FetchedPage[];   // the fetched/rendered pages (HTML text used; docs ignored here)
  venueName: string;
}): Promise<HhRelevanceVerdict>

interface HhRelevanceVerdict {
  relevant: boolean;   // is_recurring_happy_hour
  reason: string;
  usage: Usage;
  costCents: number;
  model: string;
  promptHash: string;
}
```

- Builds a **capped, URL-labeled snippet** from the **HTML text** of `pages` (per-page cap
  + total cap, e.g. ~2k chars/page, ~6k total). Pages with no `text` (PDF/image) contribute
  nothing — they're handled by the doc fast-path, not here.
- One Haiku call, **forced tool call** `record_relevance → { is_recurring_happy_hour:
  boolean, reason: string }` (structured output, same pattern as `lib/ai/classifier.ts` /
  the extractor's `RECORD_TOOL` — avoids prose-narration truncation).
- Versioned prompt `/prompts/hh-relevance.md`; `prompt_hash` recorded
  (`lib/ai/promptHash.ts`). Usage logged to `ai_usage_ledger` with a new stage tag
  `relevance` (caller-side, consistent with classifier/verifier — the module stays
  DB-free and returns usage for the caller to persist).
- Model: `MODELS.relevance` (env `ANTHROPIC_MODEL_RELEVANCE`, default `claude-haiku-4-5`).
- **Anthropic client is injectable** (constructor/param default = the real client) so the
  hermetic test suite can mock it with no network/billing.

**Prompt intent** (judges *content*, never URLs): YES for "Mon–Fri 4–6 $5 margaritas", a
drink menu that lists happy-hour pricing, "industry night Tuesdays", a recurring
discounted-food/drink window. NO for one-time events, covid/closure notices, hotel/spa
packages, plain operating hours, an online-ordering shell with no menu, an empty about page.

### Wiring at the chokepoint: `lib/ai/extractHappyHours.ts`

Current gate order: fetch → `hasSignal` (free keyword) → free deterministic parse →
`runExtractModel` (paid). New order — `forcePaid` bypasses the **cost-optimization gates**
(the free-parse short-circuit, step 2, and the new Haiku gate, step 4) so a caller that has
already decided to spend reaches the model; `hasSignal` (step 1) behavior is unchanged from
today:

1. **`hasSignal` free pre-filter** — KEEP. `$0`; skips zero-indication pages (Toast shells,
   empty About) before we even pay for Haiku.
2. **Free deterministic parse** — KEEP. ≥1 clean stocked window → return `$0`.
3. **Doc fast-path** — any fetched page is a PDF/image → straight to `runExtractModel`
   (docs always extract; see Cost model).
4. **NEW Haiku relevance gate (HTML-only)** — reached only for HTML that tripped the signal
   gate but the free parser couldn't cleanly extract. Call `classifyHhRelevance(pages)`.
   `relevant=false` → return the EMPTY result at `$0` (skip the paid model);
   `relevant=true` → `runExtractModel`.

> Note: step 2's free-first short-circuit means a venue whose HTML already yields a clean
> stocked window is applied at `$0` and we don't read its linked doc — unchanged existing
> policy, not a regression introduced here.

Persist the relevance call's usage to `ai_usage_ledger` at the chokepoint's caller the same
way extractor usage is recorded today.

### Audit: one shared brain, heuristics removed (`lib/audit/renderEscalation.ts`, `scripts/audit-fix.ts`)

`routeEscalation` stays a **pure** function (hermetically tested, no AI) but its final
*relevance* branch (`hhDoc || hhText || isDrinkOrHhPageUrl(hhPageUrl)`) is replaced by a new
route value **`"relevance-check"`**. Structural verdicts are unchanged:

- `skip` — no usable page content.
- `free` — clean non-suspect window with ≥1 offering.
- `paid` — any page is a PDF/image (doc), **or** a clean-but-thin (no-offering) window.
- `relevance-check` — *(new)* HTML with no clean window and no doc: the async caller
  (`fetchAndRoute` / `extractAndDiff`) resolves it by calling the **same**
  `classifyHhRelevance` on the rendered HTML → `paid` (relevant) or `skip` (not). This keeps
  the AI call in exactly one module while preserving the pure-core unit tests.

Then **delete** `isDrinkOrHhPageUrl` (`lib/places/hhText.ts`) and the `hhPageUrl` /
`scoreHhUrl`-relevance plumbing that only fed the removed branch in `routeEscalation` /
`fetchAndRoute`. `scoreHhUrl` itself **stays** (triage ordering + `needsRenderEscalation`
candidate selection — that's selection, not the spend decision).

### Free pre-filter review (explicit operator ask)

Audit `pagesHaveExtractableSignal` (`lib/ai/siteContent.ts`, → `hasHhOrDealSignal`) against
the empty-page classes the operator named — **Toast/Clover online-ordering shells, empty
About pages, no-menu-link homepages**. Build a fixture set from real samples and assert
`pagesHaveExtractableSignal` returns `false` (skip-free) for them.

Expected finding: the truly-empty cases already fall through free; the leak is the
permissive `DEAL_RE` ("daily"/"specials" in boilerplate/footers), which is now **acceptable**
— Haiku absorbs those false-positives for a fraction of a cent rather than us over-tightening
the regex and risking dropping a real HH. Document the finding either way.

**Optional hardening (operator deferred to the review):** detect a page that is a dominant
online-ordering embed (`toasttab.com` / `clover` / `order.*` iframe/script) carrying
negligible real text and treat it as no-signal → skip free, saving even the Haiku penny.
Ship **only** if the fixtures show it's safe (no real-HH false negatives); otherwise leave
the free gate permissive and let Haiku be the backstop.

## Data flow

```
seed:enrich / reextract           audit:fix --escalate-paid
        │                                  │
        ▼                                  ▼
  extractHappyHours()              needsRenderEscalation()  ── confirmed-only, scoreHhUrl SELECTION
        │                                  │ (which venues to consider — unchanged)
  1 hasSignal  ─ no ─▶ $0 skip             ▼
  2 free parse ─ hit ─▶ $0 apply     fetchAndRoute(): triage → render → free-parse
  3 doc?       ─ yes ─▶ runExtractModel    │
  4 Haiku relevance ◀──────────────  routeEscalation() (pure)
        │  relevant?                       │  → free / paid / skip / relevance-check
   no ─▶ $0 skip                           ▼
   yes ─▶ runExtractModel            relevance-check ─▶ classifyHhRelevance() ─▶ paid | skip
                                                              ▲
                       ONE shared relevance brain ───────────┘
```

## Error handling

- **Haiku call fails** (network / API / malformed tool call after retries): **fail toward
  the paid extractor** (treat as `relevant=true`). The relevance gate is a *cost optimizer*,
  not a correctness gate — never drop a potential real HH because the cheap classifier
  errored. Log the failure; cost is bounded by the existing budget gate.
- **Empty/again-unfetchable pages:** `hasSignal`/`skip` already handle this upstream; the
  classifier is only called with usable HTML text present.
- **Budget:** the relevance call is itself budget-aware via the same ledger; if the month
  cap is hit, behavior matches today (extractor budget gate decides).

## Testing

**Hermetic (added to the existing `test:*` CI suite — no network, no billing):**

- `classifyHhRelevance` with a **mocked** Anthropic client: covid notice / operating hours /
  hotel package → `relevant=false`; "Mon–Fri 4–6 $5 margaritas" / drink menu with HH pricing
  → `relevant=true`; snippet builder caps length and labels by URL; tool-call parse + a
  malformed-response → fail-open (`relevant=true`).
- `pagesHaveExtractableSignal` empty-page fixtures (Toast shell, empty About, no-menu
  homepage) → `false`.
- Updated **pure** `routeEscalation` tests: `relevance-check` route replaces the removed
  `isDrinkOrHhPageUrl`/`hhText` assertions; `free`/`paid`/`skip`/doc cases unchanged.
- `extractHappyHours` gate-order test (mocked client + fixture pages): doc → extractor;
  HTML-irrelevant → `$0` skip; HTML-relevant → extractor; `forcePaid` bypasses the gate.

**Live validation ($0 estimates / preview, run by operator or with explicit go-ahead):**

- **Five Cities:** Giuseppe's (covid) + Marisol (hotel packages) → **skip**; Mason
  (cocktails) + Zorro's (drinks image) → **check**. Estimates are $0.
- **Oakland:** alaMar / Oeste still recover (compare against the cached
  `docs/audit-escalation/oakland-2026-06-09.json`).

## Files touched

| File | Change |
|---|---|
| `lib/ai/hhRelevance.ts` | **new** — Haiku relevance classifier (injectable client) |
| `prompts/hh-relevance.md` | **new** — versioned relevance prompt |
| `lib/ai/models.ts` | add `relevance` model id (env-overridable) |
| `lib/ai/extractHappyHours.ts` | insert doc fast-path + Haiku gate before `runExtractModel`; record relevance usage |
| `lib/audit/renderEscalation.ts` | `routeEscalation` → add `relevance-check`; drop `isDrinkOrHhPageUrl`/`hhText`/`hhPageUrl` relevance branch |
| `scripts/audit-fix.ts` | resolve `relevance-check` via `classifyHhRelevance` in the async caller |
| `lib/places/hhText.ts` | delete `isDrinkOrHhPageUrl` |
| `lib/ai/siteContent.ts` | (review; optional online-ordering-shell hardening) |
| `scripts/test-render-escalation.ts`, `scripts/test-hh-text.ts`, new `scripts/test-hh-relevance.ts` | tests |

## Rollout / sequencing

1. Build + unit-test the classifier and the chokepoint gate (hermetic, $0).
2. Run the free pre-filter review; decide on the optional hardening.
3. Live-validate on Five Cities ($0 estimate) + Oakland preview.
4. This work bundles onto the already-large `feat/data-anomaly-audit` stack — at PR time,
   split per the Branch & PR workflow rules.
