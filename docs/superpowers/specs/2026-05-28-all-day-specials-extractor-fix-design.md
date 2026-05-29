# All-day weekday specials — extractor fix

**Status:** Approved (2026-05-28)
**Branch:** `cluster-schema-seed-pipeline`
**Related memory:** `[[project_extractor_misses_all_day_specials]]`

## Problem

The seed extractor (`lib/ai/extractHappyHours.ts`, prompt `prompts/seed-extract-hh.md`) silently drops recurring weekday-labeled all-day specials (e.g. The Red Hot Tacoma: "Monday: $1 off all burgers, $2 HeidelBERG mugs, all damn day"). Verified end-to-end: the content is in plain text on the venue's website; the extractor returned 0 windows / confidence 0.00 on two clean runs.

Root cause is structural, confirmed by code reading (no fabrication):

- `extractHappyHours.ts:142` — `RECORD_TOOL` schema declares `startTime: { type: "string" }` and marks it as `required`. There is no legal way for the model to emit a window without a start time.
- `prompts/seed-extract-hh.md:25-26` — prompt explicitly forbids fabricating times ("Do NOT extrapolate from partial information. If the page says 'Mon–Fri' but gives no times, do NOT fabricate times.").

Faced with content like "Monday all damn day," the model's only compliant move is to omit the window. The result is a venue that publishes recurring deals in plain text becomes a stub.

This affects every city, not just Tacoma. Common patterns hitting the same wall:
- Dive-bar all-day weekday deals ("$2 Tuesday tallboys")
- Brewery/gastropub "industry night" (no times)
- Sunday brunch bottomless mimosas (listed by day only)
- Late-night day specials ("Friday late-night $5 wings")

Tacoma's lower enrich yield versus Phoenix may be partly attributable to this — Tacoma small businesses lean toward day-special framing; Phoenix venues tend to publish classic time-windowed HH.

## Goal

Let the extractor capture and persist weekday-labeled all-day specials, treated as the same product unit as time-windowed happy hours (per operator decision), displayed as "Open to close."

## Approach: B (sentinel)

Three options considered:

- **A** — Migration to make `happy_hours.start_time` nullable; store as `(null, null, days)`.
- **B** — Reuse an internal sentinel `('00:00', null, days)`. **Selected.**
- **C** — Add a new column (`all_day boolean` or `kind` enum) on `happy_hours`.

B chosen because:
- No DB migration → lowest risk, fastest to ship.
- `isWindowActive` (lib/geo/timezone.ts) already evaluates `start=0, end=null→1440` as active throughout the day on listed days. No change required.
- The conflation risk (a venue that legitimately opens at midnight with an HH running until close) is effectively nonexistent in practice. Operator confirmed: "No venue legitimately opens at midnight with an HH running until close. That won't happen."
- Forward path to A or C remains open as a normaliser-only change if the conflation ever bites.

## Pipeline by layer

| Layer | Representation | Notes |
|---|---|---|
| **Model output** (tool input) | `startTime: null, endTime: null` | Clean semantic — "no time window." Keeps the model's mental model clean and makes a future migration to A or C cheap. |
| **Tool schema** (`RECORD_TOOL`) | `startTime: { type: ["string", "null"] }`, removed from `required[]` | Allows the null emission. `endTime` already nullable. |
| **Prompt** (`prompts/seed-extract-hh.md`) | Adds explicit "all-day / weekly specials" rule | See "Prompt change" below. Prompt version bumps (v5 → v6); content hash rolls into `ai_usage_ledger.prompt_hash`. |
| **Normaliser** (`normaliseHappyHour`) | translates `null/null` → `'00:00', null` sentinel before return | Single mapping point. **Edge case:** if raw `startTime` is null but `endTime` is non-null → row is malformed (partial window); drop with a one-line `console.warn` for the run log. |
| **DB** (`happy_hours`) | `start_time='00:00', end_time=null, days_of_week=[...]` | **No migration.** Existing CHECK constraints and the `crosses_midnight` generated column are satisfied (`end_time < start_time` → null → `crosses_midnight=null`). |
| **`isWindowActive`** (lib/geo/timezone.ts) | unchanged | Sentinel naturally evaluates as always-on for the listed days. |
| **Apply engine** (`lib/apply/engine.ts`) | unchanged | `HAPPY_HOUR_FIELDS` column allowlist already includes `start_time` and `end_time`; values written are valid clock times / null per the existing rules. |
| **Display** | new `formatWindow(start, end)` helper | When `(start, end) == ('00:00', null)` → returns `"Open to close"`. Otherwise → `${formatTime(start)} – ${formatTime(end)}`. |

## Prompt change

Add to `prompts/seed-extract-hh.md` under "Field rules" or as a new "ALL-DAY SPECIALS" sub-section:

