# Firecrawl Render Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional self-hosted Firecrawl render backend behind the existing `renderUrl` fallback, so JS-rendered venue sites (Wix/Squarespace) yield their happy-hour text/links — with a Playwright fallback and zero behavior change when unconfigured.

**Architecture:** A thin client `lib/places/firecrawl.ts` calls a local Firecrawl `/v2/scrape` and returns the existing `FetchResult` shape, or `null` (unconfigured / error / PDF-or-image — those stay on the byte path so Claude reads the document directly). `renderUrl` tries Firecrawl first when `FIRECRAWL_URL` is set, else falls back to the current Playwright path. No changes to `siteContent.ts`, the extractor, or any LLM stage. A `$0` benchmark script measures the recall lift before any paid re-extract.

**Tech Stack:** TypeScript (strict), Node `fetch`, `tsx` test scripts with `node:assert`, Docker Compose for the self-hosted Firecrawl service.

**Spec:** `docs/superpowers/specs/2026-06-05-firecrawl-render-backend-design.md`

---

## File Structure

- **Create** `docs/firecrawl-setup.md` — how to clone/build/run + verify it locally.
  (Firecrawl self-host has **no published image** — you clone their repo and `docker compose
  build`, so we do NOT vendor a compose file; we document the clone-and-build flow instead.)
- **Create** `lib/places/firecrawl.ts` — `scrapeWithFirecrawl(url): Promise<FetchResult | null>`.
- **Create** `scripts/test-firecrawl-client.ts` — unit test for the client (hermetic, mocks `fetch`).
- **Modify** `lib/verification/renderUrl.ts` — try Firecrawl first when configured.
- **Create** `scripts/test-render-firecrawl.ts` — behavior test: Firecrawl-preferred path (hermetic).
- **Create** `scripts/bench-firecrawl.ts` — `$0` recall-lift benchmark (plain vs Playwright vs Firecrawl).
- **Modify** `package.json` — register the two new `test:*` scripts + a `bench:firecrawl` script.
- **Modify** `scripts/ci-tests.sh` — add the two new hermetic tests.
- **Modify** `.env.example` — document `FIRECRAWL_URL`.

---

## Task 1: Self-hosted Firecrawl setup doc

No automated test (infra). Manual verification only. Firecrawl self-host has **no published
image** — you clone their repo and build, so we document that flow rather than vendoring a
(wrong) compose file. The clone lives OUTSIDE this repo so it's never committed.

**Files:**
- Create: `docs/firecrawl-setup.md`

- [ ] **Step 1: Write the setup doc**

Create `docs/firecrawl-setup.md`:

````markdown
# Self-hosted Firecrawl (dev render backend)

Firecrawl renders JS-heavy venue sites (Wix/Squarespace) so their happy-hour text and
menu/PDF links become visible to our extractor. It is an **optional, dev-only** backend
behind `lib/verification/renderUrl.ts`. When `FIRECRAWL_URL` is unset, nothing changes.

There is no published Firecrawl image — you clone their repo and build it with Docker.
Clone it OUTSIDE this repo (e.g. `~/src/firecrawl`) so it is never committed here.

## Run it

```bash
git clone https://github.com/firecrawl/firecrawl.git ~/src/firecrawl
cd ~/src/firecrawl
# minimal self-host env: API on :3002, DB auth off (see their SELF_HOST.md for the full list)
printf 'PORT=3002\nHOST=0.0.0.0\nUSE_DB_AUTHENTICATION=false\n' > .env
docker compose build
docker compose up -d
# wait ~20–30s for the worker to boot, then smoke-test from anywhere:
curl -s -X POST http://localhost:3002/v2/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","formats":[{"type":"markdown"}]}' | head -c 400
```

A JSON body with `"success":true` and a `data.markdown` field means it works. If `/v2/scrape`
returns 404, your checkout is older — try `/v1/scrape` and update `SCRAPE_PATH` in
`lib/places/firecrawl.ts` accordingly.

Then add to this project's `.env`:

```
FIRECRAWL_URL=http://localhost:3002
```

## Stop it

