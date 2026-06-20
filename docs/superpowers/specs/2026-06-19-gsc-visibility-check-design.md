# GSC Search-Visibility Check — Design

**Date:** 2026-06-19
**Branch:** `feat/gsc-visibility-check`
**Status:** approved design, pending spec review

## Problem

We show up in Google search for queries we can't currently see. When someone clicks
through, we don't know whether the entry they land on actually answers what they searched
for. A stub venue page ranking for "happy hour times" is a bad result we're blind to.

Goal: pull what's getting **impressions** in Google Search Console, AI-check that each
landing entry is a good answer for the queries that found it, and bubble up the bad ones so
the operator can fix or re-extract them.

Explicit non-goals (considered and dropped):
- **Demand mapping / city-expansion ranking** — out of scope; this verifies entries we
  already surface, it does not find new markets.
- **Auto-fixing** — v1 bubbles up only. Auto-running `reextract` on clear stubs is a
  follow-up once the operator trusts the output.

## Why query-aware QA (vs. a generic data audit)

GSC gives the **query** that earned each impression. So the check isn't just "is this
venue's data complete?" — it's "does this page answer *what the person searched for*?"
Searched "happy hour times" → landed on a stub = bad. Searched "[bar] happy hour" → landed
on a venue with real windows = good. The query is the signal a plain audit can't use.

## Shape: thin script + scheduled routine

Two pieces, split along "deterministic data work" vs "AI judgment + notify":

### 1. `pnpm gsc:pull` — the only new code

Deterministic, `$0`, version-controlled, unit-testable. Steps:

1. **Auth** — service account JSON key (path in `.env`), scope
   `https://www.googleapis.com/auth/webmasters.readonly`.
2. **Query** the Search Analytics API: property from `.env`, last **28 days** (flag:
   `--days`), dimensions `[page, query]`, ordered by impressions. Row cap configurable
   (flag: `--limit`, default e.g. 1000).
3. **Resolve** each landing `page` URL → our route + entity:
   - `/[state]/[city]/venue/[slug]` → load via `getCityByPath` + `getVenueBySlug`; attach
     status: **stub** (no live `happy_hours` windows) / **has-windows** / **live**, plus
     window/offering counts.
   - `/[state]/[city]` and `/[state]/[city]/[neighborhood]` → tag as city/neighborhood
     page (reported, not deep-verified in v1).
   - anything else (home, /about, /faq, …) → tag as static (reported, skipped).
4. **Emit** a compact report to a known path (e.g. `tmp/gsc-report.json` + a sibling
   `.md`): per page → top queries, impressions, clicks, resolved entity, status, counts.
   Sorted by impressions desc.

The script does **no AI**. It is the seam that keeps the routine from re-doing auth/DB work
every run.

#### Provider abstraction

Per repo convention, hide GSC behind a small interface (e.g. `lib/gsc/client.ts` with a
`SearchAnalyticsClient` type and a `googleSearchConsoleClient` factory) so the data source
can be swapped (or faked in tests) without touching the resolver/report code.

### 2. The routine (via the `schedule` skill)

- **Cadence:** weekly. (Low-traffic site; search data moves slowly — daily would be noise.)
- **Each run:**
  1. run `pnpm gsc:pull`
  2. read the report
  3. for each venue page with impressions, judge natively (no prompt file / no ledger —
     the agent is the verifier): verdict ∈ `good` | `stub-with-demand` | `incomplete` |
     `looks-wrong`, with a one-line reason tied to the query.
  4. **bubble up**: message the operator the flagged entries — query, impressions,
     resolved venue, reason, and the suggested `reextract` command. No writes to data.

v1 = bubble-up only. No auto-`reextract`, no prod writes (matches "operator handles prod
deploys" and "no promote-from-guessing").

## Data flow

```
GSC API ──auth(service acct)──▶ gsc:pull ──resolve page→venue──▶ report (json+md)
                                                                      │
                                                          weekly routine reads it
                                                                      │
                                          AI verdict per venue page (good/…/looks-wrong)
                                                                      │
                                                    bubble up flagged → operator message
```

## Components & boundaries

- `lib/gsc/client.ts` — auth + Search Analytics fetch behind an interface. Input: query
  params. Output: raw rows `{page, query, impressions, clicks, position}`. Dep: googleapis
  (or direct REST + google-auth-library).
- `lib/gsc/resolvePage.ts` — pure: URL → `{kind, cityPath?, slug?}`. No I/O; unit-testable
  with URL fixtures.
- `scripts/gsc-pull.ts` — orchestrates: client → group by page → resolve → enrich venue
  status via existing `lib/queries/venues.ts` → write report. Wired as `pnpm gsc:pull`.
- The routine — defined via the `schedule` skill; references `pnpm gsc:pull` and the report
  path. Owns the AI judgment + notification.

## Error handling

- Missing/invalid `.env` creds → fail loud with the exact var names and a pointer to the
  setup steps below. Never silently emit an empty report.
- Auth/API failure → non-zero exit, clear message; routine reports the failure rather than
  a false "all good".
- Property has no data yet (newly verified) → empty result is reported explicitly as
  "0 impressions in window", not an error.
- A page URL that resolves to no venue (deleted/renamed slug) → reported as `unresolved`,
  not crashed.

## Testing

- `lib/gsc/resolvePage.ts` — unit tests over URL fixtures (venue / city / neighborhood /
  static / unresolved).
- `scripts/gsc-pull.ts` — hermetic test with a faked `SearchAnalyticsClient` returning
  fixture rows + a seeded/stub venue, asserting the report groups, resolves, and tags
  status correctly. No network.
- No live API call in CI (auth-gated, costs nothing but needs creds).

## One-time setup (operator)

Google Cloud Console:
1. Create/select a project.
2. APIs & Services → Library → enable **Google Search Console API**.
3. APIs & Services → Credentials → Create Credentials → **Service account** (`gsc-reader`).
4. Service account → Keys → Add key → **JSON** → download to a path outside the repo
   (e.g. `~/.config/hhf/gsc-sa.json`).
5. Copy the service-account email.

Search Console (search.google.com/search-console):
6. Select the `happyhourfriends.com` property → Settings → Users and permissions →
   Add user → paste the service-account email → **Restricted** (read-only) → Add.

`.env`:
```
GSC_SERVICE_ACCOUNT_KEY_PATH=/Users/stevenmatthiesen/.config/hhf/gsc-sa.json
GSC_PROPERTY=sc-domain:happyhourfriends.com   # or https://happyhourfriends.com/ for URL-prefix
```

Notes: GSC data lags ~2–3 days (28-day window unaffected); property must be verified and
collecting data; `.env.example` gets both vars documented.

## Open follow-ups (not v1)

- Auto-`reextract` on clear `stub-with-demand` verdicts.
- Deep-verify city/neighborhood pages (coverage gaps), not just venue pages.
- Switch the AI step to a pinned `/prompts/` template + ledger if it graduates from a
  routine into the standing pipeline.
