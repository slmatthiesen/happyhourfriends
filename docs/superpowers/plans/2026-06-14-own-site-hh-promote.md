# Own-site Happy-Hour Auto-Promote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-clean the hidden-HH backlog by probing each no-live-HH venue's own site for a reachable happy-hour page, re-extracting from it to go live; bake that own-site priority into enrich so future runs land live; and give a confirmed-unreadable manual-entry fallback that goes live on submit.

**Architecture:** One $0 plain-HTTP probe classifies a venue's own HH page as `readable | blocked | none`; the verdict is persisted on `venues` and reused by three consumers — an orchestrator script (re-extract via the canonical `resolveVenue` path), the enrich URL-priority ordering, and an admin manual-entry queue. Re-extract and operator entry are the ONLY paths to a live window (no shape-heuristic promotion).

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict, Drizzle ORM + drizzle-kit migrations, postgres.js, tsx runnable test scripts (`node:assert/strict`, no framework), existing `lib/places/siteTriage` + `lib/recover/resolveVenue`.

**Source spec:** `docs/superpowers/specs/2026-06-14-own-site-hh-promote-design.md`

---

## File Structure

- **Create** `lib/places/ownSiteHhProbe.ts` — pure-ish probe: classify own-site HH page (injectable fetcher).
- **Create** `scripts/test-own-site-hh-probe.ts` — hermetic unit test for the probe classification.
- **Create** `lib/places/ownSiteHhPriority.ts` — pure `prioritizeOwnSiteHh(urls, hhPageUrl)` helper (Component B core).
- **Create** `scripts/test-own-site-hh-priority.ts` — hermetic unit test for the priority helper.
- **Create** `scripts/promote-own-site-hh.ts` — orchestrator (Component A); `pnpm promote:own-site-hh`.
- **Create** `db/migrations/0023_*.sql` — add `venues.hh_page_url`, `venues.hh_probe_status` (drizzle-generated).
- **Modify** `db/schema/core.ts` — add the two columns to the `venues` table.
- **Modify** `db/schema/enums.ts` — add `hhProbeStatus` pgEnum.
- **Create** `lib/recover/manualWindow.ts` — pure `buildManualWindowInsert(input)` + thin DB writer `createManualWindow(db, input)` (Component C backend).
- **Create** `scripts/test-manual-window.ts` — hermetic unit test for `buildManualWindowInsert`.
- **Modify** `app/admin/actions.ts` — `createManualWindowAction` server action wrapping the writer + `revalidatePath`.
- **Modify** `scripts/seed-enrich-candidates.ts` and `scripts/reextract-stubs.ts` — prepend own-site HH URL into `priorityUrls` via the helper.
- **Modify** `app/admin/stubs/page.tsx` + `components/admin/stub-row.tsx` — manual-entry queue + pre-filled form (Component C frontend).
- **Modify** `package.json` + `scripts/ci-tests.sh` — register the three new `test:*` scripts; add `promote:own-site-hh`.

---

## Task 1: Schema — persist the probe verdict on `venues`

**Files:**
- Modify: `db/schema/enums.ts`
- Modify: `db/schema/core.ts:119-180` (the `venues` table body)
- Create: `db/migrations/0023_*.sql` (drizzle-generated)

- [ ] **Step 1: Add the enum**

In `db/schema/enums.ts`, after the `dataCompleteness` enum (line ~52), add:

```typescript
export const hhProbeStatus = pgEnum("hh_probe_status", ["readable", "blocked", "none"]);
```

- [ ] **Step 2: Add the columns to the venues table**

In `db/schema/core.ts`, import the enum at the top alongside the other enum imports (the `import { ... } from "./enums"` group near line 25):

```typescript
  hhProbeStatus,
```

Then inside the `venues` `pgTable` column block (near `dataCompleteness` at line ~160), add:

```typescript
    // Own-site happy-hour-page probe verdict (lib/places/ownSiteHhProbe). Persisted so the
    // promote orchestrator, enrich URL-priority, and the admin manual-entry queue all reuse
    // one $0 probe. NULL = never probed.
    hhPageUrl: text("hh_page_url"),
    hhProbeStatus: hhProbeStatus("hh_probe_status"),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `db/migrations/0023_*.sql` adding the enum type + two `ALTER TABLE venues ADD COLUMN` statements. Open it and confirm it only adds the enum + two nullable columns (no destructive statements).

- [ ] **Step 4: Apply + verify against local PostGIS**

Run: `docker compose up -d && pnpm db:migrate`
Expected: migration applies clean. Verify:
Run: `docker compose exec -T db psql -U postgres -d happyhour -c "\\d venues" | grep hh_`
Expected: `hh_page_url | text` and `hh_probe_status | hh_probe_status` rows present.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add db/schema/enums.ts db/schema/core.ts db/migrations/
git commit -m "feat(schema): persist own-site HH probe verdict on venues"
```

