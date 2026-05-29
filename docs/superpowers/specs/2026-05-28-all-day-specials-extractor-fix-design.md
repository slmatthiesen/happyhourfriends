# All-day weekday specials — extractor fix

**Status:** Approved (revised 2026-05-29)
**Branch:** `cluster-schema-seed-pipeline`
**Related memory:** `[[project_extractor_misses_all_day_specials]]`

## Problem

The seed extractor (`lib/ai/extractHappyHours.ts`, prompt `prompts/seed-extract-hh.md`) silently drops recurring weekday-labeled all-day specials (e.g. The Red Hot Tacoma: "Monday: $1 off all burgers, $2 HeidelBERG mugs, all damn day"). Verified end-to-end: the content is in plain text on the venue's website; the extractor returned 0 windows / confidence 0.00 on two clean runs.

Root cause is structural, confirmed by code reading:

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

## Approach: explicit `all_day` flag

A simpler sentinel approach (`start='00:00', end=null` interpreted as "all day") was considered and rejected. The operator's concern was that sentinel conflated two distinct states — "deal is explicitly all-day" and "we couldn't find times" — making raw DB rows ambiguous and the system susceptible to silent misinterpretation. The data model itself should express intent.

Selected approach: add an explicit `all_day` boolean column on `happy_hours`, with a CHECK constraint enforcing legal shapes only. Model emits `allDay: true` as a positive assertion ("this deal runs the full open hours on these days"), not as a missing-data fallback.

## Legal row shapes

The CHECK constraint enforces exactly three valid combinations:

| `all_day` | `start_time` | `end_time` | Meaning |
|---|---|---|---|
| `true` | NULL | NULL | "Open to close" — explicit all-day deal |
| `false` | `'HH:MM'` | `'HH:MM'` | Time-windowed HH (e.g. 3–6pm) |
| `false` | `'HH:MM'` | NULL | "Until close" — start given, runs until venue closes |

No other combination is allowed. A row where `all_day=false` AND `start_time IS NULL` is invalid (incomplete window — should never be written; normaliser drops it).

## Pipeline by layer

| Layer | Representation | Notes |
|---|---|---|
| **Model output** (tool input) | `allDay: true` + `startTime: null, endTime: null` for all-day; otherwise existing string times | Tool schema adds `allDay: boolean` (default false); `startTime` becomes `["string","null"]` and is removed from `required[]`. |
| **Prompt** (`prompts/seed-extract-hh.md`) | New "ALL-DAY DEALS" clause, plus a light framing tweak | See "Prompt change" below. Prompt version bumps (v5 → v6); content hash rolls into `ai_usage_ledger.prompt_hash`. |
| **Normaliser** (`normaliseHappyHour`) | maps model output → DB shape | If `raw.allDay === true` → return `{ allDay: true, startTime: null, endTime: null, ... }`. If `raw.allDay === false` (or absent) AND `raw.startTime` is null → drop the row (malformed). Otherwise → existing path. |
| **DB migration** (`db/migrations/0006_…`) | adds `all_day` column + nullability + CHECK | See "Migration" below. |
| **Apply engine** (`lib/apply/engine.ts`) | `HAPPY_HOUR_FIELDS` allowlist gains `all_day` | Otherwise unchanged — the engine writes whatever fields the row carries; CHECK constraint enforces legal shapes. |
| **`isWindowActive`** (`lib/geo/timezone.ts`) | new short branch | If `w.allDay && w.daysOfWeek.includes(now.dayOfWeek)` → true. Else existing time-window logic. Signature: extend `HappyHourWindow` with `allDay: boolean`. |
| **Display** | new `formatWindow(window)` helper | If `window.allDay` → returns `"Open to close"`. Else → `${formatTime(start)} – ${formatTime(end)}`. |

## Migration

New migration `db/migrations/0006_all_day_happy_hours.sql` (numbering follows the existing 0004/0005 cluster-schema migrations; verify next sequence number when generating):

