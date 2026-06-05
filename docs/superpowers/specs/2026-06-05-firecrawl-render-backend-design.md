# Firecrawl as a local render backend — design

**Date:** 2026-06-05
**Branch:** `feature/firecrawl-render-backend`
**Status:** Approved (brainstorming) → ready for implementation plan

## Problem

Many venue happy hours live on JS-rendered sites (Wix, Squarespace, React). Our
pipeline fetches the **raw** HTML over plain HTTP, so on these sites it sees an empty
SPA shell — the happy-hour text (and often the menu PDF/image link) is injected by
JavaScript in the browser and is therefore invisible to us. Those venues become stubs
even when their HH is plainly published. This is the "JS-walled sites" gap recorded in
memory `js-walled-sites-and-pdf-menus` ("the gap is DISCOVERY not extraction").

We already have a hand-rolled Playwright headless fallback (`lib/verification/renderUrl.ts`),
but it is only triggered on empty results and is ours to maintain.

## Goal

Adopt **self-hosted Firecrawl** (AGPL-3.0, runs locally in Docker — no cloud key) as a
**better render backend** behind our existing interfaces, to recover happy hours from
JS-rendered sites. Scoped to dev/Mac first; prove the recall lift cheaply before any
production or paid-path commitment.

## Non-goals (explicit)

- **No cost reduction claim.** Firecrawl replaces the part of the pipeline that is
  *already local and free* (fetch + Playwright render). It does **not** touch the paid
  stages: Claude extraction/verify/interpret/classify, or Google Places discovery.
  Cutting the API bill is a separate effort (local LLM for extraction; reducing Google
  Places calls) — deliberately out of scope here.
- **No PDF/image parsing via Firecrawl.** Claude already reads PDFs/images as
  document/vision blocks at high quality (Bottega: conf 0.95, ~2¢). Firecrawl's text
  extraction of a PDF would be *worse* (loses layout/vision). We use Firecrawl only to
  **surface** the link on JS sites; Claude still reads the document.
- **No rewrite of the plain-HTTP fast path.** `fetchUrl`'s plain fetch stays — it is free
  and works for static/server-rendered sites. Firecrawl is the **fallback render engine**,
  not the default fetch.
- **No production/droplet deploy in v1.** No Firecrawl `/extract` or `/agent` endpoints.
  No changes to discovery or any LLM stage.

## What Firecrawl specifically helps

Mapped onto our stages:

| Venue publishes HH as… | Static / server-rendered site | JS-rendered site (Wix/etc.) |
|---|---|---|
| **HTML text** | ✅ caught today (`stripHtml` → text block → Claude) | ❌ missed today → **✅ Firecrawl renders it** |
| **PDF link** | ✅ caught today | ⚠️ often missed → **✅ Firecrawl surfaces link** (Claude reads PDF) |
| **Image flyer** | ✅ caught today | ⚠️ often missed → **✅ Firecrawl surfaces it** (Claude reads image) |

The biggest win is the top-right cell: rendering JS so HH text written in HTML becomes
visible. PDF/image link discovery is a bonus on top.

Touched stages: `lib/places/siteTriage.ts` (homepage link discovery), and the render
fallback used by `lib/ai/siteContent.ts` via `lib/verification/renderUrl.ts`. Untouched:
the extractor, classifier, verifier, interpreter, and Google Places.

## Architecture

**Guiding principle: optional backend behind existing interfaces, never a rewrite.**
When `FIRECRAWL_URL` is unset, behavior is identical to today (CI, droplet, other
contributors unaffected). When set, JS rendering routes through Firecrawl with a
**Playwright fallback** if Firecrawl errors, times out, or returns empty.

```
siteTriage (homepage)  ─┐
                        ├─► renderHtml(url) ──► FIRECRAWL_URL set? ──► Firecrawl /scrape (JS render)
siteContent (fallback) ─┘                                  │ error / empty
                                                           └─► existing Playwright renderUrl()

PDFs / images ─────────────────────────────► unchanged: fetched as bytes → Claude document/vision blocks
```