```bash
cd ~/src/firecrawl && docker compose down
```

## Notes / limits

- **Self-host vs cloud:** the self-hosted build has **no Fire-engine** (advanced anti-bot)
  and **no proxy rotation**. It renders ordinary venue sites fine but will not beat
  aggressive Cloudflare/bot walls. Those venues stay stubs (correct outcome).
- **Resources:** budget ~1–2 GB RAM for the stack.
- **PDFs/images are NOT routed through Firecrawl** — our client returns `null` for them so
  the byte-fetch path hands the raw document to Claude (higher quality than Firecrawl's
  text parse). Firecrawl is used only to render HTML and surface links.
- This stack is **not** wired into the production droplet. Local/dev only for now.
````

- [ ] **Step 2: Verify manually (if Docker available)**

Follow the doc's "Run it" steps, then the `curl`. Expected: JSON with `"success":true`. If
Docker isn't running, skip — the code paths all degrade to Playwright, and the client unit
test (Task 2) is hermetic. Note which scrape path works (`/v2` vs `/v1`) for Task 2.

- [ ] **Step 3: Commit**

```bash
git add docs/firecrawl-setup.md
git commit -m "docs(firecrawl): self-host clone-and-build setup guide"
```

---

## Task 2: Firecrawl client (`lib/places/firecrawl.ts`) — TDD

**Files:**
- Create: `lib/places/firecrawl.ts`
- Test: `scripts/test-firecrawl-client.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-firecrawl-client.ts`:

```typescript
/**
 * Hermetic unit test for the Firecrawl render-backend client. Mocks global fetch; no
 * network, no Docker. Run: tsx scripts/test-firecrawl-client.ts
 */
import assert from "node:assert";
import { scrapeWithFirecrawl } from "@/lib/places/firecrawl";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => { passed++; console.log(`  ✓ ${name}`); });
}

const realFetch = globalThis.fetch;
const realEnv = process.env.FIRECRAWL_URL;
function mockFetch(impl: typeof globalThis.fetch) { globalThis.fetch = impl; }
function restore() { globalThis.fetch = realFetch; process.env.FIRECRAWL_URL = realEnv; }

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

async function main() {
  await check("returns null when FIRECRAWL_URL is unset", async () => {
    delete process.env.FIRECRAWL_URL;
    let called = false;
    mockFetch(async () => { called = true; return jsonResponse({}); });
    const r = await scrapeWithFirecrawl("https://venue.example/menu");
    assert.equal(r, null);
    assert.equal(called, false, "must not call fetch when unconfigured");
  });

  await check("returns null for a PDF/image URL without calling fetch", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    let called = false;
    mockFetch(async () => { called = true; return jsonResponse({}); });
    assert.equal(await scrapeWithFirecrawl("https://venue.example/menu.pdf"), null);
    assert.equal(await scrapeWithFirecrawl("https://venue.example/flyer.JPG"), null);
    assert.equal(called, false, "PDF/image URLs skip Firecrawl");
  });

  await check("maps a successful scrape to a FetchResult", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    mockFetch(async () => jsonResponse({
      success: true,
      data: {
        markdown: "Happy Hour Mon-Fri 4-6pm $5 wells",
        html: '<a href="/menus/hh.pdf">Happy Hour Menu</a>',
        links: ["https://venue.example/menus/hh.pdf"],
        metadata: { url: "https://venue.example/menu", statusCode: 200, contentType: "text/html" },
      },
    }));
    const r = await scrapeWithFirecrawl("https://venue.example/menu");
    assert.ok(r && r.ok, "ok result");
    assert.equal(r!.url, "https://venue.example/menu");
    assert.match(r!.contentText ?? "", /Happy Hour Mon-Fri/);
    assert.ok((r!.mediaLinks ?? []).some((m) => /hh\.pdf$/.test(m)), "surfaces the PDF link");
  });

  await check("returns null when Firecrawl reports a PDF content-type (redirect to doc)", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    mockFetch(async () => jsonResponse({
      success: true,
      data: { markdown: "garbled pdf text", metadata: { url: "https://venue.example/x", contentType: "application/pdf" } },
    }));
    assert.equal(await scrapeWithFirecrawl("https://venue.example/qr"), null);
  });

  await check("returns null on HTTP error, empty markdown, or thrown fetch", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    mockFetch(async () => jsonResponse({}, false));
    assert.equal(await scrapeWithFirecrawl("https://venue.example/a"), null, "http !ok");
    mockFetch(async () => jsonResponse({ success: true, data: { markdown: "  ", metadata: {} } }));
    assert.equal(await scrapeWithFirecrawl("https://venue.example/b"), null, "empty markdown");
    mockFetch(async () => { throw new Error("ECONNREFUSED"); });
    assert.equal(await scrapeWithFirecrawl("https://venue.example/c"), null, "thrown");
  });

  restore();
  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => { restore(); console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-firecrawl-client.ts`
