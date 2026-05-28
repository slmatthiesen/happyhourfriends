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
- **Phase 2 — COMPLETE.** Anonymous submission flow + admin queue + audit/revert,
  all building + typechecking clean. Key pieces:
  - **Apply/revert engine** `lib/apply/engine.ts` (`applySubmission`,
    `rejectSubmission`, `revertAudit`) — the load-bearing write path. Every apply runs
    in a txn that writes `audit_log` before/after; enforces `source_url` on
    happy-hour/offering changes; column allowlists per table; `new_venue` insert with
    slugify. **Phases 3–5 must funnel all writes through this** (`ApplyContext.actor`).
  - **Submission API** `POST /api/submissions` (honeypot + hCaptcha + coarse rate
    limit via `lib/trust/submitter.ts`) → `edit_submissions` status `pending`.
    Client form `components/submit/*`; pages `/submit/new-venue`, `/submit/status/[id]`
    (public, no auth). Edit affordances wired onto the venue page.
  - **Admin**: Firebase Google sign-in via **session cookie** (`lib/firebase/client.ts`
    + `/api/admin/session` + `verifyAdminSessionCookie`/`createAdminSession`). Gate in
    `app/admin/layout.tsx` renders sign-in inline (no separate login route).
    `/admin` queue (diff view, apply / reject / edit-then-apply) + `/admin/audit`
    (revert). Server actions in `app/admin/actions.ts` re-check auth via `requireAdmin`.
- **Phase 3 — WIRED (Stage 1 classifier).** pg-boss runs on the app's Postgres.
  Workers boot in `instrumentation.ts` (`NEXT_RUNTIME===nodejs` + `DATABASE_URL`).
  `POST /api/submissions` enqueues `classify-submission` (`lib/jobs/{boss,queue,worker}.ts`,
  handler `lib/jobs/handlers/classify.ts`): classifies via `lib/ai/classifier.ts`,
  writes risk/verdict back, records `ai_usage_ledger` (`lib/ai/ledger.ts`), then routes —
  **low-risk → auto-apply through the engine** (actor `ai`), verdict `reject` → rejected,
  else → `queued_admin`. Banned fingerprints never auto-apply. `/admin/budget` shows
  month spend + tier + per-stage breakdown. Needs `ANTHROPIC_API_KEY` to actually
  classify; without it the job fails safe to `queued_admin` (submission still visible).
- **Phase 4 — WIRED (Stage 2 verifier).** classify routes low+neutral / medium / high to
  the `verify-submission` queue (`lib/jobs/handlers/verify.ts`); critical + banned →
  `queued_admin`; low+positive-trust → straight auto-apply. The verify handler is
  budget-gated (`canRunStage2` → `budget_exhausted` when capped), runs `verify()`, writes
  `verification_attempts` rows + `ai_evidence_jsonb`, and routes per §4.4: contradicted →
  reject + `recordOutcome("inaccurate")`; confirmed → auto-apply (injecting the supporting
  evidence URL as `source_url`); unconfirmed → low apply / medium `queued_outreach` / high
  `queued_admin`. Needs `ANTHROPIC_API_KEY`; without it fails safe to `queued_admin`.
- **Phase 5 — WIRED.** Community-flag voting: `POST /api/flags` + `components/flag/flag-widget.tsx`
  on the venue page (live confirm/deny tally). Crons via pg-boss `schedule` in `worker.ts`:
  daily `resolve-flags` (`resolveOpenFlags`), weekly `detect-anomalies`, daily
  `reverify-venues`. Submission API now uses the full §5.1 `checkSubmissionRateLimit`
  (critical = venue→closed/no_happy_hour). `recordOutcome` fires on verifier-contradicted
  rejects. **TODO:** confirmed-flag → auto-apply implied change + admin email; rejected-flag
  → decrement the originating submitter (needs flag→submission linkage). No email yet (Resend).
- **Phase 6 — DONE.** Seed pipeline is the only path to venues: `seed:discover` (Google
  Places, tiled, filtered) → `backfill:place-ids` (if curated venues exist) →
  `seed:enrich` (Place Details gate → single-pass Haiku web_fetch extractor → cluster-
  shaped happy_hours rows). **The editorial seed (`data/tacoma-seed.json`, the old
  `seed:venues` npm script, and `scripts/seed-venues.ts`) is DELETED (2026-05-27)** —
  multiple sessions kept reintroducing the banned ultimatehappyhours/seattletravel
  aggregator data despite the operator removing it twice; the only durable fix is no
  file + no script + no package.json entry. Don't recreate any of them. First-party
  data only, via the enrich pipeline.