---

## Task 2: `ownSiteHhProbe` — classify a venue's own HH page

**Files:**
- Create: `lib/places/ownSiteHhProbe.ts`
- Create: `scripts/test-own-site-hh-probe.ts`
- Modify: `package.json`, `scripts/ci-tests.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-own-site-hh-probe.ts`:

```typescript
/**
 * Hermetic unit checks for the own-site happy-hour page probe (no network — the
 * fetcher is injected). Run: npx tsx scripts/test-own-site-hh-probe.ts
 *
 * Classifies a venue's OWN domain HH paths: 200 + HH text signal → 'readable';
 * 403 / anti-bot → 'blocked' (page exists, plain HTTP can't read it — extractor will
 * render); 404 / soft-404 / 200-without-signal → 'none'.
 */
import assert from "node:assert/strict";
import { probeOwnSiteHhPage } from "@/lib/places/ownSiteHhProbe";

let passed = 0;
function check(name: string, fn: () => Promise<void>) {
  return fn().then(() => {
    passed++;
    console.log(`  ✓ ${name}`);
  });
}

// A fetcher that maps exact URLs → responses; anything unmapped is a 404.
function fakeFetcher(map: Record<string, { status: number; body: string }>) {
  return async (url: string) => map[url] ?? { status: 404, body: "" };
}

const HH_BODY = "Join us for Happy Hour Mon–Fri 3pm–6pm — $5 wells, half-price apps.";

async function main() {
  await check("readable: /happy-hour returns 200 with HH signal", async () => {
    const r = await probeOwnSiteHhPage(
      "https://foo.com",
      fakeFetcher({ "https://foo.com/happy-hour": { status: 200, body: HH_BODY } }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://foo.com/happy-hour", status: "readable" });
  });

  await check("blocked: HH path 403s (anti-bot wall)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://bistro44.com",
      fakeFetcher({ "https://bistro44.com/happy-hour": { status: 403, body: "" } }),
    );
    assert.deepEqual(r, { hhPageUrl: "https://bistro44.com/happy-hour", status: "blocked" });
  });

  await check("none: all paths 404", async () => {
    const r = await probeOwnSiteHhPage("https://foo.com", fakeFetcher({}));
    assert.deepEqual(r, { hhPageUrl: null, status: "none" });
  });

  await check("none: 200 but no HH signal (soft-404 / generic page)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://foo.com",
      fakeFetcher({ "https://foo.com/specials": { status: 200, body: "<h1>Welcome</h1>" } }),
    );
    assert.deepEqual(r, { hhPageUrl: null, status: "none" });
  });

  await check("readable wins over blocked when both exist (signal beats wall)", async () => {
    const r = await probeOwnSiteHhPage(
      "https://foo.com",
      fakeFetcher({
        "https://foo.com/happy-hour": { status: 403, body: "" },
        "https://foo.com/specials": { status: 200, body: HH_BODY },
      }),
    );
    assert.equal(r.status, "readable");
    assert.equal(r.hhPageUrl, "https://foo.com/specials");
  });

  await check("null/garbage website → none, no fetch", async () => {
    assert.deepEqual(await probeOwnSiteHhPage(null, fakeFetcher({})), { hhPageUrl: null, status: "none" });
    assert.deepEqual(await probeOwnSiteHhPage("not a url", fakeFetcher({})), { hhPageUrl: null, status: "none" });
  });

  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-own-site-hh-probe.ts`
Expected: FAIL — `Cannot find module '@/lib/places/ownSiteHhProbe'`.

- [ ] **Step 3: Implement the probe**

Create `lib/places/ownSiteHhProbe.ts`:

