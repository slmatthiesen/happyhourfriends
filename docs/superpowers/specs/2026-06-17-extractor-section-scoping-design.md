# Extractor section-scoping — design

**Date:** 2026-06-17
**Status:** approved design, pre-implementation
**Branch:** `feat/extractor-section-scoping`

## Problem

The HH extractor over-captures offerings that do not belong to the happy-hour
section, and in some cases fabricates whole windows from non-HH page content. Three
live Santa Barbara / Tacoma venues surfaced it on `/admin/reviews`:

- **Alcazar Tapas Bar** (`alcazartapasbar.com/menu-1-2`) — one *legitimate* window
  (Mon–Fri 4:30–6pm), but the stored offerings are the **Signature Cocktails** ($17,
  a section listed *above* the HH block), the **$40 bottle** sangria, and a junk `$11
  Location` row from the footer. The page's actual HH items (Heat of Passion $14, Herb
  Your Enthusiasm $14, Alcazar Sangria $12, House Red/White $13, Sparkling Cava $12)
  were **mostly missed**.
- **The Black Sheep Restaurant + Bar** (`blacksheepsb.com/happyhour-menu`) — the real HH
  window (Wed–Fri 5–6pm) stored only `$10 Select Cocktails` / `$10 Martinis`, missing
  the rest. A **bogus second window (9am–1pm, sourced from the homepage)** holds `$55
  Endless Moules Frites`, `$55 Saturday Brunch`, and the `$41 Happy Hour Prix Fixe`.
  Ground truth: the $41 prix-fixe is real HH (on the HH page, 5–6pm); the $55 items are
  homepage marketing; the 9am–1pm figure is the venue's operating hours from the footer.
- **State Street** (Tacoma, `statestreetbeer.com/menu`) — `$1 off Pints` is correct;
  `$15 discount per bottle will…` is a truncated bottle-purchase sentence, not HH.

## Root cause

`lib/verification/fetchUrl.ts` → `stripHtml()` removes **all** tags
(`text.replace(/<[^>]+>/g, " ")`) and then collapses every whitespace run to a single
space. Section headings (`<h2>Happy Hour 4:30–6pm</h2>`, `<h2>Signature
Cocktails</h2>`) become bare inline text indistinguishable from body copy. The model
receives **one flat token stream with no section boundaries**, so it cannot tell which
priced items sit under the HH heading versus the cocktail menu, the footer, or homepage
marketing. The prompt's v16 "an item belongs to the heading ABOVE it" rule is fighting
blind because the headings no longer exist by the time the model sees the text.

This is a **capture/scoping** failure, not a price-filtering problem. A post-hoc price
gate would paper over it and could not recover the real items we missed.

## Approach (chosen: A)

Restore the section signal the model needs, then teach the prompt to use it, and lock
both with $0 golden fixtures.

Rejected alternatives:
- **B — prompt-only:** ineffective; the section boundaries aren't in the model's input.
- **C — post-hoc offering price/name gate:** operator rejected ("not a price
  exercise"); cannot recover missed items; papers over the capture bug. A thin
  window-level backstop for operating-hours-shaped windows may be considered later but is
  out of scope here.

## Components

### 1. `stripHtml` structure preservation

Before tag-stripping, map block/structural tags to newline + heading markers so section
structure survives:

- `<h1>`–`<h6>` → newline + `## ` + heading text + newline
- `<br>` → newline
- closing `</li>`, `</p>`, `</tr>`, `</div>`, `</section>` (block boundaries) → newline

Then strip remaining tags as today. **Stop collapsing newlines** in the whitespace step
(collapse spaces/tabs and runs of blank lines, but preserve single line breaks). The
budget-trim windowing (step 5), `harvestScriptText`, and `harvestJsonLdMenu` continue to
operate on the resulting text unchanged — windowing is offset-based and newline-agnostic.

Output shape the model will see:

```
## Signature Cocktails
Salty Bird $17
...
## Happy Hour 4:30-6pm
Heat of Passion $14
Alcazar Sangria $12
...
## Location
1812 Cliff Dr ...
```

Payload size grows modestly (newlines + `## `); within the existing `MAX_CONTENT`
budget. This touches **all** extraction — golden tests guard against regressions.

### 2. Prompt v20 — section scoping

Add a rule to `prompts/seed-extract-hh.md`:

- Record offerings only when they appear **within / under a happy-hour section or
  heading**. The `## ` markers delimit sections.
- Explicitly ignore, even when priced and on the same page: full drink/food menus not
  under an HH heading; glass-vs-bottle / bottle-service pricing; footer or
  operating-hours text; homepage feature-marketing (brunch, weekly specials, signature
  cocktails) that is not part of the HH offering list.
- A happy-hour **window** must be anchored to stated HH day/time text near the
  offerings — never manufactured from operating hours or marketing copy.
- Keep all existing rules (WINDOW-IS-ENOUGH, THIS-LOCATION-ONLY, day-heading
  association, etc.). Section scoping refines *which offerings* attach to a window; it
  does not weaken the "a bare window is still recordable" rule.

Bump the version header and pin the new `prompt_hash` (existing mechanism).

### 3. Golden fixtures + tests

Saved HTML fixtures (committed) from the offending pages. Two tiers, because true $0
tests can only cover the deterministic transform — the model's keep/drop behavior costs
a call unless snapshotted.

**Tier 1 — deterministic `stripHtml` goldens ($0, primary gate).** Assert the fixture
text, after `stripHtml`, carries the section markers in order — e.g. Alcazar emits a
`## Signature Cocktails` section BEFORE a separate `## Happy Hour 4:30-6pm` section, and
the footer `Location` is not inside the HH section; Black Sheep's HH page text is
distinct from the homepage's brunch/operating-hours copy. This proves the *enabler* (the
section signal now reaches the model). The over-stripping worry is partly covered here:
assert the real HH items still appear in the HH section after stripping.

