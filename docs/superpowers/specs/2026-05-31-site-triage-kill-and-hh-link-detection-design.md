# Site triage — kill dead listings, follow HH-signal links

**Date:** 2026-05-31
**Branch:** `cluster-schema-seed-pipeline`
**Status:** design — approved pending spec review

## Problem

The seed enrich pipeline (`scripts/seed-enrich-candidates.ts`) creates a venue for
*every* candidate that passes the alcohol gate — either `complete` (HH found) or a
`stub` (no HH found, `data_completeness='stub'`). Stubs sit at the bottom of the city
page as "help wanted" crowdsource targets.

Two problems the operator found while hand-reviewing `docs/phoenix-stub-hh-review.md`:

1. **Dead-listing noise.** Many stubs have no real website — no site on file, a dead
   domain (404 / DNS fail), or a parked "domain for sale" page. There's nothing to
   crowdsource and nothing for the extractor to read. These should be **killed**, not
   stubbed.
2. **Extractor whiffs on valid sites.** Venues that *do* have a happy hour usually
   advertise it in their nav — a `/happy-hour` link, a `#happyhour` anchor, a
   `beer-menu` / `drink-menu` / `/specials` page. The extractor often gets only the
   homepage URL and misses the dedicated page. The operator can "tell almost
   immediately when landing on a page" whether it'll have a happy hour, using exactly
   these signals.

## Sacred principle (do not violate)

**We kill only on an invalid *site*, never on "no HH found."** A valid, reachable site
where the extractor finds no times stays a **stub** — that is the recall-gap safety net
documented in `[[project_extractor_misses_all_day_specials]]` and
`[[stub-discovery-exclusion-wrong-lever]]`. The extractor has known recall gaps
(all-day weekday specials, etc.), so "extractor found nothing" ≠ "venue has no happy
hour." This design must not regress that. 

## Decisions (from brainstorming)

- **Kill set:** no real website, dead/unreachable site, parked/placeholder domain.
- **Keep-as-stub set:** social/ordering-only links (Facebook, Instagram, Linktree,
  DoorDash, Toast/SpotOn ordering, etc.) — valid crowdsource targets. Many
  high-likelihood Phoenix sports bars are FB-only; do **not** kill them.
- **HH-signal links** are used two ways: (a) point the extractor at them (recall), and
  (b) protect the venue from any future kill heuristic (a site that signals HH is
  "valid + promising" even if extraction returns zero windows).
- **No-site venues** (American Way Pasta case — no site on file, but a real HH site
  exists if you search): kill + list in a "recognize any of these?" report section for
  manual rescue **unless** the venue's HH-likelihood is **> 50%**, in which case attempt
  to find/extract before killing ("go for it"). Likelihood comes from a venue-type prior
  (below).
- **Scope:** both forward (pipeline) and retroactive (one-time cleanup of existing stubs).
- **Retroactive safety:** dry-run by default; deletions only with explicit `--apply`.
- **Kill audit:** every kill is written to a reviewable report — the operator's
  false-positive safety net and rescue queue.

## Components

### 1. `lib/places/hhLikelihood.ts` (new) — venue-type HH prior

A committed venue-type → P(happy hour) lookup, reconstructed from the priors that drove
`docs/phoenix-stub-hh-review.md` (the original generator was ad-hoc and never committed).
Approximate anchors from that doc:

| Venue type (examples)                         | Prior                                                      |
| --------------------------------------------- | ---------------------------------------------------------- |
| sports_bar / sports cantina / sports grill    | ~0.62                                                      |
| bar / tavern / pub / brewery / gastropub      | ~0.56–0.61                                                |
| american / new-american / eclectic restaurant | ~0.57                                                      |
| italian / pizzeria (full-service)             | ~0.56                                                      |
| cocktail_lounge / wine_bar                    | ~0.29–0.41                                                |
| mexican / latin                               | ~0.33                                                      |
| pizza (counter)                               | ~0.32                                                      |
| sushi / japanese                              | ~0.17–0.19                                                |
| bbq                                           | ~0.14                                                      |
| chinese                                       | ~0.08                                                      |
| seafood / mariscos                            | ~0.07                                                      |
| thai / vegan / cafe / specialty               | ~0.0                                                       |
| unknown / no type signal                      | `null` (treated as below threshold for the no-site gate) |

API:

