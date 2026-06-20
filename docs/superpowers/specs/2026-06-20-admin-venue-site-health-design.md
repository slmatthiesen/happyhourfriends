# Admin venue site-health queue — auto-suggested URL fixes + one-click prod publish

**Date:** 2026-06-20
**Status:** Design — awaiting operator review
**Goal:** Make broken venue website URLs a self-serve admin workflow. Operator opens one
page, sees every venue whose stored `website_url` is broken, accepts a pre-computed fix
(or edits/removes), and the change publishes to prod in one click — no SQL, no SSH.

## Why

The `audit:venue-sites` probe found 43 broken links across just 10 cities; this recurs every
city. Today the fix path is: read the JSON report → research each URL → hand-write guarded
SQL → scp + psql on the droplet → curl the revalidate endpoint. That does not scale.

The plumbing to push a single venue to prod already exists: `publishVenue` (lib/sync/dbSync.ts)
PK-upserts the **full** venue row — so `website_url` edits and `deleted_at` soft-deletes both
propagate through it — and `publishVenueToProd` already wraps it for the `/admin` Apply actions.
Public read queries already filter `isNull(venues.deletedAt)`. The missing pieces are: (1) no
action to edit a URL, (2) `deleteStubVenueAction` soft-deletes locally but never publishes, and
(3) no admin surface that shows the broken set or suggests fixes.

## Decisions locked

- **Surface:** new `/admin/site-health` page (Approach C). The broken set isn't visible in any
  existing admin page, and most broken-URL venues are *live*, not stubs, so `/admin/stubs`
  wouldn't cover them.
- **Auto-suggest:** a deterministic resolver pre-fills a corrected URL for one-click accept.
  ~half of the 43 were pure `www`/protocol/redirect breakage — fixable with zero research.
- **Removal model:** soft-delete (existing `venues.deletedAt`), reversible via the audit log.
  No hard-delete.
- **Persist health on the venue** (new columns) so the page is a trivial query and the
  suggestion is precomputed by the audit, not recomputed on page load.

## Components

### 1. Deterministic URL resolver — `lib/places/resolveWebsiteUrl.ts`
- **Input:** stored `website_url`, an injectable async probe fn (real fetch in prod, stub in tests).
- **Candidate generation (pure):** from the stored URL, derive variants — toggle `www.` host
  prefix, upgrade `http`→`https`, and the final URL after following redirects to a stable host.
  De-dupe; never include the original broken URL.
- **Selection:** probe each candidate (browser-like UA); classify via existing
  `lib/places/siteHealth.ts`; return the **first** candidate whose health is `ok` (HTTP 200 +
  valid TLS). Skip any candidate on the first-party-guard denylist (no competitor/aggregator
  domains).
- **Output:** `{ suggestedUrl: string | null, reason: string }`.
- **Pure core** (candidate-gen + selection) is unit-tested with a mocked probe; the network
  probe is the only impure dependency.

### 2. Health persisted on venues — migration + schema
New nullable columns on `venues`:
- `site_health` text — last probe result (`ok` / `expired_cert` / `invalid_cert` / `dns_dead` /
  `unreachable` / `http_error` / `parked` / `blocked` / null=never checked).
- `site_health_detail` text — human-readable reason.
- `site_health_suggested_url` text — resolver output (null = no working variant found).
- `site_health_checked_at` timestamptz.

These ride along harmlessly through `publishVenue` (full-row upsert); no sync changes needed.

### 3. Audit script extension — `scripts/audit-venue-sites.ts`
Add `--persist` flag: for each probed venue write `site_health`/`site_health_detail`/
`site_health_checked_at`; for broken ones, run the resolver and store `site_health_suggested_url`.
Keep the existing JSON report output. Still `$0` (probing is free; resolver adds a few cheap
probes per broken venue only). Default run stays read-only/JSON-only; `--persist` opts into DB writes.

### 4. Admin page — `app/admin/site-health/page.tsx` (server component)
Query: venues where `site_health NOT IN (null,'ok','blocked')` AND `deleted_at IS NULL`,
worst-first (dns_dead/expired before unreachable). Each row renders `<VenueWebsiteEditor>` with
name, city/state, current URL, detected problem + detail, last-checked, and the suggestion.
Page header notes how to refresh the data (`pnpm audit:venue-sites --persist`).

### 5. Reusable control — `components/admin/venue-website-editor.tsx` (client)
Props: `venueId`, `currentUrl`, `suggestedUrl`, `problem`. Renders:
- "Suggested: <url> **[Accept]**" when a suggestion exists.
- Editable input + **Save** (manual override).
- **Remove venue** (soft-delete) with a confirm.
Optimistic update; shows a toast on a publish warning. Droppable later onto `/admin/stubs`
and `/admin/reviews`.

### 6. Server actions — `app/admin/actions.ts`
- `updateVenueWebsiteAction(venueId, url | null)` — validate (http(s) URL or null to clear;
  reject denylisted domains) → audit-log before/after `website_url` → update local row →
  re-probe to refresh that row's `site_health` → `publishVenueToProd(venueId)` →
  `revalidatePath('/admin/site-health')`. Returns `{ ok, warning? }`; on prod-publish failure
  returns a warning (local change kept), mirroring `revertAction`.
- `acceptSuggestedUrlAction(venueId)` — reads stored `site_health_suggested_url`, delegates to
  `updateVenueWebsiteAction`.
- **Fix** `deleteStubVenueAction` — after the local soft-delete, call `publishVenueToProd(venueId)`
  with the same warning handling, and `revalidatePath('/admin/site-health')`. (Works for any
  venue, not just stubs.)

## Data flow

```
pnpm audit:venue-sites --persist
  → probe every live venue → siteHealth.classify → write site_health* columns
  → broken venues → resolveWebsiteUrl → write site_health_suggested_url

operator opens /admin/site-health
  → Accept suggestion / Save manual URL / Remove
  → server action: audit-log + local write + re-probe + publishVenueToProd(venueId)
  → publishVenue upserts full row to prod (website_url or deleted_at)
  → revalidate admin path; prod public cache busts via the publish path
```

## Error handling
- Invalid URL → action returns error; row shows it inline, no write.
- Prod publish fails → local change is kept; row shows a "applied locally, prod pending — retry"
  warning (same posture as `revertAction`). Retry re-runs the action.
- Resolver finds no working variant → no suggestion; operator edits manually or removes.
- Denylisted (competitor/aggregator) domain → rejected in both resolver suggestions and manual save.

## Testing
- **Unit (resolver):** candidate generation (www/protocol/redirect variants, de-dupe, exclude
  original), selection picks first `ok`, skips denylisted, returns null when all broken — mocked probe.
- **Existing:** `siteHealth` already has hermetic tests; keep green.
- **Action:** thin hermetic test that `updateVenueWebsiteAction` writes the audit row and invokes
  the publish wrapper (publish mocked).
- **Manual QA:** `audit:venue-sites --persist` on local → open `/admin/site-health` → accept a
  suggestion → confirm local row updated and a dry-run publish succeeds.

## Out of scope (YAGNI)
- "Accept all suggestions" batch button (add later if the queue is large).
- Separate health table or scheduled/cron auto-audit.
- Hard-delete; CLI verb (operator chose the admin UI as the driver).
```