> **All-day / weekly specials count.** If a venue lists a recurring discounted offer by day with no time window (e.g. "Monday: $2 burgers all damn day", "Industry Sunday: $5 wells"), record it with `startTime: null` and `endTime: null` — that means "applies whenever the venue is open on those days." These ARE the kind of recurring deal we want; do not skip them. Do NOT invent `"00:00"` or any other time to fill the field; `null` is the correct value when no time window is given.

Also lightly broaden the system framing — replace "happy-hour schedules" with "recurring discounted offers (happy hours, daily specials, weekly deals)" — so the model doesn't anchor on the "happy hour" label and miss day-special framing.

Bump prompt version (frontmatter `version: 5` → `6`) with notes describing the all-day clause.

## Display surfaces

Exactly four call sites today (all use the same `formatTime` helper):

- `components/venue-table-client.tsx:559-560` (table body — start/end columns)
- `components/venue-table-client.tsx:665,667` (mobile card layout)
- `app/[city]/venue/[slug]/page.tsx:220` (venue detail page user-facing row)
- `app/[city]/venue/[slug]/page.tsx:92-93` (JSON-LD `Schedule` block: emits `startTime`/`endTime` from `h.startTime`/`h.endTime`)

Add `formatWindow(start: string, end: string | null): string` to `lib/format.ts`. Update the three user-facing call sites to use it. The existing `formatTime` stays for any single-time use.

For JSON-LD: when `(start, end) == ('00:00', null)`, **omit both `startTime` and `endTime` fields** from the `Schedule` block — keep `byDay` and other fields. Both are optional in schema.org `Schedule`; emitting `"00:00"` would be semantically wrong (search engines would render it as "starts at midnight"). Concretely change `page.tsx:92-93` from unconditional emission to a guarded spread: `...(isAllDay(h) ? {} : { startTime: h.startTime.slice(0,5), ...(h.endTime ? { endTime: h.endTime.slice(0,5) } : {}) })`.

## Edge cases & explicitly out of scope

- **Rotating limited-quantity specials** (Red Hot Thursday "Test Kitchen Special, open to sellout") — out of scope. Different shape; needs its own discussion later.
- **Open-hours awareness** in `isWindowActive` (a venue's actual closing time) — out of scope. Pre-existing approximation; the sentinel inherits the same behavior as "until close."
- **Discovery-gate bug** that let Tides Tavern (cross-bridge Gig Harbor venue) through — separate latent issue, tracked in CLAUDE.md.
- **Pulsing circle + clock** UI polish — addressed in a separate design pass.

## Testing / validation

After implementation:

1. Reset The Red Hot's candidate row:
   ```sql
   UPDATE seed_candidates SET processed_at=NULL, outcome=NULL
   WHERE id='bdb4572a-1c69-4ff6-8ba8-43fc19298cd9';
   ```
2. Re-run `npm run seed:enrich -- --city tacoma --limit 1` (≈6¢ spend).
3. **Pass criteria:** ≥3 windows confirmed (M/Tue/Wed at minimum), all stored with `start_time='00:00', end_time=null`. The venue page `/tacoma/venue/the-red-hot` renders "Open to close" — not "12 AM – close" — for each window.
4. Spot-check 1–2 existing Tacoma stubs that look like the same pattern (E9 Firehouse, Doyle's Public House) — re-run them and see if any recover.

Also: `tsc --noEmit`, `eslint`, `next build` clean (modulo the two pre-existing Phase 0 lint issues documented in CLAUDE.md).

## Files touched

- `lib/ai/extractHappyHours.ts` — tool schema (`startTime` nullable + drop from `required`); `normaliseHappyHour` translates null/null → sentinel; drop rows with null `startTime` and non-null `endTime`.
- `prompts/seed-extract-hh.md` — version bump, new "ALL-DAY SPECIALS" clause, light framing tweak.
- `lib/format.ts` — new `formatWindow(start, end)` helper.
- `components/venue-table-client.tsx` — replace `formatTime(b.start) – formatTime(b.end)` patterns with `formatWindow(b.start, b.end)` at the 4 sites.
- `app/[city]/venue/[slug]/page.tsx` — replace at the table site + JSON-LD.
- No DB migration.
- No script changes.

## Risks

- **Prompt change might miss other patterns.** Mitigation: the new clause is additive and explicit; existing time-windowed extraction is untouched.
- **Display sentinel detection could be miscoded** (e.g. matching `start='00:00:00'` instead of `'00:00'`). Mitigation: be explicit about the string form returned by the DB driver in the helper; add a small unit test if convenient, otherwise verify by Red Hot smoke test.
- **Future migration to A becomes lock-in.** Mitigation: model emits clean null/null and only the normaliser maps to sentinel. Migrating to A means changing the normaliser output and the display helper — bounded, not painful.