```typescript
/**
 * Own-site happy-hour page probe — the $0 first step of the auto-promote pipeline.
 *
 * Given a venue's own website, GET the HH-specific subset of GUESS_MENU_PATHS on its own
 * origin and classify what we find. The verdict is persisted on the venue and drives the
 * promote orchestrator (re-extract), enrich URL-priority, and the manual-entry queue.
 *
 * Plain HTTP only (no API, no cost). MAIN-THREAD ONLY: background subagents can't web-fetch
 * (env constraint). The fetcher is injected so the unit test is hermetic.
 */
import { hasHhOrDealSignal } from "@/lib/places/hhText";

/** The HH-specific paths from siteTriage.GUESS_MENU_PATHS — most→least specific. A real HH
 *  page lives at one of these; /menu and /drinks are deliberately excluded (too generic to
 *  count as a happy-hour page on their own). */
export const OWN_SITE_HH_PATHS = [
  "/happy-hour",
  "/happyhour",
  "/happy-hour-menu",
  "/menu/happy-hour",
  "/specials",
];

export type ProbeStatus = "readable" | "blocked" | "none";
export interface ProbeResult {
  hhPageUrl: string | null;
  status: ProbeStatus;
}

export type Fetcher = (url: string) => Promise<{ status: number; body: string }>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0 (compatible; HappyHourFriends/1.0)" },
    signal: AbortSignal.timeout(10_000),
  });
  // Only read the body for non-error responses we'll actually inspect.
  const body = res.ok ? await res.text() : "";
  return { status: res.status, body };
};

/**
 * Probe the venue's own origin for a happy-hour page. Returns the FIRST `readable` page
 * (200 + HH text signal); if none is readable but at least one path is `blocked`
 * (403 / anti-bot), returns that (the real extractor escalates to headless render);
 * otherwise `none`. Never throws — a fetch error on one path is treated as a miss.
 */
export async function probeOwnSiteHhPage(
  websiteUrl: string | null | undefined,
  fetcher: Fetcher = defaultFetcher,
): Promise<ProbeResult> {
  let origin: string;
  try {
    origin = new URL(websiteUrl!).origin;
  } catch {
    return { hhPageUrl: null, status: "none" };
  }

  let blockedUrl: string | null = null;
  for (const path of OWN_SITE_HH_PATHS) {
    const url = origin + path;
    let res: { status: number; body: string };
    try {
      res = await fetcher(url);
    } catch {
      continue; // network error on this path → treat as miss, keep probing
    }
    if (res.status === 200 && hasHhOrDealSignal(res.body)) {
      return { hhPageUrl: url, status: "readable" }; // signal beats everything — return now
    }
    if ((res.status === 403 || res.status === 401 || res.status === 429) && !blockedUrl) {
      blockedUrl = url; // remember the first wall, but keep looking for a readable page
    }
  }
  return blockedUrl ? { hhPageUrl: blockedUrl, status: "blocked" } : { hhPageUrl: null, status: "none" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-own-site-hh-probe.ts`
Expected: PASS — `6 checks passed.`

- [ ] **Step 5: Register the test + typecheck**

In `package.json` scripts, add (alphabetically near the other `test:` entries):

```json
    "test:own-site-hh-probe": "tsx scripts/test-own-site-hh-probe.ts",
```

In `scripts/ci-tests.sh`, add `test:own-site-hh-probe` to the `TESTS=( ... )` array.

Run: `pnpm typecheck && npm run test:own-site-hh-probe`
Expected: typecheck PASS, test PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/places/ownSiteHhProbe.ts scripts/test-own-site-hh-probe.ts package.json scripts/ci-tests.sh
git commit -m "feat(probe): own-site happy-hour page probe (readable/blocked/none)"
```

---

## Task 3: `prioritizeOwnSiteHh` — bake own-site priority into enrich (Component B)

**Files:**
- Create: `lib/places/ownSiteHhPriority.ts`
- Create: `scripts/test-own-site-hh-priority.ts`
- Modify: `scripts/seed-enrich-candidates.ts:590,902,1053,1076` (the `priorityUrls: decided.priorityUrls` sites)
- Modify: `scripts/reextract-stubs.ts` (the `priorityUrls` assembly)
- Modify: `package.json`, `scripts/ci-tests.sh`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-own-site-hh-priority.ts`:

```typescript
/**
 * Hermetic unit checks for own-site HH URL priority (Component B of the auto-promote
 * design). The venue's OWN /happy-hour page must be fetched FIRST so the live window's
 * source_url is first-party and never trips the provenance gate (the "Eddie V's stored a
 * Yelp source instead of eddiev.com/happy-hour" fix). Run: npx tsx scripts/test-own-site-hh-priority.ts
 */
import assert from "node:assert/strict";
import { prioritizeOwnSiteHh } from "@/lib/places/ownSiteHhPriority";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("prepends the own-site HH url to the front", () =>
  assert.deepEqual(
    prioritizeOwnSiteHh(["https://yelp.com/biz/foo", "https://foo.com/menu"], "https://foo.com/happy-hour"),
    ["https://foo.com/happy-hour", "https://yelp.com/biz/foo", "https://foo.com/menu"],
  ));

check("dedupes if the HH url is already present (moves it to front)", () =>
  assert.deepEqual(
    prioritizeOwnSiteHh(["https://foo.com/menu", "https://foo.com/happy-hour"], "https://foo.com/happy-hour"),
    ["https://foo.com/happy-hour", "https://foo.com/menu"],
  ));

check("null HH url → unchanged list", () =>
  assert.deepEqual(prioritizeOwnSiteHh(["https://foo.com/menu"], null), ["https://foo.com/menu"]));

check("empty list + HH url → just the HH url", () =>
  assert.deepEqual(prioritizeOwnSiteHh([], "https://foo.com/happy-hour"), ["https://foo.com/happy-hour"]));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-own-site-hh-priority.ts`
