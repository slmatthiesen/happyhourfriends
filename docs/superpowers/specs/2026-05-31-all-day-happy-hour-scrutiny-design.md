# All-day happy-hour scrutiny + hardening — design

**Date:** 2026-05-31
**Branch:** `cluster-schema-seed-pipeline`
**Status:** approved design, pending implementation plan

## Problem

"All-day" happy-hour listings are unreliable, in three distinct ways the operator
observed while spot-checking Phoenix:

1. **Not a happy hour at all.** The source is a daily coupon or a standing discount,
   not a recurring time-limited happy hour. Example: Iron Chef Phoenix
   (`ironchefphoenix.com/?type=Coupon`) — an objective false positive.
2. **Overclaimed as all-day.** A real happy hour exists but runs a *window*, not all
   day; the extractor recorded it as all-day. Example: The Vig (Phoenix) has a genuine
   HH but on a bounded schedule, not open-to-close.
3. **Shown "active" while the venue is closed.** Even a legitimately-all-day or
   "until close" deal is rendered as *happening now* at 3am, because we don't know
   (or don't bound by) the venue's actual closing time.

Current state in the DB: ~27 windows flagged `is_all_day = true` (Phoenix 19 / Tucson
6 / Scottsdale 2), across ~20 venues. Several are clear false positives or overclaims.

### Why it happens (root causes, confirmed by code reading)

- **Extractor over-triggers `allDay`.** `prompts/seed-extract-hh.md` (v8) permits
  `allDay: true` for "a deal listed under a weekday header with no time qualifier."
  The model stretches this to coupons, standing discounts, and any deal it can't find
  a time window for — exactly the fallback the prompt tries to forbid but doesn't
  enforce. There is **no code-level cap** on all-day breadth in
  `lib/ai/extractHappyHours.ts` (`normaliseHappyHour`).
- **"Happening now" can't see closing time.** `venues` has **no opening-hours column**.
  `lib/geo/timezone.ts:isWindowActive` treats an `all_day` window as active the entire
  24h of any listed day (line 65-66), and an `endTime: null` ("until close") window as
  active until **midnight** (line 72: `end = 24 * 60`). Both over-report into hours the
  venue is shut.

### Governing thesis (operator-agreed)

A happy hour is a **recurring, time-limited** discount during off-peak hours. A
discount available all open hours, every day, is just regular pricing — **not** a happy
hour. A genuine "all day" deal is real but **narrow**: an industry-night pattern on
**≤2 specific days**, explicitly stated in a first-party source. So `is_all_day` stays
in the model but is **constrained to ≤2 explicitly-sourced days**; 3+ days all-day is
invalid. Cross-cutting rule: **no quotable source → never keep an all-day claim.**

## Scope

Three parts, each independently shippable:

- **Part A** — one-time adversarial review of the existing ~27 all-day rows
  (report-only; operator approves; then a guarded `--apply`).
- **Part B** — durable pipeline hardening (prompt + code backstop) so this stops for
  the next cities.
- **Part C** — store venue opening hours and stop showing "active" while closed.

Out of scope: redesigning the submission/verifier pipeline; community-flag changes;
hero-image fix (separate known issue).

---

## Part A — Adversarial review of existing all-day rows

A new script `scripts/reverify-all-day.ts` (npm `reverify:all-day`), two phases.

### Phase 1 — review (no DB writes)

1. Query every `happy_hours` row where `is_all_day = true AND deleted_at IS NULL`,
   joined to its venue (name, address, `website_url`, `serves_*` if available) + city +
   the row's `source_url` and offerings.
2. For each window, **on the main thread** (web fetch is main-thread-only —
   `[[scraper-headless-blocked]]`), fetch the venue's source page(s) — reusing the
   enrich fetch path that already handles HTML + PDF — and run an **independent,
   disconfirmation-biased** prompt `prompts/reverify-all-day.md`. This prompt is
   **separate from the extractor on purpose**: its job is to *disprove* the all-day
   claim, not re-derive it (avoids circular trust in the same logic that produced the
   error). It returns a structured verdict per window via a forced tool call:
   - `real_window` — found actual start/end times **+ a verbatim source quote**
   - `legit_all_day` — ≤2 specific days, explicit "all day X" language **+ verbatim quote**
   - `not_happy_hour` — coupon / standing discount / one-off promo
   - `unconfirmable` — no quotable happy-hour schedule on any source checked
   - plus `servesAlcohol` / `looksLikeDrinksVenue` signal (to drive delete-vs-stub)
   - plus `sourceUrl` and `quote` (verbatim) backing the verdict
3. Map verdict → **recommended action** (pure function `recommendAction(verdict)`, unit
   tested):

   | Verdict | Recommended action |
   |---|---|
   | `real_window` | **correct** — set real `start_time`/`end_time`, `all_day=false`, keep offerings |
   | `legit_all_day` (≤2 days) | **keep** — no change |
   | `not_happy_hour` + not a drinks venue | **delete_venue** (recommend only) |
   | `not_happy_hour` / `unconfirmable`, but plausible drinks venue | **stub** — soft-delete the window(s), keep the venue |

4. Emit a review file pair: `docs/all-day-review-<date>.md` (human-readable) and a
   machine-readable `docs/all-day-review-<date>.json`. Each entry shows venue, city,
   current data, source(s) checked, the **verbatim quote**, verdict, and the
   recommended `action`. **No DB changes in this phase.**

### Phase 2 — apply (operator-gated)

- Operator reviews the report and edits the `action` field where they disagree.
- `npm run reverify:all-day -- --apply docs/all-day-review-<date>.json` executes the
  approved actions in a transaction, writing `audit_log` rows (actor `operator`,
  before/after) so every change is revertible.
- **Deletes are opt-in per venue:** `--apply` performs a `delete_venue` action **only**
  if the reviewed JSON still has `action: "delete_venue"` for that row. The script
  never deletes on its own initiative; `not_happy_hour` defaults to `delete_venue` in
  the *recommendation* but the operator must leave it set.
- "stub" = soft-delete the `happy_hours` window (and its offerings) and set the venue's
  `data_completeness = 'stub'` if it now has no live windows. Venue remains as a
  help-wanted listing.
- "correct" = update the existing row's `days_of_week` / `start_time` / `end_time` /
  `all_day=false`, preserving its offerings.

### Units & boundaries

- `lib/reverify/adversarial.ts` — builds the request, runs the turn loop, parses the
  forced tool call into a typed verdict. Depends on the Anthropic client + the shared
  fetch helper. Testable via a parse-only unit test on a recorded tool-call payload.
- `lib/reverify/policy.ts` — `recommendAction(verdict): Action`. Pure, fully unit
  tested.
- `lib/reverify/report.ts` — render/parse the md + json report. Pure.
- `scripts/reverify-all-day.ts` — orchestration only (query → fetch → adversarial →
  report; or `--apply`). Writes go through a small transactional applier that records
  `audit_log`.

---

## Part B — Pipeline hardening

1. **Prompt** `prompts/seed-extract-hh.md` → v9:
   - Add the happy-hour *definition* (recurring + time-limited). State explicitly that a
     discount available all open hours every day is regular pricing → **omit it**, and a
     one-time coupon / limited promo is not a recurring happy hour → **omit it**.
   - Restrict `allDay: true` to explicitly-sourced deals on a **specific ≤2-day** set
     (industry-night pattern). Never set `allDay` across most/all days of the week.
   - Bump the version + `notes`; the content hash records to `ai_usage_ledger.prompt_hash`
     automatically.
2. **Code backstop** in `lib/ai/extractHappyHours.ts` (`normaliseHappyHour`) — the single
   choke point both the agentic loop and the Batch path flow through: **drop any window
   where `allDay && daysOfWeek.length >= 3`.** This enforces policy regardless of what
   the model emits, mirroring how `lib/places/chainDenylist.ts` is a code backstop to a
   prompt rule. The ≤2 line: all-day allowed on 1–2 days, dropped at 3+.
3. **Tests** (`lib/ai/extractHappyHours.test.ts` or sibling): ≤2-day all-day passes;
   3-day and 7-day all-day are dropped; a windowed (`allDay=false`) entry is unaffected.

---

## Part C — Don't show "active" while the venue is closed

`regularOpeningHours` is **already** in the Place Details field mask
(`lib/places/placeDetails.ts`) and we discard it. So this is capture + persist + use.

1. **Schema** — migration `0011_*` (latest applied is `0010`) adds `venues.hours_json
   jsonb` (nullable). Stores the structured Google `regularOpeningHours.periods` (each
   `{open:{day,hour,minute}, close:{day,hour,minute}}`; Google `day` is 0=Sun..6=Sat —
   normalize to ISO 1..7 in the read helper). Update `db/schema/core.ts`.
2. **Capture** — extend the Place Details parse in `lib/places/placeDetails.ts` to keep
   `regularOpeningHours.periods` (today only `weekdayDescriptions` is surfaced; the raw
   data already arrives in the response). Persist `hours_json` at the venue upsert in
   `scripts/seed-enrich-candidates.ts` — both write paths (`insertVenueRow` ~L143-186,
   and the two `details?.priceLevel` enrich branches ~L506 and ~L838).
3. **Active logic** — `lib/geo/timezone.ts`:
   - Add a helper `venueOpenInterval(hoursJson, dayOfWeek): {openMin, closeMin} | null`
     that returns the venue-local open window for a given ISO weekday (handling
     past-midnight close).
   - `isWindowActive` gains an optional `hours` argument. **`all_day` and `endTime: null`
     ("until close") windows are treated identically — both are unbounded and require
     venue hours to assert active:**
     - hours known → active iff `dayOfWeek` is listed and `now` ∈ `venueOpenInterval`
       (for until-close, also `now >= start`); the open-ended tail is clamped to
       `closeMin`, never `24*60`.
     - hours unknown → **return false** (suppress; do not guess a close time — C3 was
       rejected for exactly this reason).
     - **Bounded windows (both `startTime` and `endTime` are real times) are unchanged**
       — they never depend on `hours`.
   - `minutesUntilWindowEnd` similarly uses `closeMin` when present for all-day /
     until-close windows (it currently returns `null`, which is acceptable; optional
     enhancement).
4. **Consumers** — the only live caller of `isWindowActive` is
   `components/venue-table-client.tsx` (L214, inside the per-venue active-window lookup;
   `minutesUntilWindowEnd` at L690/L826). `lib/queries/venues.ts` only *orders* by
   `allDay` and is where `hours_json` must be **selected** into the venue payload so the
   client can pass it. `app/[city]/venue/[slug]/page.tsx` uses `allDay` for display
   grouping, not active-now. The behavior change lives in `isWindowActive`; the client
   threads the new `hours` argument.
5. **Backfill** — existing venues have `hours_json = null`, so after Part C their legit
   all-day / until-close badges stay **suppressed** until each is next enriched. Include
   a one-time `npm run backfill:hours` (re-fetch Place Details by `google_place_id`,
   write `hours_json`) so current venues regain the badge. Cheap — tiny field mask, and
   we already pay for the call shape.
6. **Tests** — `lib/geo/timezone.test.ts`: all-day active inside open hours; all-day
   **not** active outside open hours; all-day with unknown hours → not active;
   until-close clamped to close time; until-close with unknown hours → not active;
   bounded windows unchanged regardless of hours.

### Related risk (verify in the plan)

Part C's correctness depends on `venue.timezone` being right (Phoenix/Tucson/Scottsdale
are `America/Phoenix`, no DST). A `scripts/backfill-timezones.ts` already exists — the
plan should **confirm** the AZ venues actually carry `America/Phoenix` (not a hardcoded
`America/Los_Angeles`) before trusting any "happening now" output, and run the backfill
if not. Small check; not new code unless the backfill is incomplete.

