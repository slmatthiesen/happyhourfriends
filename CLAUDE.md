@AGENTS.md

# Happy Hour Friends — agent guide

A web app aggregating restaurant/bar happy hours into one sortable, filterable table,
with an AI moderation pipeline that verifies user submissions before applying them.
Multi-city-native (built for ~1000 cities). **`PRD.md` is the source of truth — read it
before building (don't skim §3 schema or §4 AI pipeline).**

## AI pipeline overview

```
seed:discover → seed:enrich → [submission] → classify → verify → apply/queue
                                                ↑
                                         reextract:stubs (stub recovery)
```

1. **Seed discovery** — `seed:discover` tiles the city boundary (PostGIS), calls Google
   Places searchNearby, and inserts `seed_candidates` filtered by type, alcohol service,
   and boundary proximity. Excluded primary types (zero confirmed-HH across all cities):
   `indian_restaurant`, `bakery`, `cafe`, `coffee_shop`, `cafeteria`, `thai_restaurant`.
2. **Enrich** — `seed:enrich` gates on alcohol + website, then runs a single-pass Haiku
   extractor. Page content is fetched by our own code (`lib/ai/siteContent`) and passed
   inline; the model gets ONLY the forced `record_happy_hours` structured-output tool, so it
   cannot call Anthropic `web_search`/`web_fetch` or incur those charges (cost = input tokens
   × paid candidates, not searches). Extractor uses tiered discovery: anchor links → Wix
   `pageUriSEO` routes → PDF/image links → path guesses; follows media links one hop under a
   payload budget; reads PDFs and images natively → structured output. Venues land even
   without HH data (become community stubs). (The only real web search in the system is the
   Stage 2 verifier's free local DuckDuckGo scraper — `lib/verification/webSearch.ts` — never
   a paid Anthropic tool.)
3. **Classify (Stage 1)** — pg-boss job on every new submission. Haiku classifier scores
   risk and verdict; low-risk + positive-trust → auto-apply through the engine; high-risk
   or banned → `queued_admin`; else → verify.
4. **Verify (Stage 2)** — Sonnet verifier fetches the supporting URL, reads PDFs/images
   (including user-uploaded evidence photos), confirms or contradicts the change. Confirmed
   → auto-apply (source URL injected); contradicted → reject; unconfirmed → route by risk.
5. **Interpret** — Free-text "report a change" submission → Haiku interpreter fans out one
   child `edit_submissions` row per concrete change. Children always go through verify and
   land in `queued_admin` (never auto-apply).
6. **Stub recovery** — `reextract:stubs` retries stubs in batch mode or per-venue. Admin
   `/admin/stubs` Stub Resolver for operator-targeted recovery with a custom URL.

All writes funnel through `lib/recover/resolveVenue.ts` → `persistExtractedWindows()` (ledger
→ realness gate → insert → promote). Prompts are versioned in `/prompts/`; every AI call
records a `prompt_hash` in `ai_usage_ledger`.

## Branch & PR workflow (NON-NEGOTIABLE)

Multi-agent sessions on a shared checkout produce divergence that is hard to untangle.
These rules are non-negotiable:

1. **One unit of work = one branch off the latest `origin/main` = one PR.** Start every
   task with `git fetch origin && git switch -c <branch> origin/main`. Never commit
   directly to `main`. Never start a branch from another in-flight feature branch.
2. **Integrate ONLY through GitHub PRs.** Do NOT do local `git merge <branch>` into `main`
   while PRs are open. ONE integration path: open a PR (`gh pr create`), then
   `gh pr merge --merge`. Let GitHub own `main`.
3. **Before integrating anything, sync:** `git fetch origin` and confirm
   `git rev-list --count main..origin/main` is what you expect. Fast-forward local main
   with `git merge --ff-only origin/main` — if it refuses, you've diverged; STOP and
   reconcile before merging more.
4. **Never resolve a conflict by deleting a side's additions.** When both sides ADD
   lines (scripts, imports, CSS rules), keep BOTH. A clean auto-merge can still be wrong —
   re-read the merged hunk.
5. **After any branch switch or merge, `rm -rf .next` before restarting `npm run dev`.**
   Turbopack serves stale compiled CSS/RSC across big working-tree changes; a browser
   hard-refresh does NOT fix it. Dev also auto-bumps to `:3001` when `:3000` is taken —
   check the actual port before concluding a change "didn't work".
6. **Before declaring code lost:** check `git stash list`, `git reflog`, `git fsck
   --lost-found`, `git log --all`, and every `git worktree list` dir. Confirm against
   `origin/main` (it may be a superset of local).

### Worktree lifecycle (treehouse)

When a task needs an isolated worktree, acquire it with `treehouse get` (handles
node_modules/.env linking — never `git worktree add` raw). **Close your own loop when
the task is done:** push the branch / open the PR first, then run
`treehouse return <path>` to terminate lingering processes (dev server, headless Chrome)
and return the worktree clean to the pool. Do not abandon a worktree dirty or
detached — an unreturned worktree blocks pool reuse and looks like lost work. Before
running `treehouse return --force` or `treehouse destroy` on someone else's dirty
worktree, content-match its changes against `origin/main` (a differently-named merge
commit can already contain them) — only `--force` once you've confirmed nothing unique
is at stake.

## Neighborhood model

Two-tier recognizability model on the `neighborhoods` table (`tier` + `recognizability`
smallint 0..2). Signal = OSM-presence (not Wikidata — too sparse). Any non-junk OSM
`neighbourhood`/`quarter`/`suburb` polygon is recognizable (score 1; Wikidata/Wikipedia
bonus = 2). Junk filtered by a global name regex (condo misspellings, mobile estates,
subdivisions). Coarse rollup = OSM coarse tier + city GIS + `generate:cardinal-districts`
(clips Downtown + N/E/S/W/Central from the boundary GeoJSON). Assignment priority:
recognizable-fine → coarse → snap (ST_DWithin 100m). Per-city runbook: `import:osm-neighbourhoods`
→ `backfill:neighborhood-tiers` → `generate:cardinal-districts` → `analyze:neighborhood-coverage`.

## Non-negotiables (PRD §13 — do not violate)

- **Never hallucinate data.** Missing value → `null`. No HH info → no `happy_hours`
  rows (venue becomes a help-wanted stub). Every applied change needs a `source_url`.
- **Day-of-week is ISO: 1=Mon … 7=Sun** (DB CHECK enforces it).
- **Times are venue-local.** "Happening now" = convert *now* into the venue's tz
  (`lib/geo/timezone.ts`), never normalize stored times to UTC.
- **Dedup venues on `google_place_id`**, never name (chains are real).
- **Pin prompts:** prompt templates live in `/prompts/` (versioned); record the
  content hash in `ai_usage_ledger.prompt_hash` (`lib/ai/promptHash.ts`).
- **Ask before assuming** on PRD ambiguity/conflict.
- **First-party data only.** Never seed/insert venue or HH/offering data sourced from
  competitor aggregators (ultimatehappyhours.com, seattletravel.com, Yelp, Groupon).
  Source guard in `lib/ai/extractHappyHours.ts` enforces this for AI sources; do not
  bypass it or recreate any editorial seed scripts.

## Architecture decisions (these DIVERGE from PRD.md)

The schema is **multi-city-native** (operator goal: ~1000 cities). Summary:
- First-class **`cities`** table; cities are unique by `(state, slug)`.
  `neighborhoods`/`venues`/`seed_candidates` use `city_id` FK (not text city/state).
- **`venues.slug` unique per `(city_id, slug)`**, not globally.
- **`offerings.currency_code`** added (PRD assumed USD).
- **`ai_usage_ledger.city_id`** (per-city spend) + **`prompt_hash`** (PRD §4.7 needs
  it; §3.12 omitted the column).
- `data_completeness='verified'` is a **stored** enum set by verification jobs
  alongside `last_verified_at`, downgraded to `complete` past 60 days.
- `happy_hours.crosses_midnight` is a **STORED generated column** (`end_time <
  start_time`); `end_time` is **nullable** ("until close").
- `happy_hours.days_of_week` is a `smallint[]` — one row per window (Mon–Fri = `{1..5}`),
  not per day. Stored sorted; DB CHECK enforces non-empty array of 1..7.
- Client-exposed keys use `NEXT_PUBLIC_` prefixes (PostHog, Turnstile site key).

## Environment constraints

- **Background subagents cannot use tools that need a permission prompt** —
  `WebSearch`, `WebFetch`, and `Write` outside the allowlist are denied at runtime
  even when allowlisted in `.claude/settings.local.json`. Only the main thread can do
  web fetches. Gather web data inline in the main thread; use subagents for
  self-contained code chunks (ideally in worktrees) and integrate yourself.
- The pipeline phases are a **chain**, not parallel workstreams — they edit the same files.
- Git shows LF→CRLF warnings on Windows; harmless.

## Run it locally

```bash
docker compose up -d        # local PostGIS (DATABASE_URL in .env points here)
pnpm db:migrate             # apply migrations
pnpm seed:cities            # seed city rows (idempotent)
pnpm dev                    # http://localhost:3000
pnpm build                  # acceptance gate; pnpm typecheck for types only
```

Requires **Docker Desktop running** (its daemon, not just the CLI). `.env` holds the
local `DATABASE_URL`; `.env.example` lists every prod var. Switch to a managed Postgres
by changing `DATABASE_URL` only.

## Stack

Next.js 15 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 +
shadcn/ui · Drizzle ORM + drizzle-kit (versioned migrations, not push) · postgres.js ·
firebase-admin · @sentry/nextjs · posthog-js/node · pg-boss (job queue for AI pipeline).
Anthropic models: `claude-haiku-4-5` (classify/interpret/relevance), `claude-sonnet-4-6` (verify).

## Repo map

```
app/                   routes (public + /admin gated + sitemap/robots)
components/            venue-table-client (sort/filter/search), submit/*, flag/*, ui/
db/schema/             enums, columns (geometry customType, timestamps), core, moderation, ops
db/migrations/         versioned — always add new migrations, never edit existing ones
db/client.ts           lazy drizzle client (build-safe; needs DATABASE_URL only on query)
lib/ai/                classifier, verifier, interpreter, extractor, relevance gate, budget, ledger
lib/geo/               timezone ("happening now"), assignNeighborhoods, recognizability
lib/apply/engine.ts    load-bearing write path — all AI + admin writes funnel here
lib/jobs/handlers/     classify, verify, interpret, reextract job handlers (pg-boss)
lib/places/            siteTriage, hhText, sitemap, chainDenylist, realnessGate
lib/recover/           resolveVenue + persistExtractedWindows (ONE persist path)
lib/trust/             submitter rate limits, flagThresholds
lib/queries/venues.ts  data-access layer
prompts/               versioned prompt templates (classifier, verifier, interpreter, extractor)
scripts/               seed-cities, import-neighborhoods, reextract-stubs, debug-extract, …
data/                  city boundary + neighborhood GeoJSONs (public domain / ODbL)
docs/                  pipeline-flow.md, new-city-runbook.md, OPERATOR-CHEATSHEET.md
```