Expected: FAIL — `Cannot find module '@/lib/places/ownSiteHhPriority'`.

- [ ] **Step 3: Implement the helper**

Create `lib/places/ownSiteHhPriority.ts`:

```typescript
/**
 * prioritizeOwnSiteHh — put a venue's OWN happy-hour page at the front of the extractor's
 * priority URL list so it's fetched first. The first-party page then wins the window's
 * source_url and the provenance gate (PR #146) never hides it as an aggregator source.
 * Pure + exported for unit testing.
 */
export function prioritizeOwnSiteHh(priorityUrls: string[], hhPageUrl: string | null | undefined): string[] {
  if (!hhPageUrl) return priorityUrls;
  return [hhPageUrl, ...priorityUrls.filter((u) => u !== hhPageUrl)];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-own-site-hh-priority.ts`
Expected: PASS — `4 checks passed.`

- [ ] **Step 5: Wire it into enrich**

In `scripts/seed-enrich-candidates.ts`, import the helper near the other `lib/places` imports:

```typescript
import { prioritizeOwnSiteHh } from "@/lib/places/ownSiteHhPriority";
```

The script selects candidates and computes `decided.priorityUrls`. Where the venue's persisted `hh_page_url` is available (carry it through the candidate row select — add `hhPageUrl: venues.hhPageUrl` to the candidate query that already joins `venues`), replace each `priorityUrls: decided.priorityUrls` (lines ~590, ~902, ~1053, ~1076) with:

```typescript
        priorityUrls: prioritizeOwnSiteHh(decided.priorityUrls, candidate.hhPageUrl ?? null),
```

(If a given call site has no joined venue row — the pre-venue discovery path — leave it as `decided.priorityUrls`; only the stub-recovery / existing-venue paths have an `hh_page_url`.)

- [ ] **Step 6: Wire it into reextract-stubs**

In `scripts/reextract-stubs.ts`, add the same import. The `StubVenue`/`Qualified` query already selects venue fields — add `hh_page_url` to the `StubVenue` interface + select, and where `priorityUrls` is assembled for the extract request, wrap with `prioritizeOwnSiteHh(priorityUrls, venue.hh_page_url)`.

- [ ] **Step 7: Register test + typecheck**

Add to `package.json` and `scripts/ci-tests.sh`: `test:own-site-hh-priority`.

