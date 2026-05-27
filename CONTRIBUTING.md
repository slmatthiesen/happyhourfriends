# Contributing to Happy Hour Friends

Thanks for your interest! This project aggregates happy-hour data with a strong promise:
**we never display unverified or hallucinated data.** Most of the rules below exist to
protect that promise, so please read them before opening a PR that touches the data path.

## Getting set up

See the [Quick start](README.md#quick-start) in the README. In short: Node 20+, Docker
Desktop running, then `cp .env.example .env`, `docker compose up -d`, `npm install`,
`npm run db:migrate`, `npm run seed:cities`, `npm run seed:venues`, `npm run dev`.

Every external integration is optional and degrades gracefully, so you can develop most
of the app with only `DATABASE_URL` set.

## Before you open a PR

Run the full local gate (CI runs the same):

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # acceptance gate
```

- Keep PRs focused; describe what changed and why.
- Match the style of the surrounding code (comment density, naming, idioms).
- Don't commit secrets, `.env`, or anything under `public/uploads/` (all gitignored).
  CI runs a secret scan on every push.

## Heads-up: this is not the Next.js you may know

We pin **Next.js 16 (App Router, Turbopack)**, which has breaking changes from older
versions. Before writing framework code, check the bundled docs in
`node_modules/next/dist/docs/` rather than relying on memory. See [`AGENTS.md`](AGENTS.md).

## Data non-negotiables

These are enforced by the schema and/or the apply engine. Violating them breaks the
product's core promise:

1. **Never hallucinate data.** A missing value is `null`. No happy-hour info means *no*
   `happy_hours` rows (the venue becomes a "help wanted" stub) — never a guess.
2. **Every applied change needs a `source_url`.** For happy-hour/offering changes the
   source can be a link *or* an uploaded photo/PDF of the menu, but it must exist.
3. **Day-of-week is ISO: 1 = Monday … 7 = Sunday** (enforced by a DB CHECK).
4. **Times are venue-local.** "Happening now" converts the current time into the venue's
   timezone — never normalize stored times to UTC.
5. **Dedup venues on `google_place_id`, never by name** (chains are real).
6. **All writes funnel through the apply engine** (`lib/apply/engine.ts`), which audits
   every change and makes it revertible. Don't add write paths around it.
7. **Prompts are versioned** in `/prompts/`; their content hash is recorded with each AI
   call. Update the prompt file, don't inline prompt text.

When the PRD is ambiguous or conflicts with your change, ask in the issue/PR rather than
assuming.

## Uploads & untrusted input

Anonymous uploads are re-encoded (images) or magic-byte validated (PDFs) server-side in
`lib/submit/evidenceStore.ts`, and served with hardened headers. If you touch the upload
or submission path, preserve those guarantees and call them out in your PR.

## <a name="data-and-licensing"></a>Data and licensing

The code is [MIT](LICENSE). The **seed dataset under `data/`** may include facts compiled
from third-party editorial sources and can carry separate provenance/attribution
requirements. Do not assume the MIT license extends to redistributing that dataset, and
don't add scraped third-party content to the repo without clearing its licensing first.
New seed data should cite a verifiable source per row.

## Reporting security issues

Do **not** use public issues for vulnerabilities — see [`SECURITY.md`](SECURITY.md).

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
