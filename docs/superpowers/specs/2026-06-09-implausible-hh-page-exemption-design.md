# implausible_active exemption for HH-page-sourced windows — design

**Date:** 2026-06-09
**Status:** approved by operator

## Problem

The `implausible_active` audit flag (`lib/audit/anomalyRules.ts`) fires on any active
window with duration >6h or ≤0. Its intent was to catch scraper errors (e.g. an
extractor recording an 8-hour "happy hour" that is really operating hours). But the
2026-06-09 flag review showed many flagged wide windows are sourced from pages that are
explicitly happy-hour pages (URL slug and/or page title says "happy hour"). When the
venue's own HH page states a wide window, it is real ("all day happy hour" exists) and
should not be flagged.

## Decision (operator-confirmed)

1. **Signal = source URL only.** Exempt the >6h branch when
   `scoreHhUrl(sourceUrl) ≥ 100` — i.e. the canonical `HH_RE` (`happy[-_ ]?hour`)
   matches the URL (`lib/places/hhText.ts`). Page title/H1 is not stored on windows and
   the audit is deliberately $0/pure (no network), so title-based exemption is out of
   scope; title-only cases are handled once via the `/admin/flags` keep decision, which
   persists.
2. **No duration ceiling** for HH-URL-sourced windows. The degenerate branch
   (duration ≤ 0) keeps flagging regardless of source — start==end is a data error no
   page can justify.
3. **Audit flag only.** Capture-side plausibility (`parseHhText.computePlausible`,
   realness gate) is unchanged: new wide windows still land hidden for review.

## Change

`isImplausibleShape(w)` in `lib/audit/anomalyRules.ts` additionally reads
`w.sourceUrl`: when the duration is >6h but `scoreHhUrl(w.sourceUrl) ≥ 100`, do not
flag. `scoreHhUrl` is already imported in that file.

## Intentionally unchanged

- `operating_hours_active` / `overlapping_windows` (report severity, shared reconcile
  gate) still fire on the same window when applicable — distinct signal.
- `stale_event_source` still catches event-y HH URLs (the La Escondida
  `/happy-hour-final-friday` regression pattern), so the exemption cannot resurrect a
  one-off event stored as recurring.
- `isHighConfidenceCorrection` unchanged.

## Accepted edge

`scoreHhUrl` matches `HH_RE` anywhere in the URL, so an HH-branded venue domain
(e.g. `happyhourgrill.com`) exempts all its pages. Consistent with the canonical scorer
and with the rule's spirit; no path-only variant is introduced.

## Tests (`scripts/test-anomaly-rules.ts`)

- >6h window, HH URL (`…/happy-hour`) → no `implausible_active`.
- >6h window, non-HH URL (`…/menu`) → flags.
- >6h window, null sourceUrl → flags.
- Degenerate (start == end), HH URL → still flags.