Run: `pnpm typecheck && npm run test:own-site-hh-priority`
Expected: typecheck PASS, test PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/places/ownSiteHhPriority.ts scripts/test-own-site-hh-priority.ts scripts/seed-enrich-candidates.ts scripts/reextract-stubs.ts package.json scripts/ci-tests.sh
git commit -m "feat(enrich): prioritize own-site happy-hour page over aggregator URLs"
```

---

## Task 4: `promote:own-site-hh` orchestrator (Component A)

**Files:**
- Create: `scripts/promote-own-site-hh.ts`
- Modify: `package.json` (add the `promote:own-site-hh` script)

This task is a runnable script (no unit test — it's I/O orchestration over `probeOwnSiteHhPage` + `resolveVenue`, both already tested). Verify with `--dry-run` against local PostGIS ($0).

- [ ] **Step 1: Implement the orchestrator**

Create `scripts/promote-own-site-hh.ts`:

```typescript
/**
 * promote-own-site-hh — auto-cleanup for the hidden-HH backlog.
 *
 * For each no-live-HH stub venue WITH a website, probe its own domain for a reachable
 * happy-hour page ($0, plain HTTP), persist the verdict (venues.hh_page_url + hh_probe_status),
 * then route:
 *   - readable → re-extract from that first-party URL (resolveVenue) → goes LIVE through the
 *     canonical realness+provenance gate. The junk hidden window is superseded by the reconcile.
 *   - blocked  → still attempt re-extract (extractor escalates to headless render); if it STILL
 *     yields nothing, the venue is left hh_probe_status='blocked' for the admin manual-entry queue.
 *   - none     → no-op.
 *
 * --dry-run = probe + persist verdict + report routing, $0 (no resolveVenue, no extraction).
 * Default/real run SPENDS on re-extract (~$0.015–0.03/venue) — gate it behind operator go-ahead.
 *
 * Usage:
 *   pnpm promote:own-site-hh --city tucson --state az --dry-run     # $0: probe + report
 *   pnpm promote:own-site-hh --city tucson --state az [--limit N]   # PAID: re-extract readable/blocked
 *   pnpm promote:own-site-hh --dry-run                              # $0: all cities
 *
 * Required env: DATABASE_URL (+ ANTHROPIC_API_KEY for a real run).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { probeOwnSiteHhPage, type ProbeStatus } from "@/lib/places/ownSiteHhProbe";
import { resolveVenue } from "@/lib/recover/resolveVenue";

const DATABASE_URL = process.env.DATABASE_URL;
const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const hasCityFlag = args.includes("--city");
const cityArgs = hasCityFlag ? requireCityArgs() : null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Row {
  venue_id: string;
  city: string;
  venue: string;
  website_url: string | null;
}

interface Outcome {
  venue: string;
  city: string;
  websiteUrl: string | null;
  status: ProbeStatus;
  hhPageUrl: string | null;
  result: "live" | "still-empty" | "skipped" | "dry-run";
  windowsLive?: number;
  costCents?: number;
}

async function main() {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, { max: 4 });
  const outcomes: Outcome[] = [];
  try {
    const rows = await sql<Row[]>`
      SELECT v.id AS venue_id, c.name AS city, v.name AS venue, v.website_url
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      WHERE v.status = 'active' AND v.deleted_at IS NULL AND v.data_completeness = 'stub'
        AND v.website_url IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours a
          WHERE a.venue_id = v.id AND a.active AND a.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND c.slug = ${cityArgs.slug} AND c.state = ${cityArgs.state}` : sql``}
      ORDER BY c.name, v.name
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    console.log(`${rows.length} no-live-HH stub venue(s) with a website to probe${dryRun ? " (dry-run, $0)" : ""}.`);

    for (const r of rows) {
      const probe = await probeOwnSiteHhPage(r.website_url);
      // Persist the verdict regardless of dry-run — the probe is free and reused by enrich + admin.
      await sql`
        UPDATE venues SET hh_page_url = ${probe.hhPageUrl}, hh_probe_status = ${probe.status}, updated_at = now()
        WHERE id = ${r.venue_id}
      `;

      const base: Outcome = {
        venue: r.venue, city: r.city, websiteUrl: r.website_url,
        status: probe.status, hhPageUrl: probe.hhPageUrl, result: "skipped",
      };

      if (probe.status === "none") {
        outcomes.push(base);
        continue;
      }
      if (dryRun) {
        outcomes.push({ ...base, result: "dry-run" });
        continue;
      }
      // readable or blocked → re-extract from the own-site HH page (blocked still tries; the
      // extractor escalates to render). resolveVenue persists live windows via the ONE path.
      const res = await resolveVenue({ venueId: r.venue_id, urls: probe.hhPageUrl ? [probe.hhPageUrl] : [], actor: "script:promote-own-site-hh" });
      outcomes.push({
        ...base,
        result: res.recovered ? "live" : "still-empty",
        windowsLive: res.windowsLive,
        costCents: res.costCents,
      });
    }

    const stamp = today();
    const tally = (s: ProbeStatus) => outcomes.filter((o) => o.status === s).length;
    const live = outcomes.filter((o) => o.result === "live").length;
    const stillBlocked = outcomes.filter((o) => o.status === "blocked" && o.result !== "live").length;
    const spent = outcomes.reduce((n, o) => n + (o.costCents ?? 0), 0);

    const md = [
      `# Own-site HH promote — ${stamp}${cityArgs ? ` (${cityArgs.slug}, ${cityArgs.state})` : " (all cities)"}`,
      "",
      `Probed ${outcomes.length}: readable ${tally("readable")}, blocked ${tally("blocked")}, none ${tally("none")}.`,
      dryRun ? "DRY-RUN — verdicts persisted, no extraction." : `Re-extracted → ${live} live. Still-blocked (manual queue): ${stillBlocked}. Spent ${(spent / 100).toFixed(2)} USD.`,
      "",
      "| result | status | city | venue | hh page | live | cost¢ |",
      "|---|---|---|---|---|---|---|",
      ...outcomes.map((o) => `| ${o.result} | ${o.status} | ${o.city} | ${o.venue} | ${o.hhPageUrl ?? ""} | ${o.windowsLive ?? ""} | ${o.costCents ?? ""} |`),
      "",
    ].join("\n");
    const path = `docs/own-site-hh-promote-${stamp}.md`;
    writeFileSync(path, md);
    console.log(dryRun
      ? `readable ${tally("readable")}, blocked ${tally("blocked")}, none ${tally("none")} → ${path}`
      : `${live} live, ${stillBlocked} still-blocked (manual queue), $${(spent / 100).toFixed(2)} → ${path}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Register the script**

In `package.json` scripts, add:

```json
    "promote:own-site-hh": "tsx scripts/promote-own-site-hh.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Verify dry-run against local PostGIS ($0)**

Run: `pnpm promote:own-site-hh --city daly-city --state ca --dry-run --limit 5`
Expected: prints `readable N, blocked N, none N → docs/own-site-hh-promote-<date>.md`; the report file exists; spot-check that a couple of `venues.hh_probe_status` rows were written. No paid extraction occurs.

- [ ] **Step 5: Commit**

```bash
git add scripts/promote-own-site-hh.ts package.json
git commit -m "feat(promote): own-site HH orchestrator — probe + re-extract to live"
```

---

## Task 5: `createManualWindow` backend (Component C)

**Files:**
- Create: `lib/recover/manualWindow.ts`
- Create: `scripts/test-manual-window.ts`
- Modify: `package.json`, `scripts/ci-tests.sh`

The pure `buildManualWindowInsert` (validation + row shaping) is unit-tested hermetically; the thin DB writer `createManualWindow(db, ...)` is exercised locally via the admin UI (Task 6) — it needs a live DB so it is NOT added to ci-tests.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-manual-window.ts`:

```typescript
/**
 * Hermetic unit checks for buildManualWindowInsert — the pure validation + row-shaping for
 * operator-entered happy hours (Component C, bot-walled venues). The operator entering data
 * IS the verification, so the window lands active=true (bypasses the realness gate). Run:
 * npx tsx scripts/test-manual-window.ts
 */
