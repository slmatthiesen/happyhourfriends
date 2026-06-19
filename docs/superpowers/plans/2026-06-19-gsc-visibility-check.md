# GSC Search-Visibility Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull Google Search Console impressions, resolve each landing page to a venue with its data-status, and emit a `$0` deterministic report that a weekly Claude routine reads to verify search-visible entries answer their queries — bubbling up the bad ones.

**Architecture:** A thin committed script `pnpm gsc:pull` does all deterministic work (service-account auth → Search Analytics fetch → page→venue resolution → report file). A weekly scheduled routine runs it, judges each entry natively, and messages the operator. Code is split into a pure URL resolver, a swappable GSC client behind an interface, and a pure report builder — each unit-testable in isolation.

**Tech Stack:** TypeScript (strict), `tsx` scripts, `google-auth-library` (service-account JWT) + `fetch` to the Search Console REST API, Drizzle queries (`lib/queries/venues.ts`), `node:assert` hermetic tests registered in `scripts/ci-tests.sh`.

---

## File Structure

- `lib/gsc/resolvePage.ts` — **pure**: landing-page URL → route entity (`venue` / `city` / `neighborhood` / `static`). No I/O.
- `lib/gsc/client.ts` — `SearchAnalyticsClient` interface + types + `googleSearchConsoleClient()` factory (real service-account implementation). The interface is the swap/fake seam.
- `lib/gsc/report.ts` — **pure**: `buildReport(rows, lookup)` groups rows by page, resolves each, enriches venue pages via an injected lookup, sorts by impressions.
- `scripts/gsc-pull.ts` — orchestrator: real client + real DB lookup → writes `tmp/gsc-report.json` + `tmp/gsc-report.md`. Wired as `pnpm gsc:pull`.
- `scripts/test-gsc-resolve-page.ts` — hermetic test for the resolver.
- `scripts/test-gsc-report.ts` — hermetic test for the report builder (fake client rows + fake lookup).
- `.env.example`, `package.json`, `scripts/ci-tests.sh` — wiring.
- The routine — created via the `schedule` skill (no repo code).

### Shared types (defined in Task 2, used everywhere)

```ts
// lib/gsc/client.ts
export interface SearchAnalyticsRow {
  page: string;
  query: string;
  impressions: number;
  clicks: number;
  position: number;
}

export interface SearchAnalyticsQuery {
  property: string;   // e.g. "sc-domain:happyhourfriends.com"
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  rowLimit: number;
}

export interface SearchAnalyticsClient {
  fetchRows(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]>;
}
```

---

## Task 1: Pure landing-page resolver

**Files:**
- Create: `lib/gsc/resolvePage.ts`
- Test: `scripts/test-gsc-resolve-page.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-gsc-resolve-page.ts
/**
 * Runnable check: resolvePage maps GSC landing-page URLs to our route entities.
 * Run: tsx scripts/test-gsc-resolve-page.ts
 */
import assert from "node:assert";
import { resolvePage } from "@/lib/gsc/resolvePage";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

check("venue page", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland/venue/alamar"), {
    kind: "venue", stateSlug: "ca", citySlug: "oakland", slug: "alamar",
  });
});
check("city page", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland"), {
    kind: "city", stateSlug: "ca", citySlug: "oakland",
  });
});
check("neighborhood page", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland/temescal"), {
    kind: "neighborhood", stateSlug: "ca", citySlug: "oakland", neighborhoodSlug: "temescal",
  });
});
check("trailing slash + query string are ignored", () => {
  assert.deepEqual(resolvePage("https://happyhourfriends.com/ca/oakland/venue/alamar/?utm=x"), {
    kind: "venue", stateSlug: "ca", citySlug: "oakland", slug: "alamar",
  });
});
check("known static routes", () => {
  for (const p of ["/", "/about", "/faq", "/for-restaurants", "/submit", "/styleguide"]) {
    assert.equal(resolvePage(`https://happyhourfriends.com${p}`).kind, "static", p);
  }
});
check("admin/api/_next are static", () => {
  for (const p of ["/admin/stubs", "/api/flags", "/_next/static/x.js"]) {
    assert.equal(resolvePage(`https://happyhourfriends.com${p}`).kind, "static", p);
  }
});

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx scripts/test-gsc-resolve-page.ts`
Expected: FAIL — `Cannot find module '@/lib/gsc/resolvePage'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/gsc/resolvePage.ts
/**
 * Maps a GSC landing-page URL to the route entity it represents, mirroring the
 * app's route tree: /[state]/[city], /[state]/[city]/[neighborhood],
 * /[state]/[city]/venue/[slug]. Anything else (home, /about, /admin, assets) is static.
 * Pure — no I/O — so it's unit-testable with URL fixtures.
 */