```sql
ALTER TABLE happy_hours
  ADD COLUMN all_day boolean NOT NULL DEFAULT false;

ALTER TABLE happy_hours
  ALTER COLUMN start_time DROP NOT NULL;

ALTER TABLE happy_hours
  ADD CONSTRAINT happy_hours_all_day_shape_check
  CHECK (
    (all_day = true  AND start_time IS NULL AND end_time IS NULL)
    OR
    (all_day = false AND start_time IS NOT NULL)
  );
```

Notes:
- The CHECK applies to all rows immediately. Existing rows have `all_day=false` (default) and `start_time IS NOT NULL` (was the old constraint), so they satisfy the new constraint without backfill.
- `crosses_midnight` (generated column, `end_time < start_time`) returns NULL when either operand is NULL — already the case for "until close" rows; nothing changes for all-day rows (both operands NULL → NULL, treated as `false` downstream).
- Drizzle schema must mirror this: add `allDay: boolean('all_day').notNull().default(false)`, change `startTime` to nullable, add the CHECK in the table definition (Drizzle supports `.check()` on the table).

## Prompt change

Add to `prompts/seed-extract-hh.md` near the existing time rules:

> **All-day deals.** If a venue lists a recurring discounted offer by day with no time window (e.g. "Monday: $2 burgers all damn day", "Wednesday wing night, no time given"), emit `allDay: true` and leave `startTime` / `endTime` as null. `allDay: true` is a **positive assertion** that the deal runs the full open hours of those days — only use it when the page explicitly says so (phrases like "all day", "all damn day", or a deal listed under a weekday header with no time qualifier). Do NOT use it as a fallback when you couldn't find times. If you cannot determine whether a deal is windowed or all-day, return an empty `happyHours` entry — don't guess.

Also lightly broaden the system framing — replace "happy-hour schedules" with "recurring discounted offers (happy hours and day-labeled all-day deals)" — so the model doesn't anchor on the "happy hour" label and miss day-special framing. (Deliberately NOT mentioning weekly/monthly specials — too risky a framing; encourages grabbing one-off promos.)

Bump prompt frontmatter version (`version: 5` → `6`) with a one-line note describing the all-day clause.

## Display surfaces

Four call sites today, all using `formatTime`:

- `components/venue-table-client.tsx:559-560` (table body — start/end columns)
- `components/venue-table-client.tsx:665,667` (mobile card layout)
- `app/[city]/venue/[slug]/page.tsx:220` (venue detail page user-facing row)
- `app/[city]/venue/[slug]/page.tsx:92-93` (JSON-LD `Schedule` block: emits `startTime`/`endTime` from `h.startTime`/`h.endTime`)

Add `formatWindow(window: { allDay: boolean; startTime: string | null; endTime: string | null }): string` to `lib/format.ts`. Update the three user-facing call sites to use it. The existing `formatTime` stays for any single-time use.

For the JSON-LD block at `page.tsx:92-93`: when `h.allDay` is true, **omit both `startTime` and `endTime`** from the `Schedule` block — keep `byDay`. Both are optional in schema.org `Schedule`; emitting `"00:00"` or any placeholder would be semantically wrong (search engines would render it as "starts at midnight"). Concretely change from unconditional emission to a guarded spread:

```ts
...(h.allDay
  ? {}
  : {
      startTime: h.startTime!.slice(0, 5),  // safe: CHECK guarantees non-null when !allDay
      ...(h.endTime ? { endTime: h.endTime.slice(0, 5) } : {}),
    }),
```

## Edge cases & explicitly out of scope

