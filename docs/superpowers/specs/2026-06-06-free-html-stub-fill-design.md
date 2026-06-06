# Free HTML-only stub fill + paid escalation — design

**Date:** 2026-06-06
**Status:** approved (brainstorm), pre-implementation
**Related:** PR #39 (script-JSON harvest + sitemap discovery), memories `project_hh-signal-gate`,
`project_hh_free_recovery_plan`, `feedback_assume_mon_fri_when_no_days`,
`feedback_verify_cost_before_claiming_free`, `capture-everything-realness-filter`.

## Problem

Many venues publish their happy hour **directly on their own site**, yet sit as stubs. PR #39
made the pipeline *reach* and *read* that text for free (plain HTTP + `<script>`-JSON harvest +
sitemap discovery), but the step that turns `"Happy Hour: 3pm-7pm daily"` into a structured
`{daysOfWeek, startTime, endTime}` row is currently done by the **paid** Claude extractor.

We want a **deterministic, $0 parser** that structures the clean cases, so we:
1. Fill existing stubs we can patch from HTML alone — no Anthropic API.
2. Escalate only the genuinely-needs-interpretation high-signal pages to the paid extractor.
3. Apply the same free-first gate to **new discovery**, so we never pay to extract a HH we
   could have read deterministically.

## Non-goals

- NLP/ML parsing. The parser is conservative regex/rules; ambiguous text **escalates**, never
  guesses (PRD §13: never fabricate).
- Replacing the paid extractor. It remains the path for messy menus, PDFs/images, and
  `web_search` (no-site) cases.
- Headless rendering in the free path. Plain HTTP only (PR #39's harvest already recovers most
  Wix/dashtrack/Square sites); keep it fast and browser-free at discovery scale.
- UI work on `/admin/stubs` (the Auto-retry button stays the paid escalation; wiring the free
  parser into it is a possible later follow-up, out of scope here).

## Architecture

Three consumers, one shared pure parser, the existing audited persist path.

```
                         ┌─────────────────────────────┐
                         │ lib/places/parseHhText.ts    │  PURE, unit-tested
                         │ parseHappyHours(text, url)    │  → ParsedWindow[] (clean|fuzzy)
                         └─────────────┬───────────────┘
            ┌──────────────────────────┼───────────────────────────┐
            ▼                          ▼                            ▼
  reextract:stubs:free        seed:enrich (batch +          (later, optional)
  (sweep existing stubs)       on-demand) free fast-path     admin Auto-retry
            │                          │
            ▼                          ▼
   persistExtractedWindows  ←──────────┘   (lib/recover/resolveVenue.ts — the ONE write path:
   (cost 0 ExtractResult)                   ledger → realness gate → insert → audit → promote)
```

### Component 1 — `lib/places/parseHhText.ts` (pure parser; correctness lives here)

```ts
export interface ParsedOffering {
  kind: "food" | "drink" | "other";
  category: string;            // beer|wine|cocktail|spirit|appetizer|entree|dessert|other
  name: string;                // the matched substring, e.g. "$1 off menu cocktails"
  priceCents?: number;
  discountCents?: number;
  sourceUrl: string;
}
export interface ParsedWindow {
  daysOfWeek: number[];        // ISO 1=Mon..7=Sun, non-empty
  allDay: boolean;
  startTime: string | null;    // "HH:MM" | null ("open"/until-close start unknown)
  endTime: string | null;      // "HH:MM" | null ("until close")
  timeKnown: boolean;
  locationWithinVenue: "all";
  notes: string | null;        // flags assumptions, e.g. "days assumed Mon–Fri (none stated)"
  offerings: ParsedOffering[];
  confidence: "clean" | "fuzzy";
  evidence: string;            // the verbatim source snippet the window came from
  sourceUrl: string;
}
export function parseHappyHours(text: string, sourceUrl: string): ParsedWindow[];
```

**Day parsing:** `daily`/`every day` → `[1..7]`; `mon-fri`, `monday through friday`,
`weekdays` → `[1..5]`; `weekends`, `sat & sun` → `[6,7]`; explicit single days and lists
(`mon, wed, fri`); ranges (`tue–thu`). **Time stated but no days → `[1..5]` (Mon–Fri)** per
`feedback_assume_mon_fri_when_no_days`, recorded in `notes`.