export type ResolvedPage =
  | { kind: "venue"; stateSlug: string; citySlug: string; slug: string }
  | { kind: "city"; stateSlug: string; citySlug: string }
  | { kind: "neighborhood"; stateSlug: string; citySlug: string; neighborhoodSlug: string }
  | { kind: "static"; path: string };

const STATIC_FIRST_SEGMENTS = new Set([
  "about", "faq", "for-restaurants", "submit", "styleguide",
  "admin", "api", "_next", "sitemap.xml", "robots.txt", "llms.txt", "manifest.webmanifest",
]);

export function resolvePage(pageUrl: string): ResolvedPage {
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = pageUrl;
  }
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0 || STATIC_FIRST_SEGMENTS.has(segments[0])) {
    return { kind: "static", path };
  }
  if (segments.length === 4 && segments[2] === "venue") {
    return { kind: "venue", stateSlug: segments[0], citySlug: segments[1], slug: segments[3] };
  }
  if (segments.length === 3) {
    return { kind: "neighborhood", stateSlug: segments[0], citySlug: segments[1], neighborhoodSlug: segments[2] };
  }
  if (segments.length === 2) {
    return { kind: "city", stateSlug: segments[0], citySlug: segments[1] };
  }
  return { kind: "static", path };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-gsc-resolve-page.ts`
Expected: PASS — `6 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/gsc/resolvePage.ts scripts/test-gsc-resolve-page.ts
git commit -m "feat(gsc): pure landing-page URL resolver"
```

---

## Task 2: GSC client interface + service-account implementation

**Files:**
- Create: `lib/gsc/client.ts`

No unit test: the real client needs live auth + network (excluded from CI, same policy as `test:email`). The interface is exercised by the report test in Task 3 via a fake. Verify with `pnpm typecheck` and the manual smoke test in Task 4.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add google-auth-library`
Expected: adds `google-auth-library` to `dependencies` in `package.json`.

- [ ] **Step 2: Write the client**

