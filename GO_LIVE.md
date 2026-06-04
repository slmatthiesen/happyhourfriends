# Run before going live

Things built but not yet run against production. Each step needs `DATABASE_URL` pointed
at the prod DB (and the noted API key).

## Data sync — local ⇄ prod (canonical runbook: `docs/data-sync-runbook.md`)

**Yes, go-live includes keeping data in sync and pushing local updates to prod.** The
full, battle-tested procedure lives in **`docs/data-sync-runbook.md`** (read it — the
script order encodes walls we hit by hand). Summary of the **two-channel model**:

- **CODE** (schema, app, logic) → travels via **git**: commit → push → on the droplet
  `git pull` → `npm ci` → `npm run db:migrate` → build → restart. Never touches live data.
- **DATA** → the scripts below. **Prod is the source of truth for USER data**
  (submissions/flags/applied edits); **local is the source of truth for seed/curation**.

### Pre-launch: initial bulk load (local → prod)

```bash
PROD_IP=<droplet-ip> npm run push:data
```
Full reload: schema sync → stop app → dump local venue tables → restore **as `postgres`
on the box** → restart → counts. **Guarded:** refuses to run if prod already has
`audit_log` / `edit_submissions` rows (real users) unless `FORCE=1`. It TRUNCATEs venue
tables, so this is **pre-launch only**.

### Post-launch: allowing updates on prod from local (the ongoing path)

`push:data` would clobber user edits after launch — do NOT use it then. Instead, point the
**enrich pipeline at prod over an SSH tunnel**; inserts **dedup on `google_place_id`**, so
they add/refresh venues without touching user-generated rows. The exact tunnel commands are
in "Site triage → C. Update DATA on the server" below and in the runbook. (The old
`sync:to-prod` is deprecated — `ALLOW_LEGACY_SYNC=1` to force; don't.)

### Mirror prod → local (on demand)

```bash
PROD_IP=<droplet-ip> npm run pull:data   # stop local `npm run dev` first (--clean drops objects)
```
Brings prod down to local incl. submissions/flags/audit. **Overwrites local data.**

### Backups + the one open blocker

- **Nightly backups run on the droplet** (`scripts/backup/hhf-pg-backup.sh` via root cron,
  `/var/backups/happyhourfriends/`, 14-day retention) — install once per the runbook. This
  is the real safety net for user data; also enable DO snapshots for off-box copies.
- ⚠️ **Known go-live blocker:** the app **leaks DB connections** (~80/100 held by
  `postgres.js`), which will exhaust the pool under real traffic and take the site down
  ("remaining connection slots reserved for SUPERUSER"). Fix `db/client.ts` to use one
  singleton client with a sane `max` + `idle_timeout` **before** real traffic. See memory
  `project_production_deploy`.

## Search rankings — SEO + AI/GEO (code built 2026-06-03, branch `feat/seo-itemlist-canonical` / PR #19)

The strategic wedge: rank #1–3 for **"happy hour &lt;city&gt;"** in *lesser-known* markets
(Spokane, Tacoma, smaller Idaho cities), where the big aggregators (Yelp, Tripadvisor,
Thrillist) don't compete hard. The lever is **completeness + freshness + a little local
authority** — completeness/freshness is the same work as data curation; authority is the
hard part. Don't launch 50 thin cities; take a handful to genuine completeness.

### What shipped (code — DONE, in PR #19)

- **`metadataBase`** (root layout) → all canonical + OG-image URLs resolve absolute.
- **`alternates.canonical`** on city, neighborhood, and venue pages.
- **`ItemList` JSON-LD** on city + neighborhood pages (lists only venues that actually
  have a happy hour; omitted when none). Venue pages already had `Restaurant` + `Event`.
- **Data-freshness signal:** "Updated &lt;date&gt;" beneath the city clock (from
  `max(updated_at)` over in-scope venues) + **`<lastmod>` in `sitemap.xml`** per venue,
  city, and neighborhood. Decisive in a category where staleness is the norm.
- **`BreadcrumbList` JSON-LD** on city, neighborhood, and venue pages (built via
  `lib/seo/structuredData.ts`) — Google renders the trail in results.
- **`FAQPage` JSON-LD** on `/faq` (mirrors the visible Q&A, so the markup always matches).
- **`/llms.txt`** (llmstxt.org convention) listing the live cities + key pages for LLM crawlers.

### CRITICAL config before any of the above helps in prod

- **`NEXT_PUBLIC_SITE_URL` MUST be the production domain** (`https://happyhourfriends.com`).
  It's baked in at **build time** (it's `NEXT_PUBLIC_`), so it has to be set in the
  deploy/build environment — not just runtime. Without it, every canonical, OG image, and
  sitemap URL falls back to `localhost` and the SEO work is inert. **Verify after deploy:**
  `curl -s https://happyhourfriends.com/wa/tacoma | grep canonical` → must be the prod host.