import assert from "node:assert/strict";
import { buildManualWindowInsert } from "@/lib/recover/manualWindow";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const base = {
  venueId: "11111111-1111-1111-1111-111111111111",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "15:00",
  endTime: "18:00",
  sourceUrl: "https://foo.com/happy-hour",
  offerings: [{ kind: "drink" as const, category: "beer" as const, name: "$5 drafts", priceCents: 500 }],
};

check("happy path: active=true, time_known=true, sorted days, source carried", () => {
  const { hhRow, offeringRows } = buildManualWindowInsert(base);
  assert.equal(hhRow.active, true);
  assert.equal(hhRow.timeKnown, true);
  assert.equal(hhRow.allDay, false);
  assert.deepEqual(hhRow.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(hhRow.sourceUrl, "https://foo.com/happy-hour");
  assert.equal(offeringRows.length, 1);
  assert.equal(offeringRows[0].sourceUrl, "https://foo.com/happy-hour");
});

check("days are de-duped and sorted", () => {
  const { hhRow } = buildManualWindowInsert({ ...base, daysOfWeek: [5, 1, 1, 3] });
  assert.deepEqual(hhRow.daysOfWeek, [1, 3, 5]);
});

check("until-close: endTime null is allowed (start set)", () => {
  const { hhRow } = buildManualWindowInsert({ ...base, endTime: null });
  assert.equal(hhRow.endTime, null);
  assert.equal(hhRow.startTime, "15:00");
});

check("rejects empty days", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, daysOfWeek: [] }), /at least one day/i));

check("rejects out-of-range ISO day", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, daysOfWeek: [0] }), /1..7/));

check("rejects a window with no time bound at all", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, startTime: null, endTime: null }), /time bound/i));

check("rejects a missing source url (must be first-party)", () =>
  assert.throws(() => buildManualWindowInsert({ ...base, sourceUrl: "" }), /source/i));

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-manual-window.ts`
Expected: FAIL — `Cannot find module '@/lib/recover/manualWindow'`.

- [ ] **Step 3: Implement the builder + writer**

Create `lib/recover/manualWindow.ts`:

```typescript
/**
 * Operator manual happy-hour entry (Component C) — the narrow exception to "no manual venue
 * patching": used ONLY for venues whose site is confirmed unreadable (hh_probe_status='blocked'
 * and re-extract produced nothing), so the extractor cannot do the job. The operator entering
 * the data IS the verification, so the window lands active=true and the venue goes complete —
 * it bypasses the realness gate (which exists to catch UNVERIFIED extractor output).
 *
 * buildManualWindowInsert is pure (validation + row shaping) and unit-tested. createManualWindow
 * is the thin DB writer (audit + venue promotion) used by the admin server action.
 */
import { and, eq, sql } from "drizzle-orm";
import type { db as Db } from "@/db/client";
import { venues, happyHours, offerings, auditLog } from "@/db/schema";

export interface ManualOffering {
  kind: "food" | "drink" | "other";
  category: "beer" | "wine" | "cocktail" | "spirit" | "appetizer" | "entree" | "dessert" | "other";
  name: string;
  priceCents?: number | null;
}

export interface ManualWindowInput {
  venueId: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  sourceUrl: string;
  offerings: ManualOffering[];
}