**Time parsing:** `3pm-7pm`, `3 - 7 pm`, `3:30pm–6pm`, `11pm-2am` (cross-midnight, end < start —
schema's generated `crosses_midnight` handles it), `9pm-close`/`til close`/`until close`
→ `endTime=null`, `open-6pm`/`opening-6pm` → `startTime=null`. **am/pm inference** only under
happy-hour context and only for plausible HH hours (e.g. `3-7` with "happy hour" nearby → pm);
otherwise the window is `fuzzy`.

**Offering parsing (clearly-attached only):** within the same snippet/line as a window, match
`$N`, `$N off`, `half[- ]price`, `$N <noun>` where noun ∈ drink/food category words
(draft, beer, wine, cocktail, well, spirit, appetizer, …). Map to `ParsedOffering`. Offerings
never gate confidence — a window with a clean time but no parseable deal is still `clean`.

**Confidence:** `clean` iff `happy hour` (HH_RE) **or** a strong deal phrase is present in the
snippet **AND** days resolved **AND** startTime parsed **AND** (endTime parsed or explicit
close). Everything else → `fuzzy`.

**Multiple windows** per page are supported (Philly's: 3–7 + 11pm–2am; Side Pony: 3–6 + 9–close).

### Component 2 — `scripts/reextract-stubs-free.ts` → npm `reextract:stubs:free`

The `$0` sibling of `reextract:stubs`. One pass over stubs:

1. Query stubs exactly like `/admin/stubs`: `data_completeness='stub'`, `status='active'`,
   `deleted_at IS NULL`, website present (`venues.website_url` or `seed_candidates.website_url`).
   Filters: `--city <slug>`, `--limit N`.
2. Per stub: `triageSite` (sitemap-aware) → if `action==='extract'`, `fetchPages` of
   `[websiteUrl, ...priorityUrls]` with **`render` omitted** (plain HTTP only).
3. Run `parseHappyHours` over each fetched page's text (post-`stripHtml`, which now includes the
   script-JSON harvest).
4. Route:
   - **≥1 `clean` window** → build a cost-0 `ExtractResult` (`model: "deterministic-html-v1"`,
     `usage: {0,0}`, `costCents: 0`, `promptHash: <parser-version hash>`, `confidence: 1`) →
     `persistExtractedWindows` (only under `--apply`). Counts as filled.
   - **HH signal (`hasHhOrDealSignal`) but no clean window** → append to escalation shortlist.
   - **no signal** → leave as stub.
5. Output:
   - Escalation shortlist → `docs/hh-escalation-<YYYY-MM-DD>.json`:
     `[{ venueId, name, citySlug, url, snippet }]`, plus a printed `reextract:stubs --venue <id>`
     hint block.
   - Summary line: `filled F · escalated E · no-signal N · skipped S`.
6. **Dry-run by default** (prints the windows it *would* write, like `apply-harvest.ts`);
   `--apply` performs the writes.

### Component 3 — `seed:enrich` free fast-path (the discovery integration)

`buildExtractRequest` already fetches the pages and computes `hasSignal`. Change it to **also
return the fetched page text** (e.g. `pages: FetchedPage[]` or `fetchedText: string`) so callers
can parse without re-fetching. Then in `scripts/seed-enrich-candidates.ts`, at the existing gate
(batch path ~line 1051; mirror in the on-demand path ~line 569), the decision becomes:

```
if (!built.hasSignal)                          → stub, $0            (exists today)
else if (parseHappyHours(text) has ≥1 clean)   → persist free, $0    (NEW — skip paid)
else                                           → paid extractor      (exists today)
```

A clean free parse **skips** the paid call entirely. Fuzzy/unparseable still pays. The cost-0
`ExtractResult` flows through the same `persistExtraction`/`persistExtractedWindows` path used by
the paid result, so realness gate + audit + promote behave identically.

## Data flow (one stub)

```
stub(+site) → triageSite(sitemap) → fetchPages(plain HTTP, +script-JSON harvest)
            → parseHappyHours(text,url)
              ├─ clean   → ExtractResult(cost 0) → persistExtractedWindows → audited, promoted
              ├─ fuzzy/signal → escalation shortlist  (Tier-2: paid reextract / Auto-retry)
              └─ no signal → stays a stub
```

## Safety / correctness

- **Dry-run by default** on the batch sweep; `--apply` writes.
- **PRD §13:** parser only emits values that appear verbatim; `evidence` carries the source
  snippet; `notes` flags the Mon–Fri-when-unstated assumption.
- **Realness gate** (`assessRealness`) still hides suspect windows (`active=false`) — defense in
  depth against a bad parse.
- **Audit/revert** via the engine's `audit_log` write inside `persistExtractedWindows`.
- **Negative tests:** ambiguous strings (`"happy hour all day"` with no time, `"see our specials"`,
  a bare `"3-7"` with no HH context) must produce **0 clean** windows (escalate, never write).

## Testing

- `scripts/test-parse-hh-text.ts` — runnable assert suite (repo convention):
  - **Positives (clean):** `"Happy Hour: 3pm-7pm daily"` → `[1..7] 15:00–19:00`;
    `"Mon–Fri 3pm–6pm"` → `[1..5]`; `"11pm-2am"` cross-midnight; `"9pm-Close"` → `end null`;
    `"$1 off menu cocktails"` adjacent → offering; time-no-days → `[1..5]` + note.
  - **Negatives (must NOT be clean):** no-time HH text; `"3-7"` with no HH context; pure
    marketing ("best happy hour in town") with no time.
  - Cross-midnight + multi-window pages.
- Integration check: a **free dry-run** of `reextract:stubs:free --city scottsdale --limit 30`
  (no API, no writes) — eyeball filled vs escalated.
- `pnpm run typecheck`, eslint on changed files, `pnpm run build`.

## Rollout

1. Land parser + tests + batch script (dry-run) behind a PR.
2. Operator runs a free dry-run on a city, eyeballs results, then `--apply`.
3. Wire the enrich fast-path; verify on a small `seed:enrich --limit` against a city with known
   clean-HH venues that the parser should now catch for free.
