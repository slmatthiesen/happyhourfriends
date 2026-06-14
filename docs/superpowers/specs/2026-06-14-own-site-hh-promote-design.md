# Own-site happy-hour auto-promote — design

**Date:** 2026-06-14
**Branch:** `feat/own-site-hh-promote`
**Status:** approved design, pre-implementation

## Problem

The hidden-HH review backlog (≈672 windows across 8 cities) is full of venues that
**do have a real happy hour on their own website** — the data just landed hidden
(provenance-suspect aggregator source, failed extraction, lunch-band gate, etc.) or never
landed at all. Hand-promoting them from a CSV is the bottleneck. Two goals:

1. **Clean up** existing no-live-HH venues whose own site has a reachable HH page.
2. **Prevent** future runs from landing those windows hidden in the first place.

## Core principle (non-negotiable)

The **only** path to a live window is one of:
- **Re-extract from the venue's own HH page** (first-party re-extraction *is* the
  verification — satisfies [[feedback_no_promote_guessing]]), or
- **Operator manual entry** (operator is ground truth).

We **never** promote an existing hidden window as-is on a shape heuristic. The junk
hidden windows (Yelp-sourced, no start time, 0 offerings) get *superseded* by a fresh
first-party re-extract, not blessed. (This drops "Tier 2 promote-as-is" from the original
project sketch — it conflicts with the rule and the windows are usually junk anyway.)

## Architecture: one probe, three consumers

A single $0 plain-HTTP probe of the venue's own HH paths produces a verdict that is
**persisted on the venue** and reused by all downstream work — no re-probing.

```
probeOwnSiteHhPage(websiteUrl)
        │  ($0, plain HTTP GET over own-domain HH paths)
        ▼
  { hhPageUrl, status: 'readable' | 'blocked' | 'none' }
        │  persisted → venues.hh_page_url, venues.hh_probe_status
        ├──────────────┬───────────────────────────┐
        ▼              ▼                           ▼
 (A) orchestrator   (B) enrich priority      (C) admin manual queue
   re-extract         prefer own HH URL         pre-filled form, blocked-only
```

### Schema (one migration)

Add two nullable columns to `venues`:
- `hh_page_url text` — the own-site HH page the probe found (null if none).
- `hh_probe_status text` — `'readable' | 'blocked' | 'none'` (nullable = never probed).

Nullable + additive; no backfill required. Reused by B (priority URL) and C (queue
filter + form pre-fill source) so the probe runs once.

## Component A — Own-site HH-page probe + orchestrator

### `lib/places/ownSiteHhProbe.ts`

```
probeOwnSiteHhPage(
  websiteUrl: string | null,
  fetcher?: (url: string) => Promise<{ status: number; body: string }>,  // injectable for tests
): Promise<{ hhPageUrl: string | null; status: 'readable' | 'blocked' | 'none' }>
```

- Probes the HH-specific subset of `siteTriage.GUESS_MENU_PATHS`:
  `/happy-hour`, `/happyhour`, `/happy-hour-menu`, `/menu/happy-hour`, `/specials`
  on the venue's own origin. **$0** plain-HTTP GET (no API).
- Classify:
  - **`readable`** — a path returns 200 **and** the body carries an HH text signal
    (reuse `hhText.hasHhOrDealSignal` / `scoreHhUrl`). `hhPageUrl` = that URL.
  - **`blocked`** — a path 403s / anti-bot-walls (page exists but plain HTTP can't read
    it; the real extractor escalates to headless render). `hhPageUrl` = that URL.
  - **`none`** — all paths 404 / soft-404 / 200-without-signal. `hhPageUrl = null`.
