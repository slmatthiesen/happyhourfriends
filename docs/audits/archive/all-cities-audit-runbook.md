# All-cities data-quality audit — runbook

Sweep every live city for the two recurring data-quality problems and the general anomaly
set. **Phases 1–3 are FREE** (no Anthropic/Google API — deterministic over stored data).
**Phase 4 is PAID** (re-fetch + relevance-gated extraction) and is optional.

> Snapshot of findings (2026-06-09, before any sweep): **60 duplicate-day window groups**
> across all cities and **34 active venues with no neighborhood** (scottsdale 26, tucson 4,
> the rest 1 each). Re-run the diagnostics in each phase to get current numbers.

## Cities

| slug            | state |
| --------------- | ----- |
| tacoma          | wa    |
| tucson          | az    |
| phoenix-central | az    |
| scottsdale      | az    |
| spokane         | wa    |
| daly-city       | ca    |
| five-cities     | ca    |
| oakland         | ca    |

## Order matters

Run **Phase 2 (reconcile) before Phase 3 (audit:data)** — dedup the duplicate-day windows
first so the audit doesn't just re-flag them. Phase 1 (neighborhoods) is independent and can
run any time.

---

## Phase 1 — Missing neighborhoods (FREE, all cities in ONE command)

`backfill:neighborhoods` with no `--city` runs every city. It assigns each unassigned venue
to a neighborhood spatially (tight snap) + via the stored Google neighborhood name.
Idempotent. Venues genuinely outside any polygon (and with no Google neighborhood) correctly
stay `NULL` — that's by design, not a bug (we never guess wrong at a fringe).

```
pnpm backfill:neighborhoods
```

- **Revert lever:** `pnpm restore:neighborhoods` (restores from the `nb_snapshot` /
  `venue_nb_snapshot` tables).
- **Check coverage after:** `pnpm analyze:neighborhood-coverage --city <slug> --state <code>`.
- **Google names need critical mass (2026-06-09).** A venue's Google neighborhood name only
  wins over polygon assignment when ≥ `MIN_VENUES_PER_NEIGHBORHOOD` venues in the city share
  it; lone micro-names ("Motel District") fall through to polygon assignment, because the UI
  suppresses below-threshold neighborhoods and the venue would render blank despite being
  assigned. The coverage report prints a `UI-hidden` count for venues still in lone-venue
  neighborhoods (no containing above-threshold polygon — by-design suppression, not a bug).

---

## Phase 2 — Duplicate-day windows (FREE, per city)

`reconcile:windows` re-applies the deterministic window-reconcile gate to existing
`happy_hours` rows: merges exact-duplicate windows (keeps one row, **unions the days**,
soft-deletes the rest) and flips `active=false` on operating-hours / overlap-conflict
windows. **Never hard-deletes** (soft-delete = reversible).

This is the tool that collapses the duplicate-day groups (e.g. one venue with `Mon 4–6`,
`Tue 4–6`, … as separate rows → one row `Mon–Fri 4–6`).

**Dry-run first** (reports `X duplicate row(s) merged, Y window(s) hidden`):

```
pnpm reconcile:windows --city tacoma --state wa
pnpm reconcile:windows --city tucson --state az
pnpm reconcile:windows --city phoenix-central --state az
pnpm reconcile:windows --city scottsdale --state az
pnpm reconcile:windows --city spokane --state wa
pnpm reconcile:windows --city daly-city --state ca
pnpm reconcile:windows --city five-cities --state ca
pnpm reconcile:windows --city oakland --state ca
```

Then re-run each with `--apply` appended to write the merges.

---

## Phase 3 — Anomaly audit (FREE, per city)

`audit:data` scans stored data and writes flags to the `data_audit` table for review. Catches
the full anomaly set: `duplicate_windows`, `assumed_days_avoidable`, `overlapping_windows`,
`operating_hours_active`, `implausible_active`, `homepage_sourced_hh`.

```
pnpm audit:data --city tacoma --state wa
pnpm audit:data --city tucson --state az
pnpm audit:data --city phoenix-central --state az
pnpm audit:data --city scottsdale --state az
pnpm audit:data --city spokane --state wa
pnpm audit:data --city daly-city --state ca
pnpm audit:data --city five-cities --state ca
pnpm audit:data --city oakland --state ca
```

- `--recheck` re-scans venues already in `data_audit` (use after fixing the extractor/gate).
- `--emit-batches` also writes `docs/audit-batches/<slug>-<n>.md` for an in-session sniff-test.

> **Note — the audit does NOT currently flag "venue has no neighborhood."** `auditVenue`
> inspects happy-hour windows only. Missing neighborhoods are handled by Phase 1 + the
> coverage report, not `audit:data`. (If you want it surfaced inside the audit later, add an
> `unassigned_neighborhood` report-severity flag in `lib/audit/anomalyRules.ts`.)