### Operator go-live steps (not code — do these at/after launch)

1. **Google Search Console** — verify the domain, submit `https://happyhourfriends.com/sitemap.xml`,
   then watch Coverage (are city/venue pages indexed?) and Performance (which queries you
   surface for). You can't improve what you can't see; this is step zero.
2. **Bing Webmaster Tools** — same submit. Matters more than its market share: Bing's index
   feeds **ChatGPT search + Copilot**, so this is also an AI-SEO step.
3. **Confirm crawl posture** — `robots.ts` already allows all bots (`*`) except `/admin` and
   advertises the sitemap. This already permits **AI crawlers** (GPTBot, PerplexityBot,
   Google-Extended). Decision to confirm: keep them allowed (recommended — we want
   *attribution/referral* traffic from AI answers, the trade-off is training-data use).
4. **Local authority / backlinks** — the decisive lever for small cities and the hardest:
   a few quality local links (Chamber of Commerce, local subreddit, local press), consistent
   name/address, and an `/about` that states who's behind it + the verification methodology
   (a real E-E-A-T trust story). A handful of links goes a long way in a low-competition SERP.

### AI SEO (GEO — getting cited by ChatGPT / Perplexity / Google AI Overviews / Claude)

- Foundation is the **same** clean structured data + extractable factual prose (LLMs and
  their retrieval layers parse our JSON-LD + plain text well).
- **Be answer-shaped:** "Happy hour at X is Mon–Fri 3–6pm" extracts better than a table alone.
- **Get retrieved/cited:** Perplexity + AI Overviews pull *live* and favor fresh,
  directly-answering pages (our `<lastmod>` + Updated date feed this); being referenced on
  Reddit / local news / Wikipedia raises the odds of being surfaced.

### Deferred code follow-ups

- **Per-city intro paragraph** — a few sentences of unique copy per city page to
  differentiate from scrapers (deferred 2026-06-03; needs operator voice/tone). This is the
  one remaining cheap SEO item; BreadcrumbList / FAQPage / llms.txt all shipped (see above).

## All-day happy-hour cleanup (built 2026-05-31, merged to `main`)

The code only *sets up* these reviews — running them is a manual step. To hand it to an
agent in one line:

> Run the all-day reverify pipeline — see memory `project_run-all-day-reverify`.

Or run it yourself, in order:

1. **`npm run backfill:timezones`** — venues need a correct timezone before "happening now"
   works. Phoenix/Scottsdale/Tucson = `America/Phoenix` (no DST); Tacoma = `America/Los_Angeles`.
2. **`npm run backfill:hours`** — needs `GOOGLE_PLACES_API_KEY`. Fills `venues.hours_json`
   from Google so legit all-day / "until close" deals show a live "Now" badge again.
   (Already run once on the local DB; prod still needs it.)
3. **`npm run reverify:all-day --city phoenix`** — needs `ANTHROPIC_API_KEY`.
   **Report only, no DB writes.** Writes `docs/all-day-review-<date>.{json,md}`.
   Spot-check the verdicts (a coupon page → `not_happy_hour`; a real-but-windowed HH → `real_window`).
4. Edit the `action` field in that `.json` (`keep` | `correct` | `stub` | `delete_venue` —
   **delete is opt-in**, only happens if you leave it set), then:
   **`npm run reverify:all-day --apply docs/all-day-review-<date>.json`**
   — one audited transaction; every change is revertible via `audit_log`.

## Site triage — kill dead listings + follow HH-signal links (built 2026-05-31, branch `cluster-schema-seed-pipeline`)

**What it is.** A pre-/in-enrich triage step so the seed pipeline stops creating venues
for listings with no real site, and reads happy-hour data more reliably. For each
candidate it: (1) classifies the website as *real / social-only / none*; (2) probes a
real site for reachability (dead/parked); (3) scans the page for the venue's own
happy-hour/menu links and hands them to the extractor to fetch first. Outcomes:
- **dead / parked / no-site (low likelihood)** → **killed** (no venue created), logged to
  `docs/<city>-killed-venues.md` for operator review.
- **social-only** (Facebook/Instagram/Linktree/DoorDash) → kept as a **stub** (the social
  URL is preserved on the venue).
- **reachable site, no times found** → kept as a **stub** (the recall-gap safety net — a
  valid site is NEVER killed just because no HH was extracted).
- **no site but venue type is >50% likely to have HH** ("go-for-it") → extractor runs
  `web_search` to find the site before giving up.

It also adds a **retroactive cleanup** script for venues already in the DB.

**Schema change.** Migration `0012_superb_marvel_boy.sql` adds `killed_no_site` to the
`seed_outcome` enum. Already applied to the **local** DB. **Prod must run it** (the normal
code deploy runs `npm run db:migrate`, which applies it; verify it lands).