---

## Testing strategy

- **Pure/unit** (no network): `recommendAction` (Part A), the all-day cap in
  `normaliseHappyHour` (Part B), `venueOpenInterval` + `isWindowActive` clamping (Part
  C), report parse/render (Part A).
- **Integration** (operator-run, needs keys): the adversarial pass against the real
  Phoenix all-day venues (Iron Chef → `not_happy_hour`/delete; The Vig → `real_window`);
  one `seed:enrich --limit` run to confirm `hours_json` lands and a 3-day all-day claim
  is dropped by the backstop.
- Acceptance gate per the repo: `npm run typecheck`, `eslint`, `npm run build` clean
  (modulo the two known pre-existing Phase 0 lint issues).

## Sequencing

Independent; recommended order **B → C → A** (harden first so re-running enrich during
review doesn't reintroduce bad all-day rows; add hours so the review can see real close
times; then run the one-time A cleanup). Each can be its own commit.

## Non-negotiables honored

- Never hallucinate (Part C suppresses rather than guessing close times; Part A requires
  a verbatim quote to keep anything).
- Every applied change gets a `source_url` / `audit_log` row.
- ISO day-of-week; venue-local times; dedup on `google_place_id` (untouched).
- Generic, scalable logic over per-city data (`[[feedback_scalable_not_one_off]]`):
  the all-day cap, the hours-bounding, and the adversarial review all apply to every
  city, not just Phoenix.