---

## Phase 3b — Source provenance (FREE, all cities in ONE command)

`audit:provenance` finds LIVE windows whose `source_url` does NOT trace to the venue's own
website (the Depot Bar / Blanco failure mode — a sibling-brand domain, an aggregator, or a
social post). The read-only counterpart to the persist-time guard in
`lib/recover/sourceProvenance.ts`. **Omit `--city` to scan every city at once.**

```
pnpm audit:provenance                 # all cities → docs/audits/provenance-audit-<date>.{json,md,csv}
```

- Report only; nothing is changed. Suggested `action` is **hide** for every flagged window.
- Edit the `action` column: leave `hide` to hide it (active=false, non-destructive — stays
  for review, venue NOT deleted), or flip to `keep_live` for a FALSE POSITIVE (the source IS
  the venue's own domain variant / CDN / parent-group site). You only edit the keepers — the
  default hides.
- `venueLiveWindows = 1` means hiding that row leaves the venue with no public happy hour
  (it becomes a stub). That's the correct first-party-only tradeoff, but worth eyeballing.
- For a legit shared menu host that keeps getting flagged (e.g. a tap-list platform), add it
  to `MENU_HOSTS` in `lib/recover/sourceProvenance.ts` so the live persist gate stops
  flagging it on future writes.

```
pnpm audit:provenance --apply docs/audits/provenance-audit-<date>.csv
```

---

## Phase 4 — Corrections (PAID, optional, per city)

`audit:fix` re-fetches a flagged venue's own pages and applies a reversible correction.
**This is NOT the duplicate fix** — it re-fetches pages for *recall misses* (windows we
should have captured but didn't), and now routes through the Haiku relevance gate (a cheap
"is this a recurring happy hour?" content read) before any paid extraction. It will not merge
duplicates — that's Phase 2.

**Always `--estimate` ($0) first** to see the billable/relevance-gated/free buckets, then
`--preview` (writes a review report, no DB change), then apply from the cached JSON:

```
pnpm audit:fix --city <slug> --state <code> --escalate-paid --estimate
pnpm audit:fix --city <slug> --state <code> --escalate-paid --preview
pnpm audit:fix --city <slug> --state <code> --escalate-paid --apply-from docs/audit-escalation/<slug>-<date>.json
```

Cost reference: tightened Oakland escalation ran ~$0.21 for 11 venues; the relevance gate
keeps wasted extractions off the bill (HTML junk pages → Haiku skip; only real HH leads pay).

---

## Phase 5 — Quality curation (FREE, per city, DESTRUCTIVE)

`audit:quality` scores every venue against the "20-40 metropolitan, appetizer + a drink" bar
and suggests dropping venues with **no live happy hour AND** (no alcohol evidence anywhere OR
a confidently-bad site). Read-only report; re-fetches each venue's own pages over plain HTTP
($0, no API). Run this **LAST** — after stub recovery (Phase 4 / `reextract:stubs:free`) so
you don't drop a venue a cheap re-extract would have filled.

```
pnpm audit:quality --city <slug> --state <code>   # → docs/audits/quality-audit-<city>-<date>.{json,md,csv}
```

- Edit the `verdict` column to exactly `drop?` / `keep` / `review` (any other value aborts
  the apply before touching the DB). Only `drop?` rows act; each keeps its `venueId`.
- `--apply` **soft-deletes** every `drop?` venue (deactivates its happy_hours + sets
  `deleted_at` + audit_log) — reversible, same as `remove:venues`. **Review the CSV first**:
  a `live`-site drop means "we read the site and found no alcohol wording", which can be a
  false drop for a sit-down restaurant that has a bar.

```
pnpm audit:quality --apply docs/audits/quality-audit-<city>-<date>.csv
```

---

## Quick free-only sweep (copy/paste)

Neighborhoods + duplicate dedup (apply) + anomaly flagging + provenance, all free:

```
pnpm backfill:neighborhoods
for c in "tacoma wa" "tucson az" "phoenix-central az" "scottsdale az" "spokane wa" "daly-city ca" "five-cities ca" "oakland ca"; do set -- $c; pnpm reconcile:windows --city $1 --state $2 --apply; done
for c in "tacoma wa" "tucson az" "phoenix-central az" "scottsdale az" "spokane wa" "daly-city ca" "five-cities ca" "oakland ca"; do set -- $c; pnpm audit:data --city $1 --state $2; done
pnpm audit:provenance   # all cities in one shot → edit actions → --apply
```

> Provenance and the Phase-5 quality curation produce report files you edit before `--apply`
> — they are not part of the unattended sweep above. `review:hidden` and `review:meal-specials`
> likewise each generate their own report → edit → apply cycle (all cities when run bare).

(Run the dry-run `reconcile:windows` without `--apply` first if you want to eyeball the merge
counts before writing.)