Expected: FAIL — `Cannot find module '@/lib/places/firecrawl'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/places/firecrawl.ts`:

```typescript
/**
 * Optional self-hosted Firecrawl render backend. When FIRECRAWL_URL is set we render JS
 * pages through a local Firecrawl instead of (slower, hand-rolled) Playwright. Returns a
 * FetchResult so it slots into renderUrl with NO downstream changes, or null when:
 *   - FIRECRAWL_URL is unset,
 *   - the URL is a PDF/image (those stay on the byte path so Claude reads the doc directly),
 *   - Firecrawl reports the resource is a PDF/image (redirect-to-doc case), or
 *   - any error / empty result.
 * See docs/firecrawl-setup.md.
 */
import type { FetchResult } from "@/lib/verification/fetchUrl";
import { extractMediaLinks } from "@/lib/places/siteTriage";

const TIMEOUT_MS = 30_000;
const WAIT_FOR_MS = 2_000; // let JS render before capture
const SCRAPE_PATH = "/v2/scrape"; // older self-host checkouts use /v1/scrape — see docs/firecrawl-setup.md
const DOC_EXT = /\.(pdf|jpe?g|png|gif|webp)(\?|#|$)/i;

export async function scrapeWithFirecrawl(url: string): Promise<FetchResult | null> {
  const base = process.env.FIRECRAWL_URL;
  if (!base) return null;
  if (DOC_EXT.test(url)) return null; // byte path handles docs (Claude reads them directly)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${base.replace(/\/$/, "")}${SCRAPE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        formats: [{ type: "markdown" }, { type: "html" }, { type: "links" }],
        waitFor: WAIT_FOR_MS,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      success?: boolean;
      data?: {
        markdown?: string;
        html?: string;
        links?: string[];
        metadata?: { url?: string; sourceURL?: string; statusCode?: number; contentType?: string };
      };
    };
    if (!json?.success || !json.data) return null;
    const data = json.data;
    const ct = String(data.metadata?.contentType ?? "").toLowerCase();
    // Firecrawl followed a redirect to a doc — defer to the byte path so Claude gets the
    // real bytes (Firecrawl's text parse loses layout/vision).
    if (ct.includes("application/pdf") || ct.startsWith("image/")) return null;
    const text = typeof data.markdown === "string" ? data.markdown.trim() : "";
    if (!text) return null;
    const finalUrl = data.metadata?.url || data.metadata?.sourceURL || url;
    const html = typeof data.html === "string" ? data.html : "";
    const mediaLinks = html ? extractMediaLinks(html, finalUrl) : [];
    return {
      url: finalUrl,
      ok: true,
      status: data.metadata?.statusCode,
      contentType: ct || "text/html",
      contentText: text,
      mediaLinks,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-firecrawl-client.ts`
Expected: PASS — `5 checks passed.`

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/places/firecrawl.ts scripts/test-firecrawl-client.ts
git commit -m "feat(firecrawl): client returning FetchResult or null"
```

---

## Task 3: Wire Firecrawl into `renderUrl` — TDD

**Files:**
- Modify: `lib/verification/renderUrl.ts:53-60` (top of `renderUrl`, before `getBrowser`)
- Test: `scripts/test-render-firecrawl.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-render-firecrawl.ts`:

```typescript
/**
 * Hermetic test: when FIRECRAWL_URL is set and Firecrawl returns content, renderUrl returns
 * the Firecrawl FetchResult WITHOUT launching Chromium (the Firecrawl path short-circuits
 * before getBrowser). Mocks global fetch. Run: tsx scripts/test-render-firecrawl.ts
 */