**Tier 2 — model keep/drop behavior.** Validated by the live 3-venue re-extract
(component 4, ~$0.10) and, optionally, one recorded-response snapshot per fixture so the
keep/drop assertions can re-run at $0 thereafter:
- **Precision (drop):** Alcazar must NOT yield `$40` sangria, `$17` Signature Cocktails,
  or `$11 Location`; Black Sheep must NOT yield `$55` brunch/moules or a 9am–1pm window;
  State Street must NOT yield the `$15 …per bottle will` row.
- **Recall (keep/recover) — guards over-stripping:** Alcazar SHOULD capture Heat of
  Passion / Alcazar Sangria / House wines / Cava; Black Sheep SHOULD capture the $41
  prix-fixe + real 5–6pm items on the correct window; State Street SHOULD keep `$1 off
  Pints`.

Note: State Street ground truth is operator-provided; fetch and inspect
`statestreetbeer.com/menu` during implementation to build its fixture accurately.

### 4. Apply to live data — 3 venues only

Re-extract the three muddied venues from their correct first-party HH URLs via
`resolveVenue` (the one persist path), then `regate`:

- Alcazar Tapas Bar — `b7f3e2df-ec6d-4335-92ab-e349f4068a48`
- The Black Sheep Restaurant + Bar — `a45897e3-f7da-45df-aca8-b6785d5f8195`
- State Street (Tacoma) — `1c094098-dad8-4bc6-9fea-af5f55a98c5b`

Operator eyeballs the resulting rows before trusting the change. Soft-delete (not hard
delete) supersedes the bad windows/offerings via the normal reconcile path.

## Out of scope / future

- **Broader Santa Barbara re-extract** to catch other muddied venues — separate cost
  decision, run after this lands if the 3-venue result looks right.
- **Per-venue data-sanity pass** (operator idea, 2026-06-17): a check that reviews each
  venue's stored HH data for "does this make sense" and re-runs extraction when a venue
  looks odd. Future enhancement; not built here.
- **Window-level operating-hours backstop** in `realnessGate` (catch a 9am–1pm
  homepage-sourced window even if the extractor regresses) — optional later hardening.

## Testing

- Tier-1 deterministic `stripHtml` goldens (component 3) — primary acceptance gate, $0.
- Existing extractor + `stripHtml` + window-reconcile suites must stay green
  (regression guard for the all-extraction `stripHtml` change).
- Tier-2 keep/drop: one live re-extract of the 3 venues (~$0.10) as the real-world
  confirmation; optional recorded-response snapshots to re-run keep/drop at $0.

## Error handling / rollback

- Prompt is content-hash-pinned and versioned; revert = restore prior version.
- `stripHtml` change is guarded by goldens + existing suites; revert = git.
- Live data uses soft-delete via the canonical persist path; operator deletes are never
  resurrected.