- **Main-thread only** (env constraint: background subagents can't web-fetch). Fetcher is
  injectable so unit tests are hermetic.

### `scripts/promote-own-site-hh.ts` (`pnpm promote:own-site-hh`)

- Requires `--city <slug> --state <code>` (per [[project_scripts-require-state]]); optional
  all-cities mode when both omitted.
- Selects `data_completeness='stub'`, `status='active'`, not deleted, **has a website**,
  **no live HH** (mirrors `review:hidden`'s no-live-HH predicate).
- For each: `probeOwnSiteHhPage` → persist `hh_page_url` + `hh_probe_status` → route:
  - **`readable`** → `resolveVenue({ venueId, urls: [hhPageUrl], actor })` → free-first
    HTML parse then paid extractor → realness + provenance gate → **live** (source is
    first-party so provenance passes). Supersedes the old junk window via the canonical
    reconcile path.
  - **`blocked`** → still call `resolveVenue` (extractor escalates to render); if it
    **still** yields nothing usable, leave `hh_probe_status='blocked'` for the manual queue.
  - **`none`** → no-op.
- **`--dry-run`** = probe + persist verdict + report routing counts, **$0** (no extraction,
  no `resolveVenue`). Paid re-extract happens only on a real `--apply`/default run, so spend
  stays gated to operator go-ahead ([[feedback_google_discovery_cost_control]]).
- Writes a `docs/own-site-hh-promote-<date>.{md,csv}` summary (counts per status, per-venue
  routing + result), mirroring the existing review-report style.

## Component B — Bake own-site-HH priority into the recovery path

Push the venue's own confirmed HH page to the **front** of the priority-URL list passed to
`extractHappyHours`, ahead of `web_search` / aggregator hits, so the extracted window's
`source_url` is first-party and the provenance gate (PR #146) never hides it.

**Where this actually lives (refined during implementation):** the prepend is wired into
`scripts/reextract-stubs.ts`, threading the persisted `venues.hh_page_url` into `priorityUrls`
via a pure `prioritizeOwnSiteHh(priorityUrls, hhPageUrl)` helper. `seed:enrich` is
**intentionally NOT changed**: it processes brand-new `seed_candidates` that have no `venues`
row yet (no persisted probe verdict), and its triage already ranks the own-site `/happy-hour`
URL first — `siteVerdictFromFetch` runs `guessMenuUrls` + `rankCandidates`/`scoreHhUrl`, and
`scoreHhUrl` scores `happy-hour` highest. So enrich already prioritizes the own-site page; an
inline probe there would be redundant network I/O. The persisted-verdict prepend adds real
value only on the reextract path, where the probe has *confirmed* the page is readable and
pushes it ahead of triage's speculative guesses.

Scope: ordering only — no change to the extractor itself.

## Component C — Bot-walled → pre-filled manual entry form

New capability (none exists today — every write currently funnels through extraction). Gated
to **confirmed-unreadable** venues: `hh_probe_status='blocked'` **and** re-extract produced
nothing. Narrow, justified exception to "no manual venue patching" ([[feedback_no_manual_venue_patching]])
— that rule assumes a *readable* site; here the site is confirmed unreadable.

### Server action `createManualWindow`

```
createManualWindow(venueId, {
  daysOfWeek: number[],          // ISO 1..7
  startTime: string,            // venue-local HH:MM
  endTime: string | null,       // null = until close
  offerings: { name; priceCents?; currencyCode? }[],
  sourceUrl: string,            // the venue's own HH page (first-party)
}): Promise<ActionResult>
```

- Funnels through `persistExtractedWindows` for dedup / provenance / audit / reconcile, but
  inserts **`active=true`** — operator trust overrides the realness/lunch gates (mirrors the
  existing `review:hidden --apply` promote, except it *creates* a new window).
- Sets venue `data_completeness='complete'`, `last_verified_at=now()`; writes `audit_log`
  (`actor=admin`, reason "manual HH entry — unreadable site").
- Routes through the **apply engine** so cache invalidation fires → live on the site
  immediately. **Yes — operator-entered forms go live right away** (this answers the
  "is there a path to live" question: operator entry IS the verification).
- `source_url` is the venue's own HH page → first-party, never trips the provenance guard.

### UI — extend `/admin/stubs` Stub Resolver

The resolver already lists stubs-with-websites and does URL re-extract (`resolveStubAction`).
Extend it:
- Filter/sort `hh_probe_status='blocked'` venues to the top (the manual-entry queue).
- "Enter manually" mode opens a form **pre-filled** with name / address / website / phone /
  any existing hidden windows + offerings (so the operator edits, not re-types). Pre-filled
  `sourceUrl` = `hh_page_url`.
- Submit → `createManualWindow` → live.

## Out of scope (deferred follow-ups)

- **Trial-city paid rollout + measurement** (Phoenix / Tucson / SLO / Daly City): actually
  running the paid re-extract sweep, measuring promote rate, calibrating. Spends $ → its own
  go-ahead. This build ships the machinery + a `--dry-run` that's $0.
- Multi-location chain HH-page mapping (Pita Jungle shares one HH page across locations) —
  lower priority, left to manual entry for now.

## Testing

- **Unit — `ownSiteHhProbe`**: injected fetcher → assert classification for 200+signal
  (`readable`), 403 (`blocked`), 404 / soft-404 / 200-no-signal (`none`); HH page URL captured.
- **Unit — enrich priority ordering**: own-site HH URL ranks ahead of search/aggregator URLs.
- **Hermetic — `createManualWindow`**: writes through `persistExtractedWindows`, lands
  `active=true`, venue → `complete`, first-party `source_url`, audit row written, idempotent
  on re-submit.
- **No paid run** in this build — that's the deferred rollout. `--dry-run` validated against
  local PostGIS for $0.

## Build order

1. Migration (`hh_page_url`, `hh_probe_status`) + `ownSiteHhProbe` lib + unit tests.
2. `promote:own-site-hh` orchestrator script (dry-run first) + report.
3. Enrich priority bake (Component B) + unit test.
4. `createManualWindow` action + hermetic test.
5. `/admin/stubs` manual-entry UI (Component C).
