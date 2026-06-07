# Operator cheat sheet

Quick reference for the scripts you actually run. Everything uses `pnpm`. Local DB must be
up (`docker compose up -d`) for anything that touches the database.

**City slugs:** `tacoma` · `tucson` · `phoenix-central` · `scottsdale` · `daly-city` · `five-cities`

---

## 1. Fill stubs from their own HTML — FREE ($0, no API)

Reads each stub's site, deterministically parses happy hours, fills the confident ones,
hides the iffy ones for review, and shortlists the rest for paid extraction.

```bash
# Dry-run a single city (no writes, no spend) — see filled/hidden/escalate/no-signal:
pnpm tsx scripts/reextract-stubs-free.ts --city scottsdale

# Actually write the confident ones (audited, reversible):
pnpm tsx scripts/reextract-stubs-free.ts --city scottsdale --apply

# Bounded sample while you eyeball it:
pnpm tsx scripts/reextract-stubs-free.ts --city tucson --limit 30
```

**Refresh ALL cities** (dry-run first, then apply):

```bash
# Dry-run everything:
for c in tacoma tucson phoenix-central scottsdale daly-city five-cities; do
  echo "=== $c ==="; pnpm tsx scripts/reextract-stubs-free.ts --city "$c"
done

# Apply everything (after you're happy with the dry-run):
for c in tacoma tucson phoenix-central scottsdale daly-city five-cities; do
  echo "=== $c ==="; pnpm tsx scripts/reextract-stubs-free.ts --city "$c" --apply
done
```

Output buckets per run: `filled → live` (shown), `captured hidden (stub)` (written
`active=false` for your review — venue stays a stub), `escalated (→ paid)`, `no signal`.
The escalate list is written to `docs/hh-escalation-<city>.json`.

**Verify precision BEFORE `--apply`** — see exactly which windows would go live, with the
source URL + evidence snippet so you can confirm each is a real happy hour (not menu/operating
hours). Read-only, $0:

```bash
pnpm tsx scripts/spotcheck-free.ts --city scottsdale            # lists every LIVE window + evidence
pnpm tsx scripts/spotcheck-free.ts --city scottsdale --show-review   # also list the hidden ones
```

A window only goes **live** when the literal "happy hour" sits next to its time; deal-word /
menu / operating-hours matches are kept hidden for review. (Validated: Tacoma went from 20
live @ ~80% false-positive to 5 live @ 100% real.)

---

## 2. Paid escalation — Anthropic (costs money; get a $ estimate first)

For the venues the free pass shortlisted (real HH signal, no clean deterministic parse).

```bash
# Dry-run (triage only, $0) to see how many qualify:
pnpm tsx scripts/reextract-stubs.ts --city scottsdale --dry-run

# Batch run (~$0.015/venue, ~50% cheaper than --quick):
pnpm tsx scripts/reextract-stubs.ts --city scottsdale

# One targeted venue from a specific menu/PDF URL (from the escalation shortlist):
pnpm tsx scripts/reextract-stubs.ts --venue <venueId> --url <https://…/menu-or.pdf>

# Resume a batch whose poll got killed (no re-spend):
pnpm tsx scripts/reextract-stubs.ts --collect <batchId>
```

---

## 3. Diagnose ONE stub — why isn't it extracting?

```bash
# $0 triage + fetch boundaries + (one ~5¢ model call) full extract trace:
pnpm tsx scripts/debug-extract.ts --url "https://venue.com/" --name "Venue Name" --type bar

# Or by candidate already in the DB:
pnpm tsx scripts/debug-extract.ts --candidate "North Italia" --city tucson

# FREE diagnostics (no model call):
pnpm tsx scripts/scan-hh-signal.ts --city <slug>
pnpm tsx scripts/diagnose-no-hh.ts --city <slug>
```

---

## 4. Tests

```bash
pnpm run test:ci            # all hermetic suites (no DB/keys/network)
pnpm run typecheck          # tsc --noEmit

# Happy-hour parser specifically:
pnpm run test:hh-golden     # golden-set: real HTML fixtures → expected windows
pnpm run test:hh-outcomes   # confirm / review / ignore across time formats
pnpm run test:parse-hh-text # parser unit checks
pnpm run test:free-extract  # adapter (parser → cost-0 ExtractResult)
```

Add a golden case: drop an `.html` in `scripts/fixtures/hh-golden/` + one entry in
`scripts/test-hh-golden.ts`.

---

## 5. DB spot checks

```bash
# Per-city: venues with hours vs stubs:
PGPASSWORD=hhf docker compose exec -T db psql -U hhf -d happyhourfriends -c \
  "select c.slug,
     count(*) filter (where exists (select 1 from happy_hours h where h.venue_id=v.id and h.active and h.deleted_at is null)) as with_hours,
     count(*) filter (where not exists (select 1 from happy_hours h where h.venue_id=v.id and h.active and h.deleted_at is null)) as stubs
   from venues v join cities c on c.id=v.city_id where v.deleted_at is null group by c.slug order by 1;"

# AI spend month-to-date:
pnpm run ai:spend
```

---

## 6. Deploy / data sync (see docs/data-sync-runbook.md)

```bash
PROD_IP=<ip> pnpm run push:data     # local DB → prod (restore as postgres on-box)
PROD_IP=<ip> pnpm run pull:data     # prod → local
```

---

## ⚠️ Costs — read before running

- **`seed:discover`** (Google Places) and **`seed:enrich`** (`web_search`) are **PAID** and
  accrue invisibly (no local ledger for Google). Never run without a per-run OK + estimate.
  Discover each city ONCE. (See memory `feedback_google_discovery_cost_control`.)
- **`reextract:stubs`** (paid) and **`debug-extract`** spend Anthropic tokens.
- **`reextract:stubs:free`** is the only $0 recovery path — start there.