export interface ManualWindowRows {
  hhRow: {
    venueId: string;
    daysOfWeek: number[];
    startTime: string | null;
    endTime: string | null;
    allDay: boolean;
    timeKnown: boolean;
    active: boolean;
    sourceUrl: string;
    notes: string;
  };
  offeringRows: Array<{ kind: ManualOffering["kind"]; category: ManualOffering["category"]; name: string; priceCents: number | null; sourceUrl: string; active: boolean }>;
}

/** Pure: validate operator input and shape the happy_hours + offerings rows. Throws on
 *  invalid input (a bad form must fail loud, never silently write a malformed window). */
export function buildManualWindowInsert(input: ManualWindowInput): ManualWindowRows {
  const days = [...new Set(input.daysOfWeek)].sort((a, b) => a - b);
  if (days.length === 0) throw new Error("manual window needs at least one day");
  if (!days.every((d) => d >= 1 && d <= 7)) throw new Error("days must be ISO 1..7");
  if (!input.startTime && !input.endTime) throw new Error("manual window needs at least one time bound (start or end)");
  if (!input.sourceUrl || !input.sourceUrl.trim()) throw new Error("manual window needs a first-party source url");

  return {
    hhRow: {
      venueId: input.venueId,
      daysOfWeek: days,
      startTime: input.startTime,
      endTime: input.endTime,
      allDay: false,
      timeKnown: true, // operator entered a real time bound
      active: true, // operator trust → live (bypasses the realness gate)
      sourceUrl: input.sourceUrl.trim(),
      notes: "operator manual entry (unreadable site)",
    },
    offeringRows: input.offerings
      .filter((o) => o.name?.trim())
      .map((o) => ({
        kind: o.kind,
        category: o.category,
        name: o.name.trim(),
        priceCents: o.priceCents ?? null,
        sourceUrl: input.sourceUrl.trim(),
        active: true,
      })),
  };
}

/**
 * Write an operator-entered window live: insert the happy_hour + offerings, promote the venue
 * to complete + last_verified_at, and audit-log it. Idempotent on the natural-key unique index
 * (re-submitting the same window updates nothing new). Returns the new happy_hour id (or null
 * if the unique index swallowed a duplicate).
 */
export async function createManualWindow(database: typeof Db, input: ManualWindowInput, actor: string): Promise<{ happyHourId: string | null }> {
  const { hhRow, offeringRows } = buildManualWindowInsert(input);

  return database.transaction(async (tx) => {
    const inserted = await tx
      .insert(happyHours)
      .values(hhRow)
      .onConflictDoNothing()
      .returning({ id: happyHours.id });
    const happyHourId = inserted[0]?.id ?? null;
    if (!happyHourId) return { happyHourId: null }; // duplicate — nothing new to write

    if (offeringRows.length) {
      await tx.insert(offerings).values(offeringRows.map((o) => ({ ...o, happyHourId })));
    }
    await tx
      .update(venues)
      .set({ dataCompleteness: "complete", lastVerifiedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(venues.id, input.venueId), eq(venues.dataCompleteness, "stub")));
    await tx.insert(auditLog).values({
      tableName: "happy_hours",
      rowId: happyHourId,
      beforeJsonb: null,
      afterJsonb: { active: true, source: "manual-entry" },
      actor,
      reason: "manual HH entry — unreadable site",
    });
    return { happyHourId };
  });
}
```

NOTE: confirm the exact `auditLog` column names (`tableName/rowId/beforeJsonb/afterJsonb/actor/reason`) and `venues.lastVerifiedAt` against `db/schema` while implementing — match the existing `reviewQueues.ts` insert shape if it differs.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-manual-window.ts`
Expected: PASS — `7 checks passed.`

- [ ] **Step 5: Register test + typecheck**

Add `test:manual-window` to `package.json` and `scripts/ci-tests.sh`.