```ts
export function hhLikelihood(input: {
  venueType?: VenueType | null;
  primaryType?: string | null;   // Google primary type
  types?: string[] | null;
  name?: string | null;          // name-keyword nudge (e.g. "cantina", "sports")
}): number | null;               // 0..1, or null when we genuinely can't judge
```

Resolution order: derived `VenueType` (via `deriveVenueType`) → Google primary type →
name keywords → `null`. Pure, unit-testable, no I/O. Scales to every city
(`[[feedback_scalable_not_one_off]]`).

### 2. `lib/places/siteTriage.ts` (new) — classify a candidate's web presence

```ts
export type SiteKind = "real" | "social_only" | "none";
export type Reachability = "ok" | "dead" | "parked";

export interface SiteVerdict {
  kind: SiteKind;
  url: string | null;            // best real first-party URL, or null
  reachability: Reachability | null;  // only meaningful when kind === "real"
  hhSignalUrls: string[];        // resolved absolute HH/menu links found on the page
  decision: "extract" | "stub" | "kill";
  reason: string;                // human-readable, for the audit report
}

export async function triageSite(input: {
  websiteUri: string | null;
  name: string;
  cityName: string | null;
}): Promise<SiteVerdict>;
```

Logic:

1. **Classify URL.**
   - empty/null → `kind:"none"`.
   - host in `SOCIAL_OR_ORDERING_HOSTS` (facebook, instagram, linktr.ee/linktree,
     doordash, ubereats, grubhub, toasttab, spoton, orders.co, `*.mobile-webview*`,
     square.site ordering, etc.) → `kind:"social_only"`.
   - otherwise → `kind:"real"`, candidate URL.
2. **Probe reachability** (real only) with a plain Node `fetch` — HEAD, fall back to GET;
   ~5 s timeout; desktop User-Agent; follow redirects. This is a Node fetch in a `tsx`
   script, **not** a Claude tool, so it is permitted (see env constraints in CLAUDE.md).
   - network error / DNS failure / connection refused / timeout / HTTP 404–410 / 5xx →
     `reachability:"dead"`.
   - HTTP 200 whose HTML matches **parked-page heuristics** (known parking hosts/markers:
     Sedo, Bodis, GoDaddy parking, "this domain is for sale", "buy this domain",
     near-empty body) → `reachability:"parked"`.
   - else → `reachability:"ok"`.
   - Note: a 403 is treated as `ok` (bot-blocking ≠ dead); the AI extractor renders it.
3. **Link-scan** (real + ok only) the fetched HTML for HH-signal hrefs and anchor text:
   `happy-hour`, `happyhour`, `happy_hour`, `/specials`, `(beer|drink|cocktail|wine|food) .*menu`, `/menus`. Resolve to absolute URLs, dedupe, cap (e.g. first 5).
4. **Decision:**
   - `none` → `kill` (reason `no site on file`) — *the caller may override to `extract`
     when likelihood > 0.5; see §4*.
   - `social_only` → `stub` (reason `social/ordering link only`).
   - `real` + `dead` → `kill` (reason `dead site`).
   - `real` + `parked` → `kill` (reason `parked domain`).
   - `real` + `ok` → `extract` (reason `reachable`; carries `hhSignalUrls`).

Static HTML covers the Squarespace/Wix/WordPress sites most restaurants use. If a site's
nav is JS-only the scan finds no signals, but that costs us nothing: a reachable site is
never killed, and the AI extractor (Claude server-side `web_fetch`) still renders JS and
follows links on its own. The scan is purely additive recall.

### 3. Extractor recall — `priorityUrls`

