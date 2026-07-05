# Silicon Valley — onboarding review (2026-06-29)

**100 venues with live happy hours** across a 9-municipality South Bay / Peninsula metro,
onboarded end-to-end. City is `status='discovery'` (invisible) pending your go-live flip.

## Scope

Aggregate city `silicon-valley` (one row, `five-cities` pattern). Membership enforced by a
merged 9-relation boundary (`data/silicon-valley-boundary.geojson`) + `serviceLocalities`:

Palo Alto · Mountain View · Sunnyvale · Santa Clara · Cupertino · Los Altos · Los Altos
Hills · **Menlo Park** · **Campbell** (+ Stanford as a locality). San Jose deliberately
excluded (its own future scope). Menlo Park (San Mateo County, Meta HQ) is claimed here, so
a future Peninsula market won't double-claim it (global `google_place_id`).

## Results

| Metric | Value |
|---|---|
| Total venues | 523 |
| **Venues with live happy hours** | **100** |
| Stubs (help-wanted) | ~410 (high stub rate is inherent — crowdsourced post-launch) |
| Neighborhood coverage | **99.8%** (18 OSM neighborhoods + 6 cardinal districts) |
| Candidates discovered | 699 |

### Venues / live-HH by municipality

| City | Venues | Live HH |
|---|---|---|
| Palo Alto | 105 | 26 |
| Sunnyvale | 93 | 14 |
| Mountain View | 74 | 19 |
| Santa Clara | 72 | 9 |
| Cupertino | 53 | 6 |
| Los Altos (+ Hills) | 41 | 4 |
| Campbell | 36 | 9 |
| Menlo Park | 24 | 8 |

(A few border venues address-labeled San Jose / Redwood City / Los Gatos sit inside the
polygon+500m buffer — expected; the polygon is authority over unreliable mailing city.)

## How it was built

1. **Discovery** (Google, run once): 219 adaptive Nearby tile fetches + 30 "happy hour"
   Text-Search recall calls → 590 candidates. Out-of-scope neighbors dropped by polygon:
   San Jose 246, Menlo Park*/Campbell* (later re-included), etc. (`*` before expansion).
2. **Expansion** (operator decision): boundary widened 7→9 (added Menlo Park + Campbell),
   then **recall-only** passes recovered HH venues without re-billing the core —
   core resume-recall (31 calls → 93 candidates) + MP/Campbell recall (30 calls → 16) → 699.
3. **Enrich** (`--batch`, free-first): 590 + 109 candidates → venues; AI cost ledgered below.
4. **Gates:** window-reconcile regate (promote/demote stale) + combo-cuisine drop (removed
   9 food-combo non-HH windows: P.F. Chang's, Dumpling Time, Mikiya, Taro San).
5. **Neighborhoods:** OSM import (18 polygons) → tiers → cardinal districts (clipped to the
   9-city boundary) → 99.8% coverage.

## Cost

| Item | Cost |
|---|---|
| Google discovery (Nearby + recall, unledgered) | ~$10.0 |
| Core resume-recall (31 calls) | ~$1.24 |
| Menlo Park / Campbell recall (30 calls) | ~$1.20 |
| Enrich AI (ledgered, `ai_usage_ledger`) | **$5.42** |
| **Total** | **~$17.9** |

Calibration note: the `onboard --estimate` enrich line ("$0–0.15/city") badly undersells a
600+ candidate metro — trust the ledger ($5.42), not that line, for big cities.

## Needs your review (`/admin/reviews`)

- ~26 **hidden windows** captured but not auto-promoted (no explicit HH evidence / plausible
  but unconfirmed times) across both enrich passes.
- 2 **regate review rows** left hidden (plausible time, no HH wording) for confirm/reject.
- Spot-check the border venues (San Jose ×4, Redwood City ×6, Los Gatos ×2) if you want them
  in or out — they're geographically in-area but address-labeled to neighbors.

## Optional follow-ups

- `--resume-recall --hh-recall-only` would drill the remaining unvisited recall regions
  (2 core + 12 MP/Campbell) for more HH anchors (~$0.5–1).
- A full Nearby sweep of Menlo Park / Campbell would add more *stubs* (low value; they got
  recall-only, which targets HH venues directly).

## Operator-only (not done by the agent)

- Review the hidden items above.
- Flip `status='live'` and run the prod data sync. **The agent never touches prod or
  flips a city live.**