Run: `pnpm typecheck && npm run test:manual-window`
Expected: typecheck PASS, test PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/recover/manualWindow.ts scripts/test-manual-window.ts package.json scripts/ci-tests.sh
git commit -m "feat(manual): operator manual-entry window builder + live writer"
```

---

## Task 6: `/admin/stubs` manual-entry queue + pre-filled form (Component C frontend)

**Files:**
- Modify: `app/admin/actions.ts` (add `createManualWindowAction`)
- Modify: `app/admin/stubs/page.tsx` (surface `hh_probe_status='blocked'` queue + pass pre-fill data)
- Modify: `components/admin/stub-row.tsx` (add "Enter manually" mode + form)

- [ ] **Step 1: Add the server action**

In `app/admin/actions.ts`, near `resolveStubAction`, add:

```typescript
export async function createManualWindowAction(input: {
  venueId: string;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  sourceUrl: string;
  offerings: { kind: "food" | "drink" | "other"; category: "beer" | "wine" | "cocktail" | "spirit" | "appetizer" | "entree" | "dessert" | "other"; name: string; priceCents?: number | null }[];
}): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();
    const { createManualWindow } = await import("@/lib/recover/manualWindow");
    const r = await createManualWindow(db, input, admin.email);
    revalidatePath("/admin/stubs");
    revalidatePath("/");
    return { ok: true, summary: r.happyHourId ? "window created (live)" : "duplicate — no change" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Manual entry failed" };
  }
}
```

- [ ] **Step 2: Surface the blocked queue + pre-fill data in the page**

In `app/admin/stubs/page.tsx`, extend the `db.select` to also pull `hhProbeStatus: venues.hhProbeStatus`, `hhPageUrl: venues.hhPageUrl`, `address: venues.address` (confirm the venue address column name), `phone: venues.phone`, and any existing hidden windows for pre-fill (a left join or a follow-up query selecting `happy_hours` where `venue_id = v.id AND NOT active AND deleted_at IS NULL` with their offerings). Add these to `StubVenue`. Sort `hh_probe_status === 'blocked'` venues to the top and label that section "Needs manual entry (site unreadable)".

- [ ] **Step 3: Add the "Enter manually" form to StubRow**

In `components/admin/stub-row.tsx`, add an "Enter manually" button (shown when `hhProbeStatus === 'blocked'`) that toggles a form pre-filled with the venue name/address/website/phone (read-only context) + editable rows for days (Mon–Sun checkboxes, ISO), start/end time inputs, and offering rows (kind/category selects + name + price). On submit, call `createManualWindowAction` with the form values and `sourceUrl` defaulting to the venue's `hhPageUrl ?? websiteUrl`. Show the returned `summary`/`error`. Follow the existing `resolveStubAction` call + pending-state pattern already in this component.

- [ ] **Step 4: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: both PASS (build is the acceptance gate).

- [ ] **Step 5: Manual smoke test (local)**

Run: `rm -rf .next && pnpm dev`, open `http://localhost:3000/admin/stubs`. Confirm: a `blocked` venue (set one manually in the DB for the test) shows "Enter manually"; submitting a window with days + times + one offering returns "window created (live)"; the venue drops off the stub list and the window appears on the venue's public page.

- [ ] **Step 6: Commit**

```bash
git add app/admin/actions.ts app/admin/stubs/page.tsx components/admin/stub-row.tsx
git commit -m "feat(admin): pre-filled manual HH entry for unreadable venues"
```

---

## Task 7: Full suite + PR

- [ ] **Step 1: Run the full hermetic suite**

Run: `pnpm test`
Expected: all suites pass, including the three new ones (`test:own-site-hh-probe`, `test:own-site-hh-priority`, `test:manual-window`).

- [ ] **Step 2: Final typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/own-site-hh-promote
gh pr create --title "feat: own-site happy-hour auto-promote (probe → re-extract → live)" --body "$(cat <<'EOF'
Probe each no-live-HH stub venue's own site for a reachable happy-hour page, re-extract from it to go live, bake own-site priority into enrich, and add a confirmed-unreadable manual-entry fallback. Re-extract + operator entry are the only paths to live (no shape-heuristic promotion).

- Schema: `venues.hh_page_url` + `hh_probe_status` (migration 0023)
- `lib/places/ownSiteHhProbe.ts` — $0 probe (readable/blocked/none)
- `lib/places/ownSiteHhPriority.ts` — own-site URL wins extractor priority
- `scripts/promote-own-site-hh.ts` — orchestrator (`--dry-run` is $0)
- `lib/recover/manualWindow.ts` + `/admin/stubs` form — operator entry goes live

Spec: docs/superpowers/specs/2026-06-14-own-site-hh-promote-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note: the paid trial-city rollout (running the orchestrator for real on Phoenix/Tucson/SLO/Daly City) is a deferred follow-up requiring an explicit $ go-ahead — not part of this PR.

---

## Self-Review notes

- **Spec coverage:** Component A → Tasks 1,2,4. Component B → Task 3. Component C → Tasks 1,5,6. Schema → Task 1. Testing → unit tests in Tasks 2,3,5; deferred paid rollout noted. All spec sections mapped.
- **Type consistency:** `ProbeResult {hhPageUrl, status}` used identically in probe + orchestrator. `prioritizeOwnSiteHh(string[], string|null)` consistent. `ManualWindowInput`/`buildManualWindowInsert`/`createManualWindow` signatures consistent across lib, test, and action.
- **Known confirm-on-implement items (flagged inline, not placeholders):** exact `auditLog`/`venues.lastVerifiedAt`/`venues.address` column names in Task 5/6 — match existing `reviewQueues.ts`; the precise `priorityUrls` call sites in `seed-enrich-candidates.ts` (line numbers approximate) and the `reextract-stubs.ts` assembly point — grep `priorityUrls` to confirm.
