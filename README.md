# Happy Hour Friends

A web app that aggregates restaurant and bar happy hours into a single sortable,
filterable table. Anyone can submit corrections and additions without an account; an
AI moderation pipeline reviews every submission, verifies plausible changes against the
venue's own website and social channels, auto-applies low-risk verified changes, and
escalates the rest to a human admin. **The site never displays unverified or
hallucinated data** — venues with no confirmed happy hour render as explicit "help us
fill this in" stubs.

Launch market: Tacoma, WA. The schema is multi-city-native by design.

> **Status:** in active development. Read [`PRD.md`](PRD.md) for the product spec and
> [`CLAUDE.md`](CLAUDE.md) for current implementation state and decisions.

## Core principles

1. **No hallucinated data.** Every field in the live dataset traces to a verifiable
   source. Missing data renders as a public "help wanted" prompt.
2. **Table-first UX.** A dense, sortable, filterable table is the primary surface;
   per-venue pages exist mainly for SEO.
3. **Anonymous-friendly contributions.** No login to submit. Trust is built from
   browser-fingerprint + IP history, not accounts.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind 4 +
shadcn/ui · Drizzle ORM + drizzle-kit (versioned migrations) · postgres.js ·
PostgreSQL + PostGIS · pg-boss (background jobs) · firebase-admin (admin auth) ·
Anthropic SDK (moderation pipeline) · Sentry + PostHog.

## Quick start

Requires **Node 20+** and **Docker Desktop** running (for local Postgres+PostGIS).

```bash
cp .env.example .env         # fill in what you need; all keys degrade gracefully
docker compose up -d         # local postgis; DATABASE_URL in .env points here
npm install
npm run db:migrate           # apply versioned migrations
npm run seed:cities          # seed the Tacoma city row (idempotent)
npm run seed:venues          # load committed real seed data into /tacoma
npm run dev                  # http://localhost:3000  ->  /tacoma
```

`npm run build` is the acceptance gate; `npm run typecheck` checks types only.

### Configuration

Every external integration is optional and **degrades gracefully** (no-op or fail-safe)
until its key is set — see [`.env.example`](.env.example) for the full list:

| Concern          | Vars                                          | Without it |
|------------------|-----------------------------------------------|------------|
| Database         | `DATABASE_URL`                                | required   |
| AI moderation    | `ANTHROPIC_API_KEY`                           | submissions queue for a human admin instead of auto-applying |
| Venue discovery  | `GOOGLE_PLACES_API_KEY`                       | seed/discovery scripts are no-ops |
| Spam protection  | `HCAPTCHA_*`                                  | captcha skipped in dev; **fails closed in production** |
| Admin sign-in    | `FIREBASE_*`, `ADMIN_EMAIL`                   | admin routes are inaccessible |
| Email, telemetry | `RESEND_*`, `SENTRY_*`, `NEXT_PUBLIC_POSTHOG_*` | disabled |

## How submissions flow

1. **Submit** — anonymous `POST /api/submissions` (honeypot + hCaptcha + rate limits).
   A happy-hour/offering change must carry evidence: a source URL **or** a photo/PDF of
   the menu (uploads are re-encoded and stripped of metadata server-side).
2. **Classify** — a background job risk-classifies the change (Stage 1).
3. **Verify** — plausible changes are checked against the venue's own sources, including
   reading menu photos/PDFs directly (Stage 2).
4. **Apply or escalate** — low-risk verified changes auto-apply through the apply engine
   (every write is audited and revertible); everything else lands in the admin queue.

## Contributing & security

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, conventions, and the project's
  data non-negotiables (read these before touching the data path).
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability privately.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE). Note: the bundled seed dataset in `data/` may have separate provenance —
see [`CONTRIBUTING.md`](CONTRIBUTING.md#data-and-licensing) before redistributing it.