`lib/ai/extractHappyHours.ts`: `ExtractInput` gains optional `priorityUrls?: string[]`.
When present, the prompt instructs the model to `web_fetch` those URLs **first** (they're
the venue's own HH/menu pages) before considering the homepage. `prompts/seed-extract-hh.md`
gains a `{{priority_urls}}` placeholder rendered as a bullet list (or "none"). No schema
change. This is the direct fix for "extractor whiffs on the homepage."

### 4. Pipeline integration — decision matrix

In `seed-enrich-candidates.ts`, replace the unconditional `persistExtraction` with a
triage-driven flow, applied in **both** the on-demand loop and the `--batch` prep path:

| Triage decision                     | Likelihood gate                    | Action                                                                                                                  |
| ----------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `extract` (real+ok)               | —                                 | run extractor with `priorityUrls`; HH→`complete`, none→`stub`                                                   |
| `social_only`                     | —                                 | write `stub` (no AI)                                                                                                  |
| `kill` reason `dead`/`parked` | —                                 | **kill**: mark candidate `killed_no_site`, no venue, log to report                                              |
| `kill` reason `no site`         | likelihood ≤ 0.5**or** null | **kill**: as above, logged under "no site — recognize any?"                                                      |
| `kill` reason `no site`         | likelihood > 0.5                   | **go for it**: run extractor with name+city (its `web_search` finds the site); HH→`complete`, none→`stub` |

"Valid site, extractor found 0 windows" remains a **stub** in every case — only the three
kill rows above delete/skip. Stubs whose triage surfaced `hhSignalUrls` are flagged
`promising` in the report.

New `seed_outcome` enum value **`killed_no_site`** (migration `0006_*`, additive enum
value only). Killed candidates are marked `processed_at` so they never re-create a venue.

### 5. Kill audit report

Every kill (forward or retroactive) is collected and written to
`docs/<city>-killed-venues.md`, same table style as the review doc, grouped by reason:

```
## Killed: dead / parked sites (N)
| Venue | Neighborhood | Reason | URL tried | Likelihood |
...
## No site on file — recognize any of these? (N)   ← manual rescue queue
| Venue | Neighborhood | Likelihood | (was it > 50%? then we already tried) |
```

The forward pipeline appends a run-stamped section; the retroactive script writes a full
fresh report.

### 6. Retroactive cleanup — `scripts/triage-stub-sites.ts`

```
tsx scripts/triage-stub-sites.ts --city phoenix [--limit N] [--apply]
```

Loads `data_completeness='stub'` venues for the city, runs `triageSite` on each, and:

- **kill** → (with `--apply`) delete the venue row; otherwise just report. **Guarded:** a
  stub is only deletable when it has zero attached `happy_hours`, `edit_submissions`,
  `flags`, `promotions`, and `audit_log` references. If any exist, skip the delete and
  note it in the report (never destroy human/community work).
- **promising** (`hhSignalUrls` present) → re-run the extractor pointed at those URLs;
  if HH now appears, upgrade `stub`→`complete` (writes `happy_hours`/`offerings` with
  source URLs via the same `persistExtraction` path).
- **else** → leave as `stub`.

**Dry-run by default**: no writes, report only. `--apply` performs deletes + upgrades.
Always emits `docs/<city>-killed-venues.md`.

## Files touched

- `lib/places/hhLikelihood.ts` — **new** (venue-type HH prior + unit tests).
- `lib/places/siteTriage.ts` — **new** (URL classify + reachability probe + link-scan).
- `lib/ai/extractHappyHours.ts` — add `priorityUrls` to `ExtractInput` + request build.
- `prompts/seed-extract-hh.md` — `{{priority_urls}}` placeholder (prompt version bump).
- `scripts/seed-enrich-candidates.ts` — triage-driven decision matrix (on-demand +
  batch prep), report append, `killed_no_site` outcome.
- `scripts/triage-stub-sites.ts` — **new** retroactive pass.
- `db/migrations/0006_*.sql` — add `killed_no_site` to `seed_outcome` enum.
- `package.json` — `triage:stubs` script entry.

## Out of scope (YAGNI)

- Automated web-search-to-find-site for the **low-likelihood** no-site tail (only the
  > 50% gate runs it; the rest go to the manual rescue report).
  >
- Any change to discovery-stage gates (`chainDenylist.ts`) — triage is an enrich-stage
  concern. Discovery excludes stay as-is.
- Re-scoring/ranking the live site UI. The likelihood model is used only for the no-site
  gate and the report column for now.

## Testing

- `hhLikelihood`: unit table — known types map to expected bands; unknown → null.
- `siteTriage`: unit tests with fixture HTML (parked page, real page with `/happy-hour`
  link, FB-only URL, empty URL); reachability probe mocked.
- Decision matrix: a small harness asserting each row maps to the right outcome.
- Manual: `tsx scripts/triage-stub-sites.ts --city phoenix` (dry-run) and eyeball
  `docs/phoenix-killed-venues.md` before any `--apply`.
- `npm run typecheck`, `eslint`, `npm run build` clean (modulo the 2 pre-existing Phase 0
  lint issues).
