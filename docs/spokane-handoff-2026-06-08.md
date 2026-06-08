# Spokane onboarding + extraction fixes — handoff (2026-06-08)

Branch: `feat/spokane-onboarding`. Local docker DB holds the Spokane data (source of truth).

## Done
- **Spokane onboarded** (~$5 total: ~$4 discovery + $1.06 enrich). 205 venues, 99.5% on a
  neighborhood (6 cardinal districts; 0 OSM polygons — data gap). Discovery 56→48 tiles @3km
  (subdivision ~2.4×'d it → 135 fetches). Enrich `--batch` free-first landed real HHs at $0.
- **Window-reconcile gate** (spec `docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md`,
  plan `docs/superpowers/plans/2026-06-07-hh-window-reconcile-gate.md`) built via subagent-driven
  dev (8 tasks, dual-reviewed), committed. Pure module `lib/places/windowReconcile.ts`
  (merge → operating-hours → overlap), wired into `persistExtractedWindows`, re-gate script
  `scripts/reconcile-windows.ts` (`reconcile:windows --city --state [--apply]`). 25 unit checks +
  33 CI suites green. A unique-index collision bug on `--apply` was found+fixed (soft-delete
  absorbed before expanding kept row; guard residual 23505).
- **Gate applied to Spokane:** 47→34 confirmed venues, 55 hidden, 39 merged-away. All REVERSIBLE
  (soft-delete + active flips, idempotent re-run). Review artifact: `docs/spokane-gate-review.csv`
  (every window LIVE/HIDDEN + source_url + website).
- **Major drops verified legitimate:** ~13 of 14 confirmed→stub are correct (their "HH" == their
  open hours, e.g. Cathay Inn 12–9, Taco Time 10–8, Liberty/Mamma Mia's window==open-hours via
  hours_json coverage). See review CSV.

## Operator directives (NEW — do not violate)
- **No manual per-venue patching.** Don't hand-enter Bigfoot/etc. Fix the extractor/gate so these
  TYPES are captured correctly. (Scalable over one-off.)
- **Red Wheel must not be dropped.** Its real 3–5pm HH is genuine.

## Open work (the two extraction fixes)

### 1. Gate refinement — morning open-till-close = operating hours (fixes Red Wheel class)
Root cause: Red Wheel opens 11am weekdays / 9am weekends; its junk `09:00-till-close` window
matched open-time on only 2/7 days, so `isOperatingHours`'s start-only majority rule missed it.
It survived pass 2 and overlapped the real `15:00–17:00` → both hidden (overlap-conflict).
**Fix:** in `lib/places/windowReconcile.ts` `isOperatingHours`, extend the start-only branch:
a start-only (endTime null), non-allDay window whose `start ≤ BUSINESS_DAY_START_MAX_MIN`
(11:00) on a MAJORITY of its days is operating-hours even WITHOUT an hours_json match (the
start-only analog of the bounded "business-day span" rule). Keep the existing hours_json
start≈open rule too.
- Add a golden test (Red Wheel input: `09:00-null {1-7}`, `11:00-null {1-7}`, `15:00–17:00 {2,3,4,7}`
  → expect only `15:00–17:00` live).
- Re-run `pnpm tsx scripts/reconcile-windows.ts --city spokane --state wa --apply`. Verify Red Wheel
  shows 1 live (3–5pm). Confirm no other venue regresses (diff the review CSV).
- Watch: don't false-positive a real "3pm till close" HH (start 15:00 > 11:00, unaffected) or an
  all-day deal (allDay exempt).

### 2. Extractor recall — capture HH buried under daily-specials (fixes Bigfoot class)
The gate is innocent; the extractor MISSED Bigfoot's real `every day 16:00–19:00` ("Happy hour!
Every day 4-7PM, $2 off Domestics/Wells, $5 Fries/Tots, $10 Pretzel, $15 Nachos" — at the bottom
of bigfootspokane.com) and instead emitted 6 daily-specials fragments. A gate can't surface a
never-captured window.
**Diagnose first** (~5¢): `pnpm tsx scripts/debug-extract.ts --candidate "Bigfoot" --city spokane --state wa`
to see what pages it fetches + what the model returns and why it favors specials over the HH block.
Then improve the extraction prompt/logic (`prompts/seed-extract-hh.md` + `lib/ai/extractHappyHours.ts`):
likely need to (a) prioritize an explicit "happy hour" block over generic daily-specials, and
(b) not emit per-special fragments as windows. This is the scalable lever — see memories
`[[project_extractor_misses_all_day_specials]]`, `[[data-capture-failure-modes]]`,
`[[extractor-drops-priceless-windows]]`.

## Then finish go-live
- Commit the still-uncommitted Spokane onboarding: `scripts/seed-cities.ts` (Spokane row),
  `data/spokane-boundary.geojson`, `scripts/seed-enrich-candidates.ts` (180s poll interval).
- Re-run the gate after fix #1. Operator final eyeball of `docs/spokane-gate-review.csv`.
- Flip Spokane `status='live'`, open PR (gate + onboarding together).
- Next cities after Spokane: Sacramento, then Seattle (per operator).