## Components

1. **Firecrawl self-host setup** — `docker-compose.firecrawl.yml` + `docs/firecrawl-setup.md`.
   Self-hosted Firecrawl on the Mac (Docker), no cloud API key. Documented as dev-only.
   Note self-host limits: no Fire-engine anti-bot, no proxy rotation, ~1–2GB RAM.

2. **`lib/places/firecrawl.ts`** — thin client. `scrapeWithFirecrawl(url)` →
   `{ html, markdown, links[], pdfLinks[] } | null`. Reads `FIRECRAWL_URL`. Returns
   `null` on unset env / error / timeout so callers fall back cleanly. Independently
   testable with a mocked HTTP response. One clear interface, one dependency (env + fetch).

3. **Integration seam — `lib/verification/renderUrl.ts`** — try Firecrawl first when
   configured, else current Playwright path. **Same return shape**, so `siteContent.ts`
   needs no changes. Optionally surface JS-rendered links into `siteTriage.ts` if the
   benchmark shows triage-stage link discovery is the bottleneck (decided by data, may be
   deferred).

4. **Benchmark `scripts/bench-firecrawl.ts`** — over a chosen set of JS-walled stub
   venues, run triage + content assembly **with Firecrawl on vs off** and report deltas:
   readable-text chars, menu/HH links found, PDF/image links found, HH-signal hits.
   **$0** — content layer only, no Claude calls. This is the proof-of-lift gate.

## Data flow (enrich/recover path, Firecrawl on)

1. Have a venue website URL.
2. `siteTriage` fetches homepage (plain HTTP). If empty/SPA shell → render via Firecrawl
   → extract menu/HH links + page text.
3. `siteContent` fetches priority URLs (plain HTTP); on empty → Firecrawl render. PDFs/
   images still fetched as bytes for Claude.
4. Content blocks → Claude extractor (unchanged, PAID).
5. Realness gate → persist (unchanged).

## Error handling & fallback

- Firecrawl unreachable / 5xx / timeout / empty body → `scrapeWithFirecrawl` returns
  `null` → `renderUrl` falls back to Playwright. No hard dependency.
- `FIRECRAWL_URL` unset → Firecrawl path skipped entirely (today's behavior).
- Timeout bounded (e.g. matches existing render timeout) to avoid hangs (self-hosted
  Firecrawl has reported hang/429 issues).

## Validation gate

- The benchmark must show a **meaningful recall lift** (materially more sites yielding
  readable HH content/links) before wiring Firecrawl into the paid extract path or
  production. If lift is marginal, stop here — cheap to abandon.
- Then, optionally, run `reextract:stubs --venue` on venues that newly yield content
  (PAID Claude — requires explicit per-run OK per the cost-control rule) to confirm
  stub → HH conversions.

## Testing

- Unit-test `lib/places/firecrawl.ts` with mocked HTTP: success shape, error → `null`,
  unset env → `null`, timeout → `null`.
- Unit/behavior-test the `renderUrl` seam: Firecrawl success used; Firecrawl `null` →
  Playwright fallback invoked.
- The benchmark script doubles as an integration check against a live local Firecrawl.

## Configuration

- `FIRECRAWL_URL` — base URL of the local Firecrawl instance (e.g. `http://localhost:3002`).
  Unset everywhere by default. Added to `.env.example` with a dev-only note.

## Ops / workflow

- All work in the `feature/firecrawl-render-backend` worktree off `origin/main`; one
  branch → one PR (per the project's non-negotiable branch workflow).
- Docker compose file is dev-only; not wired into the production droplet in v1.

## Future (not now)

- Promote to the droplet once lift is proven (env-configurable `FIRECRAWL_URL` already
  supports this).
- Separate efforts for the cost axis: local LLM extraction (Ollama, with Claude
  fallback) and reducing Google Places discovery spend.
