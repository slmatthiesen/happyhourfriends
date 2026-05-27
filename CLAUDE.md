@AGENTS.md

# Happy Hour Friends — agent handoff

A web app aggregating restaurant/bar happy hours into one sortable, filterable table,
with an AI moderation pipeline that verifies user submissions before applying them.
Launch market: Tacoma, WA. **`PRD.md` is the source of truth — read it before building
(don't skim §3 schema or §4 AI pipeline).** This file is the running state + lessons.

## Status (as of last session)

- **Phase 0 — COMPLETE.** Scaffold, full schema, migrations **applied to a live
  Postgres+PostGIS DB**, design system, AI/budget/trust libs, versioned prompts,
  observability, admin gate. Real Tacoma data: city row seeded + **8 council-district
  neighborhood polygons imported** (real GeoJSON in `data/`).
- **Phase 1 — MOSTLY DONE.** Live read routes built and building clean:
  `/[city]`, `/[city]/[neighborhood]`, `/[city]/venue/[slug]`, `/about`, `/faq`,
  `/styleguide`, `/robots.txt`, `/sitemap.xml`, gated `/admin`. `/` → `/tacoma`.
  - **Remaining Phase 1:** interactive client sort/filter, dedicated mobile card
    layout, OG images (`@vercel/og`), JSON-LD `Event` nesting. Most need real venue
    data to be meaningful.
- **Phases 2–7 — NOT STARTED.** Submissions+admin queue → Stage 1 classifier →
  Stage 2 verifier → community flags/anti-sabotage → seed → re-verify/promotion.
  These are **sequential and interdependent** (don't try to parallelize across phases).
- **No venue rows exist yet.** `/tacoma` shows the neighborhood chips + an empty
  "seeding in progress" state until venues are seeded.

## Run it locally

```bash
docker compose up -d        # local postgis (DATABASE_URL in .env points here)
npm run db:migrate          # apply migrations
npm run seed:cities         # Tacoma city row (idempotent)
# neighborhoods already imported; to redo: npm run import:neighborhoods -- --city tacoma \
#   --geojson ./data/tacoma-council-districts.geojson --name-prop name
npm run dev                 # http://localhost:3000 → /tacoma
npm run build               # acceptance gate; npm run typecheck for types only
```

Requires **Docker Desktop running** (its daemon, not just the CLI). `.env` holds the
local `DATABASE_URL`; `.env.example` lists every prod var. Switch to DO Managed
Postgres by changing `DATABASE_URL` only.

## Stack (pinned, as installed)

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 +
shadcn/ui · Drizzle ORM 0.45 + drizzle-kit (**versioned migrations**, not push) ·
postgres.js · firebase-admin · @sentry/nextjs · posthog-js/node · pg-boss (Phase 3+,
not yet added). Anthropic models via env: `claude-haiku-4-5` (classify),
`claude-sonnet-4-6` (verify).

## Architecture decisions (these DIVERGE from PRD.md — see memory)

The schema is **multi-city-native** (operator goal: ~1000 cities). See the project
memory note `multi-city-architecture` for the full list. Summary:
- First-class **`cities`** table; Tacoma is city #1. `neighborhoods`/`venues`/
  `seed_candidates` use `city_id` FK (not text city/state).
- **`venues.slug` unique per `(city_id, slug)`**, not globally.
- **`offerings.currency_code`** added (PRD assumed USD).
- **`ai_usage_ledger.city_id`** (per-city spend) + **`prompt_hash`** (PRD §4.7 needs
  it; §3.12 omitted the column).
- `data_completeness='verified'` is a **stored** enum set by verification jobs
  alongside `last_verified_at`, downgraded to `complete` past 60 days.
- `happy_hours.crosses_midnight` is a **STORED generated column** (`end_time <
  start_time`); `end_time` is **nullable** ("until close").
- Client-exposed keys use `NEXT_PUBLIC_` prefixes (PostHog, hCaptcha site key).

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

## Environment constraints LEARNED THE HARD WAY

- **Background subagents cannot use tools that need a permission prompt** —
  `WebSearch`, `WebFetch`, and `Write` outside the allowlist are denied at runtime
  even when allowlisted in `.claude/settings.local.json`. **Only the main thread can
  do web fetches.** So: gather web data (venue seed, any GeoJSON) inline in the main
  thread; use subagents only for self-contained code chunks (ideally in worktrees) and
  integrate yourself. See memory `scraper-headless-blocked`.
- The phases are a **chain**, not parallel workstreams — they edit the same files.
- Git shows LF→CRLF warnings on Windows; harmless.

## Repo map

```
app/                 routes (public + /admin gated + sitemap/robots)
components/          venue-table (shared), directions-button (client), ui/ (shadcn)
db/schema/           enums, columns (geometry customType, timestamps), core, moderation, ops
db/migrations/       0000 postgis bootstrap, 0001 init schema (versioned)
db/client.ts         lazy drizzle client (build-safe; needs DATABASE_URL only on query)
lib/ai/              budget (tiered cap §4.5), promptHash, models
lib/geo/timezone.ts  "happening now" / cross-midnight logic
lib/trust/           flagThresholds (§5.3)
lib/queries/venues.ts  data-access layer
lib/firebase/admin.ts  verifyAdmin (allowlist by ADMIN_EMAIL); no-op until creds set
prompts/             stage1-classifier.md, stage2-verifier.md (versioned)
scripts/             seed-cities, import-neighborhoods (source-agnostic: --city --geojson)
data/                tacoma-council-districts.geojson (real, committed)
```

## Suggested next step

A fresh session: `docker compose up -d && npm run dev` to confirm `/tacoma`, then
either (a) inline-scrape ~20–30 real Tacoma venues into `data/tacoma-seed.json` and
write `scripts/seed-venues.ts` to load them (no fabrication; every HH row sourced), or
(b) build **Phase 2** (anonymous submission flow + admin queue + audit log + revert) —
needs no seed data. Operator still owes the §10 cloud setup before prod launch.