- **Rotating limited-quantity specials** (Red Hot Thursday "Test Kitchen Special, open to sellout") — out of scope. Different shape; needs its own discussion later.
- **Open-hours awareness** in `isWindowActive` (a venue's actual closing time) — out of scope. Pre-existing approximation; the all-day branch inherits the same "active throughout the listed day" behavior as the legacy "until close" path.
- **Weekly / monthly specials framing** — explicitly NOT added to the prompt. Risks the model grabbing one-off seasonal promos.
- **Discovery-gate bug** that let Tides Tavern (cross-bridge Gig Harbor venue) through — separate latent issue, tracked in CLAUDE.md.
- **Pulsing circle + clock** UI polish (the user-mentioned side issues) — addressed in a separate design pass after this lands.

## Testing / validation

After implementation:

1. Reset The Red Hot's candidate row:
   ```sql
   UPDATE seed_candidates SET processed_at=NULL, outcome=NULL
   WHERE id='bdb4572a-1c69-4ff6-8ba8-43fc19298cd9';
   ```
2. Re-run `npm run seed:enrich -- --city tacoma --limit 1` (≈6¢ spend).
3. **Pass criteria:**
   - ≥3 windows confirmed (M/Tue/Wed at minimum)
   - Each stored with `all_day=true, start_time=NULL, end_time=NULL`
   - Venue page `/tacoma/venue/the-red-hot` renders **"Open to close"** for each window — never "12 AM – close" or any time-prefixed string
   - JSON-LD `Schedule` for these windows has `byDay` but no `startTime`/`endTime` fields (verify with `curl -s … | grep -A 5 Schedule`)
4. Spot-check 1–2 other existing Tacoma stubs that look like the same pattern (E9 Firehouse, Doyle's Public House) — re-run them and see if any recover.

Verification gates: `tsc --noEmit`, `eslint`, `next build` clean (modulo the two pre-existing Phase 0 lint issues documented in CLAUDE.md). `npm run db:migrate` applies cleanly on a fresh DB and on a DB with existing rows.

## Files touched

- `db/migrations/0006_all_day_happy_hours.sql` — new migration (add column, drop NOT NULL on start_time, add CHECK)
- `db/schema/core.ts` (or wherever `happy_hours` is defined) — mirror the column + nullability + CHECK in the Drizzle schema
- `lib/ai/extractHappyHours.ts` — tool schema (`allDay` field, `startTime` nullable + drop from `required`); `normaliseHappyHour` handles `allDay` branch; drop rows where `allDay=false` AND `startTime=null`. Export type changes too — `ExtractedHappyHour` gains `allDay: boolean`, `startTime: string | null`.
- `prompts/seed-extract-hh.md` — version bump, new "ALL-DAY DEALS" clause, light framing tweak
- `lib/apply/engine.ts` — add `all_day` to `HAPPY_HOUR_FIELDS` allowlist
- `lib/geo/timezone.ts` — `HappyHourWindow` interface gains `allDay: boolean`; `isWindowActive` short-circuits when `allDay` is true
- `lib/format.ts` — new `formatWindow(window)` helper
- `lib/queries/venues.ts` — read `all_day` alongside times in any query that returns happy_hours rows for display
- `components/venue-table-client.tsx` — replace `formatTime(b.start) – formatTime(b.end)` pattern with `formatWindow(...)` at the four sites; row data shape passes `allDay`
- `app/[city]/venue/[slug]/page.tsx` — replace at the user-facing site (line 220); update JSON-LD block (lines 92-93) with guarded spread

## Risks & mitigations

- **Migration applied to a fresh DB vs an existing DB with rows.** The CHECK is satisfied by every legacy row (`all_day=false` default + `start_time IS NOT NULL` was previously enforced), so no backfill needed. Verify on a copy of dev DB before applying anywhere shared.
- **Prompt change might miss other patterns.** Mitigation: the new clause is additive and explicit ("only when the page actually says so"); existing time-windowed extraction is untouched. The smoke test against Red Hot validates the positive case.
- **Display branch missed somewhere.** Mitigation: there is exactly one display helper (`formatWindow`) — adding a callsite without it would render a literal "null – close" or similar, which is loud and visible.
- **JSON-LD emission semantically wrong.** Mitigation: omit both time fields in the all-day case (schema.org permits this); spot-check the rendered JSON-LD after fix lands.
- **Future scope creep** (rotating specials, weekly specials, etc.) — out-of-scope list above is explicit. If those come up later, they get their own design pass.
