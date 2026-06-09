# HH window-reconcile gate — design (2026-06-07)

## Problem

The AI extractor over-captures happy-hour windows on some venues, producing public rows
that are wrong. Surfaced during the Spokane onboarding (2026-06-07), confirmed against
operator ground-truth on 6 venues. Two distinct failure modes:

1. **Operating-hours-as-HH.** The extractor captures a venue's *open hours* as a happy
   hour. South Perry Lantern: real HH is `Mon–Sun 14:00–17:00`, but it also stored
   `10:00–23:00`, `11:00–23:00`, `11:00–00:00` (the venue's operating hours). The Swinging
   Doors stored `08:00–23:00` and `08:00–22:00` alongside the real `15:00–18:00`.

2. **Per-day fragmentation / overlap duplication.** One HH is split into many rows, or
   overlapping fragments are emitted. The Swinging Doors' real `Mon–Sat 15:00–18:00` was
   stored as six identical per-day rows (`{1}…{6} 15–18`) plus a `{1-5}` duplicate. Bigfoot
   Pub stored six overlapping all-day rows (`18–20`, `19–21`, `19–22`, plus bare-start
   `11:00`, `20:00`, `21:00`) — none of which is the real `every day 16:00–19:00`.

These are deterministic, mechanical defects in the *shape* of the captured data — not a
judgment the AI needs to make. They are fixable in pure code.

## Design principle

Consistent with the operator directive (2026-05-31, `realnessGate`): **the AI extractor
captures everything it can read and never judges realness; a cheap, pure-code,
deterministic gate decides what is shown publicly.** This gate extends that pattern. It
**never hard-deletes** — suspect windows only flip `active` (visibility); merging unions
`days_of_week` onto a kept row and reversibly soft-deletes the absorbed exact-duplicate
copies (`deleted_at`, recoverable). No real data is lost, and suspect rows stay queryable
and appear in a review report.

## Architecture

`realnessGate.assessRealness` is **per-window**. Merge and overlap detection need
cross-window context, so this adds a **per-venue** reconcile step that operates on the full
set of a venue's extracted windows.

New module `lib/places/windowReconcile.ts` (pure, no DB / no network):

```
reconcileWindows(windows: ReconcileWindow[], hoursJson?: OpenPeriod[] | null)
  → ReconcileResult[]   // one verdict per RESULTING window
```

`ReconcileWindow` carries `{ daysOfWeek, startTime, endTime, allDay }`. Each
`ReconcileResult` carries the (possibly merged) window plus `{ active, reasons }`, where
`reasons` extends `RealnessReason` with `operating_hours`, `overlap_conflict`, and
`merged_duplicate` (informational; merged rows stay active).

It runs in the shared persist path (`lib/recover/resolveVenue.ts` →
`persistExtractedWindows`) so **both** `seed:enrich` and `reextract:stubs` get it, and is
exposed as a **re-runnable script over already-stored rows** (`reconcile:windows --city`),
mirroring how the realness gate can be re-applied after a rule tweak.

## The three operations (in order)

### 1. Merge exact duplicates
Group windows with identical `(startTime, endTime, allDay)`; collapse each group to one
window whose `daysOfWeek` is the sorted-unique union. Reason `merged_duplicate` (stays
active). Deterministic, lossless.
*Swinging Doors: six `15–18` rows + `{1-5}` dup → one `{1,2,3,4,5,6} 15–18`.*

### 2. Operating-hours filter
Applies **only to bounded** (start set) **non-`allDay`** windows — `allDay` deals are
governed by the existing all-day policy and are exempt (this is what protects Garland's
"All Day Monday 3–9pm"). A window is operating-hours → `active=false`, reason
`operating_hours`, if **any** of:

- **hours_json match:** `hoursJson` present and the window covers **≥80%** of the open
  period on the days it runs. For a multi-day window, compare against each covered day's
  open period and classify operating-hours if it matches on a majority of those days
  (venues with day-varying hours are the reason for "majority" rather than "all"); or
- **long-window backstop:** no usable `hoursJson` and duration **≥8h** (operator: a real
  HH is almost never ≥8h; 8h+ is open-to-close); or
- **business-day span:** `startTime ≤ 11:00` **and** duration **≥6h** (operator's
  "`9:00–18:00` = operating hours" intuition — a window that opens in the morning and runs
  through the day, which the 8h backstop alone would miss, e.g. `09:00–16:00`).

A start-only window (`endTime` null, non-`allDay`) whose `startTime` ≈ the venue's open
time (within 30 min, from `hoursJson`) is also operating-hours ("open till close").
*Lantern: `10–23`/`11–23`/`11–00` hidden, real `14–17` kept. Swinging Doors: `08–23`/
`08–22` hidden.*

### 3. Overlap-conflict
After merging, for each pair of remaining windows that **share at least one day** and whose
clock ranges **overlap but are not identical**, mark **all** windows in the conflict set
`active=false`, reason `overlap_conflict`, and list them in the review report. We do not
guess a winner — an extractor that emitted overlapping windows on the same days is not
trustworthy for that venue.
*Bigfoot: `18–20`/`19–21`/`19–22` overlap every day → all hidden → venue drops to stub for
review (its real `16:00–19:00` was never captured; operator supplies it).*

The existing `assessRealness` per-window checks (`all_day_many_days`, `no_time_window`,
`low_confidence`) continue to run; a window goes live only if it passes both the reconcile
step and `assessRealness`.

## Thresholds (named constants, tunable)

- `OPERATING_HOURS_COVERAGE = 0.80`
- `OPERATING_HOURS_MIN_HOURS = 8`
- `BUSINESS_DAY_START_MAX = "11:00"`, `BUSINESS_DAY_MIN_HOURS = 6`
- `OPEN_TIME_TOLERANCE_MIN = 30`

Validated against all 6 Spokane ground-truth venues: every offender is caught, every real
HH (incl. Garland's 6h all-day Monday and Tue–Fri 3–5pm) is spared.

## Testing

Golden set built from the **actual extracted window-sets** of the 6 Spokane venues, with
operator ground-truth as the expected output. Pure-function unit tests in
`scripts/test-window-reconcile.ts` (runnable tsx checks, no DB/AI; matches the repo's
`test-realness-gate.ts` idiom):

| Venue | Input windows | Expected after reconcile |
|---|---|---|
| Lantern | `10–23`,`11–23`,`11–00`,`14–17` (all `{1-7}`) | `14–17 {1-7}` live; 3 hidden `operating_hours` |
| Swinging Doors | 6×`15–18` per-day + `{1-5}15–18` + `08–23`,`08–22` | `15–18 {1-6}` live (merged); 2 hidden `operating_hours` |
| Bigfoot | `18–20`,`19–21`,`19–22`,`11:00-`,`20:00-`,`21:00-` `{1-7}` | all hidden (`overlap_conflict` / `operating_hours`) → stub |
| Garland | `{1} all-day 15–21`, `{2-5} 15–17` | both live (all-day exempt; 2h bounded) |

1919 Wine Cellar and Crazy Train are **not** pure-gate golden cases — the gate hides their
overlapping/operating-hours rows but a non-conflicting residual may survive (e.g. 1919's
`{Tue,Sun} 12–15`). They are resolved in rollout by operator ground-truth (1919 → Sunday
all-day; Crazy Train → left as a stub), not asserted in the unit test.

## Rollout — "fix these for review"

1. Land the gate + `reconcile:windows` script (this spec → plan → implementation).
2. Run `reconcile:windows --city spokane --state wa` → auto-cleans Lantern & Swinging
   Doors, hides Bigfoot/1919/Crazy-Train garbage. Produces the review report.
3. Apply operator ground-truth through the audited apply path with the supplied source URLs:
   - **Nectar** — keep `Mon–Fri open–17:00`, add offerings (`$1 off appetizers, glass
     pours, beer on tap`). Source `nectarwineandbeer.com`.
   - **1919 Wine Cellar** — replace with `Sunday all-day` HH.
     Source `1919winecellar.com/weekly-events`.
   - **Bigfoot** — replace with `every day 16:00–19:00` + offerings (`$2 off Domestics,
     $2 off Wells, $5 Fries/Tots basket, $10 Soft Pretzel w/ Cheese, $15 Nachos`).
     Source `bigfootspokane.com`.
   - **Crazy Train** — leave as stub (unconfirmed).
   - **Garland Brew Werks** — `Mon all-day (3–9pm)` + `Tue–Fri 15:00–17:00`.
     Source `garlandbrewwerks.com/happy-hour`.
4. Operator eyeballs the review state → flip Spokane `status='live'`.

## Out of scope

- Prompt/extractor changes (decided: deterministic gate only — see brainstorm).
- Auto-resolving overlap conflicts to a "winner" (decided: hide all for review).
- Re-gating other cities (separate opt-in pass once the gate is proven on Spokane).
- Any deletion of rows (gate only flips `active` / unions days).
- Offering-level merge across same-time fragments. When merge collapses duplicate windows,
  only the first fragment's offerings persist (the rest skip via `onConflictDoNothing`).
  Per-day fragments carry identical offerings today, so nothing real is lost; revisit only
  if the extractor begins splitting *different* offerings across same-time windows.

## Addendum (2026-06-09): offerings as the discriminator (PRs #56 + follow-up)

Tacoma's dry-run surfaced three false-positive classes the time-shape rules alone can't
separate, all resolved by bringing the window's OFFERINGS into the gate. Validated against
both Spokane (no regressions; re-run is a no-op) and Tacoma ground truth (operator checked
Twisted Fork's site; Fondi's specials page checked directly).

- **Merge identity = `(startTime, endTime, allDay, offeringsKey)`.** Same-time windows
  with different deals are per-day specials (Dirty Oscar's Moonshine-Monday/Tequila-Tuesday;
  Elks Temple's base HH + same-time daily add-ons) and must NOT merge — merging soft-deleted
  rows together with their distinct offerings. `offeringsFingerprint` is an order-insensitive
  hash of `(name, priceCents)` pairs. This also retires the "offering-level merge" caveat
  above: windows now merge ONLY when their offering sets already match.
- **Operating-hours: `hours_json` is authoritative when usable** (the backstops were always
  specced as hours-unknown fallbacks), and coverage is interval OVERLAP, not duration ratio —
  Fuego's Fri 4–6PM special was flagged because 2h ≈ 80% of the club's 2.5h open day
  (9:30PM–12) despite zero overlap. A shape-flagged window is hidden only when it is
  offerings-BARE (Swinging Doors' 08–23) or a COPY of a non-flagged window's deal set
  (Lantern's 10–23 beside its real 14–17). An open-to-close window carrying its own unique
  deal set is a genuine all-day special (Twisted Fork — operator-verified) and stays live.
- **Overlap-conflict requires same (or bare) deal sets.** Overlapping windows with distinct
  offerings are coexisting deals (Fondi: lunch menu 11–16 + Pizza Per Due 14–17, both on
  fondi.com/specials). The true duplicate-capture class (4–6 vs 4–7 of the same deal,
  Bigfoot's five same-set overlaps, and its bare `11:00–` row) still conflicts.

Callers that pass no `offeringsKey` (e.g. `lib/audit/anomalyRules.ts`) get the strict
pre-discriminator behavior, so the audit still FLAGS these shapes for operator review —
it just no longer auto-hides windows whose deals vouch for them.

### Second iteration (same day): extension days + bare-vs-deal asymmetry

The first all-cities apply demoted 11 venues to stub; operator review + site checks
showed two of the overlap-conflict verdicts were recognizable FALSE-POSITIVE patterns:

- **Day-specific extension.** Same deal set, same-day overlap, but one window runs on a
  STRICT SUBSET of the other's days → it is "extended (or shortened) happy hour on day X"
  of the same deal, not a contradiction. Site-verified at Mr. An's (Tucson): "TUESDAY
  EXTENDED HAPPY HOUR ... 4pm–8pm" beside the Mon–Sat 4–7 base; BOCA's daily 16–18 +
  Thursday 16–close is the same shape. EQUAL day-sets remain a conflict — that is exactly
  the 4–6-vs-4–7 duplicate-capture class.
- **Bare-vs-deal conflicts hide the bare side only.** "We do not guess a winner" assumed
  symmetric evidence; a window with no offerings overlapping one carrying priced deals is
  not symmetric. SunSet Wine Bistro's real 16:00–17:30 (site-verified) was being poisoned
  by a bare 16:00–17:00 fragment. Bigfoot's bare start-only fragment still hides; its
  deal-carrying overlaps still mutually conflict (same fingerprints).