- **Phase 7 — WIRED.** Promotion styling + pinning in the table; `/admin/promotions`
  (audited tier/date control); `/for-restaurants`; venue/city OG images; daily re-verify
  cron (`reverify_cron` ledger, stale `verified`→`complete` past 60d, budget-gated).
- **Phase 1 polish — DONE.** `venue-table-client.tsx`: sort, neighborhood/day/**type/tag**
  filters, "happening now" (venue-tz aware), search, mobile cards. `listVenuesForCity` now
  also returns `type` + `tags`. JSON-LD nests a recurring `Event` per happy hour.
  (Old `components/venue-table.tsx` is now unused.)
- **UX session (2026-05) — DONE.** Operator-driven changes:
  - **Source policy relaxed to "photo OR URL".** A happy-hour/offering edit still
    requires evidence, but a submitter may satisfy it by uploading a **photo of the
    menu** instead of a link (lowers friction; "data at the bar" is valid). Upload →
    `lib/submit/evidenceStore.ts` writes it under `public/uploads/evidence` (gitignored;
    `EVIDENCE_UPLOAD_DIR`/`EVIDENCE_PUBLIC_BASE` envs; swap for DO Spaces at scale) →
    the stored URL becomes the change's `source_url`, and the **verifier reads the
    photo via Claude vision** (`readEvidenceForVision` → image block in `verify()`).
    Engine still enforces a source on HH/offering (a photo counts); venue metadata
    fixes (name/phone) stay friction-free. `/api/submissions` is `runtime = "nodejs"`.
  - **Grid enriched** (`venue-table-client.tsx` + `listVenuesForCity`): added **Type**,
    **Deals** (top offerings preview), **live "Now" badge**, and a **$/$$/$$$ price
    indicator**; sort now includes type + price; search matches deal names too.
    `VenueListItem` now carries `offerings[]` + `minPriceCents`.
  - **Theme switcher** (`components/theme-switcher.tsx`, in root layout, pre-paint
    script): live palette selector — Twilight (default purple), Warm, Teal — persisted
    to localStorage. Palettes are `[data-theme=...]` overrides in `globals.css`.
    (Color direction was left open; operator picks by eye.)
  - **Removed the one-click "discontinued" flag widget** from the venue page (too easy
    to abuse); kept the moderated suggest-edit paths under "Keep this listing accurate".
    Added **Social/menu (`otherUrl`) + phone links** to the venue header.
  - **"Menu out of date? Send the current one" report path.** `SubmissionForm` gained
    a `reportMode`: a free-text note + photo with **no field diff required** (the note
    lands in `diff.after.note`, the photo as evidence). Wired on the venue page for the
    "whole menu's wrong, here's a picture" case; routes through the normal queue and the
    verifier reads the photo. The source link on the venue page is now a **"Source ↗"
    pill** (was "Where did this come from?").
  - **Neighborhood spatial backfill — WIRED.** `lib/geo/assignNeighborhoods.ts`
    (`ST_Contains`, most-specific polygon wins) + `npm run backfill:neighborhoods`
    (`--city`); also called at the end of `seed:enrich` (enriched venues carry lat/lng).
    Still a no-op for the editorial seed venues (no coordinates) until geocoding runs.
  - **Matador seed fix:** merged the two late-night windows into one **10 PM–close**
    (`endTime: null`) carrying the same 8 offerings as the 4–6 window. General convention
    going forward: prefer "until close" (`endTime: null`) over a guessed hard end.
  - tsc + eslint clean (same 2 pre-existing Phase 0 issues); `next build` compiles (one
    benign Turbopack NFT file-trace warning from the upload store's `fs` use — harmless,
    irrelevant under `next start`).
- **Open-source prep + upload hardening — STARTED (2026-05-27).** Repo is going OSS
  (MIT — `LICENSE` added). Verified clean: `.env` is untracked and absent from git history;
  no secrets in tracked files. Upload safety hardened:
  - `lib/submit/evidenceStore.ts` now **re-encodes every image through sharp** (proves it
    decodes as an image, normalizes to JPEG/PNG, and **strips EXIF/GPS + any polyglot
    payload**; `.rotate()` bakes in orientation first). **PDFs validated by `%PDF-` magic
    bytes.** Stored MIME/ext come from what we actually wrote, never the client's declared
    type. `sharp` is now a direct dep.
  - `app/api/submissions/route.ts`: **10 MB request-body cap** (Content-Length + actual
    bytes), reads via `arrayBuffer` then `JSON.parse`.
  - `lib/captcha/hcaptcha.ts`: **fails closed in production** when `HCAPTCHA_SECRET_KEY`
    is unset (still skips in dev).
  - `next.config.ts`: `/uploads/:path*` served with `X-Content-Type-Options: nosniff`,
    `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: attachment`
    (docs confirm `headers()` covers `/public` files). tsc + eslint clean.
  - **OSS scaffolding — DONE.** Public `README.md` (replaced create-next-app boilerplate),
    `SECURITY.md` (private disclosure + trust boundaries), `CONTRIBUTING.md` (setup + data
    non-negotiables + `#data-and-licensing`), `CODE_OF_CONDUCT.md` (links Contributor
    Covenant 2.1 — inlining its full text tripped a content filter, so we link it).
    `.github/workflows/`: `ci.yml` (typecheck + lint + build on PR/main, dummy DATABASE_URL
    for build) and `secret-scan.yml` (gitleaks, full history).
  - **Remaining OSS/safety work:** **seed-data licensing** (`data/tacoma-seed.json`
    redistributes scraped editorial content — the real blocker before publishing, tackling
    next); quarantine/cleanup of evidence for rejected submissions (files currently go public
    at upload time); `x-forwarded-for` trust only holds behind the CF/LB proxy (rate limits +
    bans key on it); optional malware scan.
- **Per-venue re-scrape — ABANDONED.** That hand-scraping effort (4 of 20 editorial
  venues refreshed) is dead. The operator banned editorial sources and the AI enrich
  pipeline (with `web_search` + `web_fetch`) is now the path. The 4 partially-refreshed
  venues + the other 11 editorial ones were deleted; their candidates re-source via
  enrich. Convention preserved: prefer `endTime: null` ("until close") over a guessed
  hard end.
- **PDF tooling — ADDED (menus are usually PDFs).** Claude reads PDFs natively via
  `DocumentBlockParam` (base64). Wired in three places: (1) `fetchUrl` detects a PDF
  response (content-type / `.pdf`) and returns `pdfBase64` instead of garbled text;
  (2) the verifier hands a fetched PDF back as a `document` tool-result block; and
  (3) it accepts an uploaded **photo OR PDF** as `evidenceMedia` (image|document block)
  in its first turn. Evidence store renamed `saveEvidenceImage→saveEvidenceFile`,
  `readEvidenceForVision→readEvidenceForModel` (image|document union); the upload field
  + `/api/submissions` now accept `application/pdf`; `aiEvidenceJsonb.submittedFile`
  carries `{url,mime}`. This is what lets the **scalable** path (Places discovery → AI
  enrich/verify per venue) read the most common menu format — the manual main-thread
  scrape is only a no-keys bootstrap for launch data.
- **Unified "report a change" flow — WIRED (2026-05-27).** The four venue-page edit
  affordances (per-HH edit, menu-out-of-date, venue correction, report-closed) collapsed
  into ONE free-text box (`components/submit/report-change.tsx`, `targetType:"intent"`).
  New **interpret** stage (`lib/ai/interpreter.ts` + `prompts/interpret-submission.md` +
  `lib/jobs/handlers/interpret.ts`, Haiku, forced `record_changes` tool) maps the prose +
  optional photo onto the venue's CURRENT data and **fans out one child `edit_submissions`
  row per concrete change** (`parentSubmissionId` self-FK; `getVenueDetailById` added).
  Children run the normal classify→verify path but **never auto-apply** (gated on
  `parentSubmissionId != null` in classify/verify) — they always verify to get the AI's
  approve/don't-approve opinion, land in `queued_admin`, and **email `ADMIN_EMAIL`**
  (`lib/email/`, Resend via fetch, graceful no-op without `RESEND_API_KEY`). Operator does
  the final manual apply. **Scope (owner):** modify existing only; adding an offering to an
  existing HH is allowed (engine `new_offering` insert path) but NOT new HH windows or new
  venues (the separate `/submit/new-venue` path). Op cap 5 (`MAX_OPS`); bigger →
  `tooLarge` → parent to `queued_admin`. Children excluded from rate-limit counts + trust
  scoring (server-created). Migration `0003_optimal_ulik.sql` (enum values + parent col);
  tsc/eslint clean (2 pre-existing), build OK, migration applied. See memory
  `unified-report-change-flow`. `components/submit/suggest-edit.tsx` now unused
  (SubmissionForm still backs `/submit/new-venue`). Not yet runtime-tested with a real key.
- **Cluster schema + first-party seed pipeline — LANDED (2026-05-27, branch
  `cluster-schema-seed-pipeline`, commit `7fb9c6a`). DB has migrations 0004+0005
  applied; venue tables wiped (disposable, untrusted). Other model's pending update
  is expected to land on top of this commit.**
  - **`happy_hours.day_of_week` → `days_of_week smallint[]`.** One row per WINDOW
    (Mon–Fri = `{1..5}`), not per day. New CHECK enforces non-empty array of 1..7.
    Natural-key unique index includes the array (stored SORTED — both writers do
    `[...new Set(d)].sort()`). `crosses_midnight` generated column stays.
    `isWindowActive(w, now)` rewritten for arrays incl. cross-midnight on prev day.
    All read/write sites updated (see commit): `lib/geo/timezone`, `lib/queries/venues`,
    `scripts/seed-venues`, `scripts/seed-enrich-candidates`, `lib/apply/engine`
    (HAPPY_HOUR_FIELDS), `components/venue-table-client`, the venue page (JSON-LD
    `byDay` = array, display grouping flattens `daysOfWeek`), `lib/ai/interpreter`.
    Deleted unused `components/venue-table.tsx`. `formatDays(number[])` already array-shaped.
  - **Seed funnel (Tacoma, repeatable per city):** **`seed:discover` (tiled, chain
    denylist + junk-primary-type exclusion + Tacoma/Ruston ≤7km gate at insert)** →
    **`backfill:place-ids` (curated venues → canonical place_id)** → **`seed:enrich`
    (Place Details verify gate: must serve alcohol + have a website; single-pass
    Haiku web_fetch extractor with `web_search` + follow-links + first-party-source
    guard + structured `record_happy_hours` tool + deal consolidation; venue created
    even without HH so likely-HH locals stay as bottom-of-page stubs for crowdsource)**.
    Venues carry `priceLevel` + `heroImageUrl` (the latter still **broken**: Place
    Details `photos` field comes back empty — separate fix needed). Ops scripts:
    `reset-for-resource`, `prune-empty-venues`, `purge-source-data`, `ai-spend`,
    `export-candidates`. **No data on disk points at competitor HH-aggregator sites.**
  - **Lessons (see `[[enrich-extraction-lessons]]`):** structured-output via forced
    tool call avoids prose-narration truncation; `daysOfWeek` arrays in the tool
    schema (not per-day) keep output small; Haiku + `web_fetch` needs
    `allowed_callers: ["direct"]`. The extractor's ceiling is **data availability**
    (Parkway-type dives don't publish times anywhere online — they correctly become
    stubs); Cloverleaf-type sites with a `/promotions` or `/menu` page do extract.
  - **PENDING:** apply the other model's queued update on top of this commit; review
    shared files (`engine.ts`, `verify.ts`, `interpreter.ts`, `payload.ts`, venue page,
    `submission-form.tsx`) and any new migration's numbering. Then re-arm candidates
    and run `seed:enrich --limit 5` to demo a real Tacoma venue landing (the only
    end-to-end demo that hasn't happened yet).
- **What still needs the operator (not code):** API keys to *run* AI/seed/captcha/auth
  (`ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, hCaptcha, Firebase), Resend for email,
  and the §10 cloud deploy (DO droplet + managed PG + Cloudflare). All features degrade
  gracefully (no-op / fail-safe) until their key exists.
- **New deps this session:** `@anthropic-ai/sdk`, `pg-boss`, `firebase` (all now used).
  tsx resolves the `@/` alias at runtime (verified), so scripts may import `@/lib/*`.
- **Verification:** `tsc --noEmit`, `next build`, `eslint` all clean (except two
  pre-existing Phase 0 lint issues in `db/schema/moderation.ts` + `scripts/import-neighborhoods.ts`).
  Nothing runtime-tested against a live DB yet.

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
- **First-party data only.** Never seed/insert venue or HH/offering data sourced from
  competitor aggregators (ultimatehappyhours.com, seattletravel.com, Yelp, Groupon).
  Source guard in `lib/ai/extractHappyHours.ts` enforces this for AI sources; do not
  bypass it, recreate `data/tacoma-seed.json`, or restore a `seed:venues` script.

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

## Suggested next step (2026-05-27)

You're on branch **`cluster-schema-seed-pipeline`** (commit `7fb9c6a`). DB has
migrations 0004+0005 applied; venue tables are empty (wiped, disposable). The other
model's queued update is expected to land on top of this commit — review the merged
result first, focusing on the shared files (`engine.ts`, `verify.ts`, `interpreter.ts`,
`payload.ts`, venue page, `submission-form.tsx`) and any new migration's numbering.

Then to actually see a venue land end-to-end (the part that hasn't happened yet):
`docker compose up -d && npm run dev` → `npm run reset:for-resource -- --city tacoma`
(re-arm candidates) → `npx tsx scripts/seed-enrich-candidates.ts --limit 5` (cap at 5
to spend ~40¢, not $6+) → load `/tacoma`. Read `[[working-style-lessons]]` before
starting if you've never seeded with this operator. Known broken: hero photos
(Google Place Details returns no `photoName`).