```ts
// lib/gsc/client.ts
/**
 * Google Search Console (Search Analytics API) access behind a small interface so the
 * data source is swappable and fakeable in tests. The real implementation authenticates
 * with a service-account JSON key (read-only webmasters scope) and POSTs to the REST
 * searchAnalytics/query endpoint. See docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md
 * for the one-time service-account setup.
 */
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

export interface SearchAnalyticsRow {
  page: string;
  query: string;
  impressions: number;
  clicks: number;
  position: number;
}

export interface SearchAnalyticsQuery {
  property: string;
  startDate: string;
  endDate: string;
  rowLimit: number;
}

export interface SearchAnalyticsClient {
  fetchRows(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]>;
}

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** Build the real GSC client from env. Throws loudly if creds are missing. */
export function googleSearchConsoleClient(): SearchAnalyticsClient {
  const keyPath = process.env.GSC_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "GSC_SERVICE_ACCOUNT_KEY_PATH is not set. See the setup steps in " +
      "docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md",
    );
  }
  const key = JSON.parse(readFileSync(keyPath, "utf8")) as { client_email: string; private_key: string };
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE] });

  return {
    async fetchRows(q: SearchAnalyticsQuery): Promise<SearchAnalyticsRow[]> {
      const { token } = await auth.getAccessToken();
      const endpoint =
        `https://searchconsole.googleapis.com/webmasters/v3/sites/` +
        `${encodeURIComponent(q.property)}/searchAnalytics/query`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: q.startDate,
          endDate: q.endDate,
          dimensions: ["page", "query"],
          rowLimit: q.rowLimit,
        }),
      });
      if (!res.ok) {
        throw new Error(`GSC API ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        rows?: { keys: [string, string]; clicks: number; impressions: number; position: number }[];
      };
      return (data.rows ?? []).map((r) => ({
        page: r.keys[0],
        query: r.keys[1],
        impressions: r.impressions,
        clicks: r.clicks,
        position: r.position,
      }));
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add lib/gsc/client.ts package.json pnpm-lock.yaml
git commit -m "feat(gsc): Search Analytics client behind a swappable interface"
```

---

## Task 3: Pure report builder

**Files:**
- Create: `lib/gsc/report.ts`
- Test: `scripts/test-gsc-report.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/test-gsc-report.ts
/**
 * Runnable check: buildReport groups GSC rows by page, resolves each page, enriches
 * venue pages via the injected lookup, derives status, and sorts by impressions.
 * Run: tsx scripts/test-gsc-report.ts
 */
import assert from "node:assert";
import { buildReport, type VenueLookup } from "@/lib/gsc/report";
import type { SearchAnalyticsRow } from "@/lib/gsc/client";

let passed = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => { passed++; console.log(`  ✓ ${name}`); });
}

const rows: SearchAnalyticsRow[] = [
  { page: "https://x.com/ca/oakland/venue/alamar", query: "alamar happy hour", impressions: 40, clicks: 5, position: 3 },
  { page: "https://x.com/ca/oakland/venue/alamar", query: "happy hour oakland", impressions: 10, clicks: 0, position: 8 },
  { page: "https://x.com/ca/oakland/venue/stubby",  query: "stubby happy hour times", impressions: 25, clicks: 0, position: 6 },
  { page: "https://x.com/ca/oakland",               query: "oakland happy hour", impressions: 5, clicks: 1, position: 9 },
];

const lookup: VenueLookup = async ({ slug }) => {
  if (slug === "alamar") return { name: "alaMar", windowCount: 2, offeringCount: 12 };
  if (slug === "stubby") return { name: "Stubby Bar", windowCount: 0, offeringCount: 0 };
  return null;
};

await check("groups by page and sorts by impressions desc", async () => {
  const report = await buildReport(rows, lookup);
  assert.equal(report.length, 3);
  assert.deepEqual(report.map((e) => e.impressions), [50, 25, 5]);
});

await check("venue status derives from window/offering counts", async () => {
  const report = await buildReport(rows, lookup);
  const alamar = report.find((e) => e.page.endsWith("/alamar"))!;
  const stubby = report.find((e) => e.page.endsWith("/stubby"))!;
  assert.equal(alamar.venue!.status, "complete");
  assert.equal(stubby.venue!.status, "stub");
});

await check("unresolved venue (lookup null) is tagged", async () => {
  const r: SearchAnalyticsRow[] = [
    { page: "https://x.com/ca/oakland/venue/ghost", query: "ghost", impressions: 3, clicks: 0, position: 7 },
  ];
  const report = await buildReport(r, lookup);
  assert.equal(report[0].venue!.status, "unresolved");
});

await check("top queries are sorted and capped at 5", async () => {
  const report = await buildReport(rows, lookup);
  const alamar = report.find((e) => e.page.endsWith("/alamar"))!;
  assert.deepEqual(alamar.topQueries.map((q) => q.query), ["alamar happy hour", "happy hour oakland"]);
});

await check("city page has no venue block", async () => {
  const report = await buildReport(rows, lookup);
  const city = report.find((e) => e.kind === "city")!;
  assert.equal(city.venue, undefined);
});

console.log(`\n${passed} checks passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec tsx scripts/test-gsc-report.ts`
Expected: FAIL — `Cannot find module '@/lib/gsc/report'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/gsc/report.ts
/**
 * Groups raw GSC rows by landing page, resolves each page to a route entity, and for
 * venue pages enriches with the venue's data-status via an injected lookup (so this stays
 * pure and testable — the DB call lives in the orchestrator). Status reflects how well the
 * entry can answer a happy-hour query: no windows = stub, windows but no deals = bare.
 */
import { resolvePage, type ResolvedPage } from "@/lib/gsc/resolvePage";
import type { SearchAnalyticsRow } from "@/lib/gsc/client";

export type VenueStatus = "stub" | "bare" | "complete" | "unresolved";

export type VenueLookup = (resolved: {
  stateSlug: string;
  citySlug: string;
  slug: string;
}) => Promise<{ name: string; windowCount: number; offeringCount: number } | null>;

export interface PageReportEntry {
  page: string;
  kind: ResolvedPage["kind"];
  impressions: number;
  clicks: number;
  topQueries: { query: string; impressions: number; clicks: number }[];
  venue?: { name: string | null; status: VenueStatus; windowCount: number; offeringCount: number };
}

function deriveStatus(windowCount: number, offeringCount: number): VenueStatus {
  if (windowCount === 0) return "stub";
  if (offeringCount === 0) return "bare";
  return "complete";
}

export async function buildReport(
  rows: SearchAnalyticsRow[],
  lookup: VenueLookup,
): Promise<PageReportEntry[]> {
  const byPage = new Map<string, SearchAnalyticsRow[]>();
  for (const row of rows) {
    const list = byPage.get(row.page) ?? [];
    list.push(row);
    byPage.set(row.page, list);
  }

  const entries: PageReportEntry[] = [];
  for (const [page, pageRows] of byPage) {
    const resolved = resolvePage(page);
    const impressions = pageRows.reduce((n, r) => n + r.impressions, 0);
    const clicks = pageRows.reduce((n, r) => n + r.clicks, 0);
    const topQueries = pageRows
      .slice()
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5)
      .map((r) => ({ query: r.query, impressions: r.impressions, clicks: r.clicks }));

    const entry: PageReportEntry = { page, kind: resolved.kind, impressions, clicks, topQueries };

    if (resolved.kind === "venue") {
      const found = await lookup(resolved);
      entry.venue = found
        ? { name: found.name, status: deriveStatus(found.windowCount, found.offeringCount), windowCount: found.windowCount, offeringCount: found.offeringCount }
        : { name: null, status: "unresolved", windowCount: 0, offeringCount: 0 };
    }
    entries.push(entry);
  }

  return entries.sort((a, b) => b.impressions - a.impressions);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec tsx scripts/test-gsc-report.ts`
Expected: PASS — `6 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/gsc/report.ts scripts/test-gsc-report.ts
git commit -m "feat(gsc): pure report builder (group/resolve/status/sort)"
```

---

## Task 4: `gsc:pull` orchestrator script

**Files:**
- Create: `scripts/gsc-pull.ts`
- Modify: `package.json` (add `"gsc:pull"` script)

No CI test (needs creds + DB). Verified by typecheck + manual smoke run.

- [ ] **Step 1: Write the orchestrator**

```ts
// scripts/gsc-pull.ts
/**
 * gsc:pull — deterministic ($0, no AI) Search Console pull. Fetches the last N days of
 * page+query impressions, resolves each landing page to a venue with its data-status, and
 * writes tmp/gsc-report.{json,md}. The weekly routine reads the report and does the AI
 * verification + bubble-up. See docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md.
 *
 * Usage:
 *   tsx scripts/gsc-pull.ts                 # last 28 days, up to 1000 rows
 *   tsx scripts/gsc-pull.ts --days 90 --limit 5000
 *
 * Required env: GSC_SERVICE_ACCOUNT_KEY_PATH, GSC_PROPERTY, DATABASE_URL.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { googleSearchConsoleClient } from "@/lib/gsc/client";
import { buildReport, type VenueLookup, type PageReportEntry } from "@/lib/gsc/report";
import { getCityByPath, getVenueBySlug } from "@/lib/queries/venues";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function isoDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

const lookup: VenueLookup = async ({ stateSlug, citySlug, slug }) => {
  const city = await getCityByPath(stateSlug, citySlug);
  if (!city) return null;
  const venue = await getVenueBySlug(city.id, slug);
  if (!venue) return null;
  const windowCount = venue.happyHours.length;
  const offeringCount = venue.happyHours.reduce((n, w) => n + w.offerings.length, 0);
  return { name: venue.name, windowCount, offeringCount };
};

function toMarkdown(report: PageReportEntry[]): string {
  const lines = ["# GSC visibility report", ""];
  for (const e of report) {
    const status = e.venue ? ` — **${e.venue.status}** (${e.venue.windowCount}w/${e.venue.offeringCount}o)` : ` — ${e.kind}`;
    lines.push(`## ${e.page}${status}`);
    lines.push(`impressions ${e.impressions} · clicks ${e.clicks}`);
    for (const q of e.topQueries) lines.push(`- "${q.query}" (${q.impressions} impr)`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const property = process.env.GSC_PROPERTY;
  if (!property) {
    throw new Error("GSC_PROPERTY is not set. See docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md");
  }
  const days = arg("days", 28);
  const rowLimit = arg("limit", 1000);

  const client = googleSearchConsoleClient();
  const rows = await client.fetchRows({
    property,
    startDate: isoDaysAgo(days),
    endDate: isoDaysAgo(0),
    rowLimit,
  });
  console.log(`Fetched ${rows.length} page+query rows over ${days} days.`);

  const report = await buildReport(rows, lookup);
  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/gsc-report.json", JSON.stringify(report, null, 2));
  writeFileSync("tmp/gsc-report.md", toMarkdown(report));

  const flagged = report.filter((e) => e.venue && e.venue.status !== "complete");
  console.log(`Wrote tmp/gsc-report.json + .md — ${report.length} pages, ${flagged.length} venue pages flagged (stub/bare/unresolved).`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add the package.json script**

In `package.json` `scripts`, add (alphabetically near other top-level scripts):

```json
"gsc:pull": "tsx scripts/gsc-pull.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke test (needs creds + DB)**

Run: `pnpm gsc:pull --days 28`
Expected: prints `Fetched N page+query rows…` then `Wrote tmp/gsc-report.json + .md…`. Open `tmp/gsc-report.md` and confirm venue pages show a status. If GSC has no data yet, `N` may be 0 and the report is empty — that is success, not an error. (Auth/property errors fail loud with a pointer to the spec.)

- [ ] **Step 5: Commit**

```bash
git add scripts/gsc-pull.ts package.json
git commit -m "feat(gsc): gsc:pull orchestrator writes visibility report"
```

---

## Task 5: Wire env docs + CI tests

**Files:**
- Modify: `.env.example`
- Modify: `scripts/ci-tests.sh`
- Modify: `package.json`
- Modify: `.gitignore` (ensure `tmp/` is ignored)

- [ ] **Step 1: Document env vars**

Append to `.env.example`:

```
# Google Search Console (gsc:pull) — service-account read access to the property.
# See docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md for setup.
GSC_SERVICE_ACCOUNT_KEY_PATH=
GSC_PROPERTY=sc-domain:happyhourfriends.com
```

- [ ] **Step 2: Register the two hermetic tests**

In `package.json` `scripts`, add:

```json
"test:gsc-resolve-page": "tsx scripts/test-gsc-resolve-page.ts",
"test:gsc-report": "tsx scripts/test-gsc-report.ts",
```

In `scripts/ci-tests.sh`, add to the `TESTS=(` array:

```
  test:gsc-resolve-page
  test:gsc-report
```

- [ ] **Step 3: Ignore the report output**

Confirm `.gitignore` contains `tmp/`. If absent, add a line:

```
tmp/
```

- [ ] **Step 4: Run the full hermetic suite**

Run: `pnpm test:ci`
Expected: the suite passes, including the two new `test:gsc-*` lines.

- [ ] **Step 5: Commit**

```bash
git add .env.example scripts/ci-tests.sh package.json .gitignore
git commit -m "chore(gsc): document env, register hermetic tests, ignore tmp report"
```

---

## Task 6: Create the weekly routine

**Files:** none (the routine is created via the `schedule` skill, not repo code).

- [ ] **Step 1: Confirm `gsc:pull` runs green** (Task 4 smoke test passed).

- [ ] **Step 2: Create the routine via the `schedule` skill**

Invoke the `schedule` skill to create a **weekly** routine with this prompt:

```
Run `pnpm gsc:pull` in the happyhourfriends repo, then read tmp/gsc-report.json.
For each entry of kind "venue" with impressions > 0, judge whether the entry answers
the queries that earned its impressions. Verdict per page:
  - good            (status complete and queries are satisfied)
  - stub-with-demand (status stub but real query demand — high priority)
  - incomplete      (status bare, or missing data the queries clearly want)
  - looks-wrong     (data appears incorrect for the queries)
Do NOT modify any data. Message me (Steven) a concise list of every non-"good" entry:
venue name, page, total impressions, top query, verdict, one-line reason, and the
suggested command `pnpm reextract:stubs --city <slug> --state <code> --dry-run` for
stub/incomplete cases. If gsc:pull reports 0 rows, say so and stop.
```

- [ ] **Step 3: Verify the routine is registered**

Confirm via the `schedule` skill's list that the weekly routine exists with the correct cadence and prompt.

---

## Self-Review Notes

- **Spec coverage:** auth/client (Task 2), page→venue resolve (Tasks 1+4), `$0` deterministic report (Tasks 3+4), weekly routine + bubble-up-only (Task 6), error handling — loud on missing creds (Task 2/4), empty-data-is-not-an-error (Task 4 smoke), unresolved slug (Task 3 test), provider abstraction (Task 2 interface + Task 3 injected lookup), tests (Tasks 1,3,5), env setup docs (Task 5 + spec). All covered.
- **Types:** `SearchAnalyticsRow`/`SearchAnalyticsClient` defined once in `client.ts` and imported by `report.ts`, the report test, and `gsc-pull.ts`. `VenueLookup`/`PageReportEntry`/`VenueStatus` defined in `report.ts`, consumed by `gsc-pull.ts`. `resolvePage`/`ResolvedPage` defined in `resolvePage.ts`, consumed by `report.ts`. Consistent across tasks.
- **No auto-fix:** the routine prompt explicitly says "Do NOT modify any data" (v1 = bubble-up only).
```