import assert from "node:assert";
import { renderUrl } from "@/lib/verification/renderUrl";

let passed = 0;
function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => { passed++; console.log(`  ✓ ${name}`); });
}

const realFetch = globalThis.fetch;
const realEnv = process.env.FIRECRAWL_URL;

async function main() {
  await check("renderUrl prefers Firecrawl when configured", async () => {
    process.env.FIRECRAWL_URL = "http://localhost:3002";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          markdown: "Happy Hour daily 3-6pm",
          html: '<a href="/menu.pdf">menu</a>',
          metadata: { url: "https://venue.example/", statusCode: 200, contentType: "text/html" },
        },
      }),
    })) as unknown as typeof globalThis.fetch;

    const r = await renderUrl("https://venue.example/");
    assert.ok(r.ok, "ok");
    assert.match(r.contentText ?? "", /Happy Hour daily 3-6pm/, "uses Firecrawl content");
  });

  globalThis.fetch = realFetch;
  process.env.FIRECRAWL_URL = realEnv;
  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => {
  globalThis.fetch = realFetch;
  process.env.FIRECRAWL_URL = realEnv;
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-render-firecrawl.ts`
Expected: FAIL — without the wiring, `renderUrl` tries to launch Chromium (or returns
`ok:false`), so `contentText` won't match `/Happy Hour daily 3-6pm/`.

- [ ] **Step 3: Add the import**

In `lib/verification/renderUrl.ts`, add to the imports block (after line 17 `import { extractMediaLinks } ...`):

```typescript
import { scrapeWithFirecrawl } from "@/lib/places/firecrawl";
```

- [ ] **Step 4: Add the Firecrawl-first short-circuit**

In `lib/verification/renderUrl.ts`, the body currently starts:

```typescript
  const timeout = opts.timeoutMs ?? 20_000;
  const maxBytes = opts.maxBytes ?? 8_000_000;
  let ctx: BrowserContext | null = null;
  try {
    const browser = await getBrowser();
```

Insert the Firecrawl attempt immediately inside `try {`, before `const browser = await getBrowser();`:

```typescript
  const timeout = opts.timeoutMs ?? 20_000;
  const maxBytes = opts.maxBytes ?? 8_000_000;
  let ctx: BrowserContext | null = null;
  try {
    // Render backend: prefer a configured self-hosted Firecrawl over launching Chromium.
    // Returns null when unconfigured, on error, or for PDFs/images (which the byte path
    // below handles so Claude reads the document directly). See lib/places/firecrawl.ts.
    const fc = await scrapeWithFirecrawl(url);
    if (fc) return fc;

    const browser = await getBrowser();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/test-render-firecrawl.ts`
Expected: PASS — `1 checks passed.`

- [ ] **Step 6: Re-run the client test (no regression)**

Run: `npx tsx scripts/test-firecrawl-client.ts`
Expected: PASS — `5 checks passed.`

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/verification/renderUrl.ts scripts/test-render-firecrawl.ts
git commit -m "feat(firecrawl): renderUrl prefers Firecrawl over Playwright when configured"
```

---

## Task 4: `$0` recall-lift benchmark script

No automated test (it's a measurement tool that makes live fetches). It calls only the
content layer — **no Claude, no Google, $0**.

**Files:**
- Create: `scripts/bench-firecrawl.ts`

- [ ] **Step 1: Write the benchmark**

Create `scripts/bench-firecrawl.ts`:

```typescript
/**
 * $0 recall-lift benchmark for the Firecrawl render backend. For each URL, fetch the page
 * three ways and compare what content/links each surfaces:
 *   1. plain  — fetchUrl only (today's default fast path)
 *   2. pw     — renderUrl with Firecrawl DISABLED (Playwright headless)
 *   3. fc     — renderUrl with Firecrawl ENABLED (needs FIRECRAWL_URL + a running stack)
 * No Claude / Google calls — this only exercises the local content layer.
 *
 * Usage:
 *   tsx scripts/bench-firecrawl.ts <url> [url2 ...]
 *   tsx scripts/bench-firecrawl.ts --file urls.txt   # one URL per line
 *
 * Requires FIRECRAWL_URL set (and `docker compose -f docker-compose.firecrawl.yml up -d`)
 * for the `fc` column to be meaningful; otherwise `fc` mirrors `pw`.
 */
import { readFileSync } from "node:fs";
import { fetchUrl } from "@/lib/verification/fetchUrl";
import { renderUrl } from "@/lib/verification/renderUrl";

function parseArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") {
      const f = argv[++i];
      out.push(...readFileSync(f, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    } else if (argv[i].startsWith("http")) {
      out.push(argv[i]);
    }
  }
  return out;
}

type Stat = { textChars: number; mediaLinks: number; isDoc: boolean; ok: boolean };

function stat(r: { ok: boolean; contentText?: string; mediaLinks?: string[]; isPdf?: boolean; isImage?: boolean }): Stat {
  return {
    ok: r.ok,
    textChars: r.contentText?.length ?? 0,
    mediaLinks: r.mediaLinks?.length ?? 0,
    isDoc: Boolean(r.isPdf || r.isImage),
  };
}

async function main() {
  const urls = parseArgs(process.argv.slice(2));
  if (urls.length === 0) {
    console.error("Usage: tsx scripts/bench-firecrawl.ts <url> [...] | --file urls.txt");
    process.exit(1);
  }
  if (!process.env.FIRECRAWL_URL) {
    console.warn("⚠ FIRECRAWL_URL not set — `fc` column will mirror `pw` (Playwright).");
  }

  console.log(`\nURL                                               | plain text/links | pw text/links | fc text/links`);
  console.log("-".repeat(110));

  for (const url of urls) {
    const plain = stat(await fetchUrl(url, { maxContent: 28_000 }));

    const savedEnv = process.env.FIRECRAWL_URL;
    delete process.env.FIRECRAWL_URL; // force Playwright
    const pw = stat(await renderUrl(url));
    if (savedEnv) process.env.FIRECRAWL_URL = savedEnv;

    const fc = stat(await renderUrl(url)); // Firecrawl if configured, else Playwright again

    const fmt = (s: Stat) => `${s.ok ? "" : "✗"}${s.textChars}/${s.mediaLinks}${s.isDoc ? "(doc)" : ""}`;
    const short = url.length > 48 ? url.slice(0, 45) + "..." : url.padEnd(48);
    console.log(`${short} | ${fmt(plain).padEnd(16)} | ${fmt(pw).padEnd(13)} | ${fmt(fc)}`);
  }

  // Free the shared Chromium launched by the Playwright runs.
  await (await import("@/lib/verification/renderUrl")).closeRenderBrowser().catch(() => {});
  console.log("\nLegend: <textChars>/<mediaLinks>  — higher = more HH content recovered. (doc)=PDF/image bytes.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Smoke-run against a known JS site**

Run (Firecrawl stack up + `FIRECRAWL_URL` set): `npx tsx scripts/bench-firecrawl.ts https://example.com`
Expected: a table row printing without crashing. (Real lift measurement uses actual stub
venue URLs — see Task 6.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/bench-firecrawl.ts
git commit -m "feat(firecrawl): \$0 recall-lift benchmark (plain vs playwright vs firecrawl)"
```

---

## Task 5: Register scripts, CI tests, and env docs

**Files:**
- Modify: `package.json` (scripts block)
- Modify: `scripts/ci-tests.sh` (TESTS array)
- Modify: `.env.example`

- [ ] **Step 1: Add npm scripts**

In `package.json`, in the `"scripts"` object, add these three entries (next to the other
`test:*` entries, keeping valid JSON — add commas as needed):

```json
    "test:firecrawl-client": "tsx scripts/test-firecrawl-client.ts",
    "test:render-firecrawl": "tsx scripts/test-render-firecrawl.ts",
    "bench:firecrawl": "tsx scripts/bench-firecrawl.ts",
```

- [ ] **Step 2: Add the two hermetic tests to CI**

In `scripts/ci-tests.sh`, add to the `TESTS=( ... )` array (both are hermetic — they mock
`fetch` and never launch Chromium or hit the network):

```bash
  test:firecrawl-client
  test:render-firecrawl
```

- [ ] **Step 3: Document the env var**

In `.env.example`, add (near other optional pipeline vars):

```bash
# Optional: self-hosted Firecrawl render backend for the seed/enrich pipeline (dev-only).
# When set, JS-rendered venue pages are rendered via Firecrawl instead of Playwright.
# Start the stack with: docker compose -f docker-compose.firecrawl.yml up -d
# See docs/firecrawl-setup.md. Leave unset to use the Playwright fallback (default).
FIRECRAWL_URL=
```

- [ ] **Step 4: Run the full hermetic suite**

Run: `npm run test:ci`
Expected: all tests pass, including `test:firecrawl-client` and `test:render-firecrawl`.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/ci-tests.sh .env.example
git commit -m "chore(firecrawl): register tests, bench script, and FIRECRAWL_URL env"
```

---

## Task 6: Final verification + PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Typecheck + lint + full hermetic tests**

Run: `npm run typecheck && npm run test:ci`
Expected: typecheck clean; all CI tests pass. (Two pre-existing eslint issues in
`db/schema/moderation.ts` + `scripts/import-neighborhoods.ts` are known and unrelated.)

- [ ] **Step 2: Build (acceptance gate — proves the app bundle stays Playwright/Firecrawl-free)**

Run: `npm run build`
Expected: compiles. `lib/places/firecrawl.ts` uses only `fetch` + a type-only import, and
`renderUrl` is still only imported by prep-time scripts, so the app bundle is unaffected.

- [ ] **Step 3: (If Docker available) measure real lift**

Export a handful of JS-walled stub venue website URLs into `urls.txt` (one per line), then:

```bash
docker compose -f docker-compose.firecrawl.yml up -d   # wait ~20s
FIRECRAWL_URL=http://localhost:3002 npm run bench:firecrawl -- --file urls.txt
```

Expected: the `fc` column shows more `textChars` / `mediaLinks` than `pw`/`plain` on
JS-rendered sites. **This is the validation gate** — only proceed to a paid
`reextract:stubs --venue` run (explicit per-run cost OK) if lift is meaningful. Record the
result in the PR description.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feature/firecrawl-render-backend
gh pr create --title "feat: optional Firecrawl render backend for JS-walled sites" \
  --body "Adds an optional self-hosted Firecrawl render backend behind renderUrl. No behavior change when FIRECRAWL_URL is unset. PDFs/images stay on the Claude-reads-the-doc path. Includes a \$0 benchmark to measure recall lift before any paid re-extract. Spec: docs/superpowers/specs/2026-06-05-firecrawl-render-backend-design.md"
```

Expected: PR opens against `main`. Do NOT merge until the benchmark (Step 3) shows lift and
CI is green (per the project's one-branch-one-PR, integrate-only-via-PR workflow).

---

## Notes for the implementer

- **Don't touch** `lib/ai/siteContent.ts`, `lib/ai/extractHappyHours.ts`, the classifier,
  verifier, interpreter, or any Google/discovery code. The whole point is that `renderUrl`
  is the single seam.
- **PDFs/images must keep going to Claude as document/vision blocks** — that path already
  works at conf 0.95. The client deliberately returns `null` for them.
- **`extractMediaLinks(html, baseUrl)`** is already exported from `lib/places/siteTriage.ts`
  (used by both `fetchUrl` and `renderUrl` today) and returns `string[]`.
- The two unit tests are hermetic (mock `fetch`); the fallback-to-Playwright path and the
  real lift are validated by the benchmark, since exercising Chromium isn't hermetic.