**Prompt bump.** `prompts/seed-extract-hh.md` is now **version 10** (adds the
`{{priority_urls}}` block). The new content hash is recorded in `ai_usage_ledger.prompt_hash`
automatically — no action needed.

### A. Local verification gate (run ALL of these before pushing; all must pass)

```bash
npm run typecheck                          # clean (no output)
npm run lint                               # ONLY pre-existing warning: db/schema/moderation.ts ('sql' unused)
npx tsx scripts/test-hh-likelihood.ts      # → 12 checks passed.
npx tsx scripts/test-site-triage.ts        # → 17 checks passed.
npx tsx scripts/test-kill-report.ts        # → 4 checks passed.
npx tsx scripts/test-extract-request.ts    # → 2 checks passed.
# Regressions (the concurrently-merged all-day/hours work must still pass):
npx tsx scripts/test-extract-allday.ts     # → 5 checks passed.
npx tsx scripts/test-timezone-active.ts    # → 14 checks passed.
npx tsx scripts/test-venue-type.ts         # → 33 checks passed.
# Build gate (dummy DB is fine — build does not query):
DATABASE_URL='postgresql://x:x@127.0.0.1:1/x' NEXT_PUBLIC_SITE_URL='https://happyhourfriends.com' npm run build   # compiles
# Confirm the migration is present and is the only new one:
ls db/migrations/0012_*.sql                # → db/migrations/0012_superb_marvel_boy.sql
```

Optional end-to-end smoke (makes real outbound site fetches, **no DB writes** in dry-run):

```bash
# Needs DATABASE_URL pointed at a DB with stub venues (local or prod-over-tunnel).
npm run triage:stubs -- --city tacoma --limit 6     # prints per-venue WOULD kill / keep; writes docs/tacoma-killed-venues.md
```

### B. Push CODE live (schema + logic)

Deploy via the normal **CODE channel** (git push → server deploy runs git pull → npm ci →
`db:migrate` → build → restart — see memory `project_production_deploy`). The deploy's
`db:migrate` applies migration `0012` to prod. Nothing else to do for the code side.

### C. Update DATA on the server (run the triage'd pipeline against prod)

Per the **DATA channel** in `project_production_deploy`: point the LOCAL pipeline at the
PROD DB over an SSH tunnel (inserts dedup on `google_place_id`, so they never clobber
user submissions). Needs `ANTHROPIC_API_KEY` (extract) and `GOOGLE_PLACES_API_KEY`
(Place Details). Replace `<prod-host>` and the prod connection string with the real values.

```bash
# Terminal 1 — open the tunnel (prod Postgres is localhost-only on the droplet):
ssh -L 5433:localhost:5432 <prod-host>

# Terminal 2 — run enrich (now triage-gated) against prod via the tunnel.
# New + re-armed candidates are processed; dead/parked/no-site are killed, not stubbed.
PROD='postgresql://hhf:<password>@localhost:5433/happyhourfriends'
DATABASE_URL="$PROD" npm run seed:enrich -- --city <city> --batch   # --batch ≈50% cheaper; omit for on-demand
# → writes docs/<city>-killed-venues.md (the kill audit) when anything is killed.
```

**Retroactive cleanup of EXISTING prod stubs** (this is the new lever for the venues you
hand-reviewed). Dry-run first, eyeball the report, then apply:

```bash
# 1. Dry-run — NO writes. Shows what WOULD be killed / upgraded; writes the audit report.
DATABASE_URL="$PROD" npm run triage:stubs -- --city <city>
# 2. Review docs/<city>-killed-venues.md — especially the "No site on file — recognize
#    any of these?" section (your American Way Pasta rescue queue). Anything you recognize,
#    add via the normal submit flow; it will NOT be auto-killed if it has submissions/flags.
# 3. Apply — deletes dead/parked/no-site stubs (guarded: never deletes a venue with
#    happy_hours, submissions, flags, audit history, or a promotion) and upgrades any
#    reachable stub whose HH/menu links now yield times.
DATABASE_URL="$PROD" npm run triage:stubs -- --city <city> --apply
```

**Do NOT use `npm run sync:to-prod`** for this — that is one-time initial-load only and
TRUNCATEs venue tables (it self-guards post-launch). The tunnel pipeline above is the
post-launch path.

### Caveats for the running agent
- The kill-audit file `docs/<city>-killed-venues.md` is **overwritten each run** (it is
  gitignored). If you need a durable record, the kills are always queryable:
  `SELECT name FROM seed_candidates WHERE outcome = 'killed_no_site'` — or for the
  retroactive deletes, they're gone, so **save the dry-run report before `--apply`**.
- Likelihood priors live in `lib/places/hhLikelihood.ts` (tunable; only the `> 0.5`
  no-site rescue gate is behaviorally load-bearing).
- SACRED: a reachable site is never killed for "no HH found" — only no-site/dead/parked.
