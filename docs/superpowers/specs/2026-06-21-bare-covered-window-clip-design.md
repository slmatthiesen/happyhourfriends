# Bare-covered window clip — design

**Date:** 2026-06-21
**Branch:** `fix/reconcile-bare-covered-clip`

## Problem

Venues like Eureka! and several Berkeley venues show a **bare** happy-hour window
(zero offerings) sitting next to **deal-carrying** windows at the same time that
already cover it. The bare window is redundant noise.

Example — Eureka! 15:00–18:00:

| days | time | offerings |
|---|---|---|
| `[1,2,3,4,5,6,7]` | 15:00–18:00 | **0** (bare) |
| `[1]` | 15:00–18:00 | 1 |
| `[2]` | 15:00–18:00 | 1 |

The bare window falls through both existing `reconcileWindows` passes:

- `mergeDuplicates` won't merge it — different `offeringsKey` (bare `""` vs deal
  fingerprint), so it stays a separate row.
- Pass 3 overlap-conflict **skips identical-time windows** (`windowsOverlap` returns
  `false` when times match), so the bare survives beside the deals.

Same shape at La Marcha (22:00–close bare `[1-6]` beside deal `[5,6]`), Vanessa's,
Acme, El Mono.

## Goal

Remove redundant bare windows whose time is covered by deal-carrying windows, **without
losing the "only info we have" case** — a lone bare window (often gathered straight from
a venue's URL, useful as a menu-paste prompt) must stay.

## Rule

New pass in `lib/places/windowReconcile.ts`, **`bareCoveredClip`**, running after the
operating-hours pass and **before** the overlap-conflict pass, over active results only.

For each **bare** active window (`offeringsKey ?? "" === ""`):

1. **Covered days** = days of the bare window for which some *other active deal-carrying*
   window, sharing that day, has a time interval that **contains** the bare window's
   interval (`dealStart ≤ bareStart && dealEnd ≥ bareEnd`, using the existing `interval()`
   helper so null-end = end-of-day and all-day = full day).
2. **0 covered** → leave untouched. (Covers both the lone-bare-window case and the
   no-overlap case automatically — no special-case needed.)
3. **Strict majority covered** (`covered.length * 2 > totalDays`) → **drop the whole bare
   window**: `active = false`, reason `bare_covered_clip`. Accepts losing the
   uncovered-day claim (operator's call: M–Th covered, no Friday → drop).
4. **Minority covered** (≤ 50%) → **clip**: remove the covered days, keep the remainder
   (guaranteed non-empty), reason `bare_covered_clip`.

### Why containment, not overlap

A day/time is only removed when a deal window **provably covers** it, so no information is
lost. The non-identical *partial* overlap case (bare wider than deal) is already handled
by the existing Pass 3 overlap-conflict. This pass specifically fills the identical-time
(and deal-contains-bare) gap that Pass 3 skips. Running it before Pass 3 also makes the
contained-overlap case a gentle per-day clip instead of Pass 3's wholesale hide.

### Threshold

`covered * 2 > total` (strict majority = "most"). Exposed as a named constant for tuning.
Anchored to operator examples: 4-of-5 covered → drop; 1-of-5 → clip.

## Persist-gap fix

`scripts/reconcile-windows.ts` currently writes `days_of_week` **only** during a merge.
A clip-without-merge (this pass, and the pre-existing `closed_day_clip`) therefore never
persists. Add a branch: when a result stays `active` but its day-set differs from the
source row's days, `UPDATE happy_hours SET days_of_week = …`. Never write an empty array
(DB CHECK forbids it) — the drop case takes the existing `active = false` HIDE branch and
leaves days untouched.

`lib/recover/resolveVenue.ts` already consumes `recon.window.daysOfWeek` and
`recon.active` for fresh persists, so new extractions get the clip for free.

## Retro heal

Run the documented routine per live city locally:
`pnpm tsx scripts/reconcile-windows.ts --city <slug> --state <st> --apply`.
Prod deploy stays the operator's call.

## Testing (TDD)

Add cases to `scripts/test-window-reconcile.ts`:

- identical-time bare on all days + deals covering majority → bare dropped (inactive).
- bare on `[1-7]` + deals on `[1],[2]` (2/7, minority) → clipped to `[3,4,5,6,7]`, active.
- lone bare window, no deals → untouched.
- bare wider in time than deal (deal does not contain bare) → not clipped by this pass.
- bare 22:00–null + deal 22:00–null same day (null-end containment) → covered.

## Out of scope

- Changing Pass 3 overlap behavior.
- Persisting `closed_day_clip` in `resolveVenue` (already correct there); the script fix
  incidentally also closes the script's `closed_day_clip` persist gap.
