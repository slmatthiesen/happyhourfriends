# Stub Cleanup Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pnpm cleanup:stubs` — a `$0`-dry-run-by-default curation pass that classifies every no-HH stub into keep / hide / delete under a tunable policy, reusing existing predicates and write paths.

**Architecture:** A pure, hermetically-testable classifier (`lib/places/stubCleanup.ts`) decides one venue's fate from its signals; a thin script (`scripts/cleanup-stubs.ts`) does the DB query, the side-by-side-policy report, and the audit-logged writes. The classifier reuses `hasAlcoholSignal`, `isMenuPlatformWebsite`, and `ZERO_HH_TYPES`; the writes copy the transaction/audit pattern from `suppress-dead-end-stubs.ts` (hide) and `drop-menu-platform-stubs.ts` (delete).

**Tech Stack:** TypeScript (strict), `tsx`, `postgres.js`, `node:assert/strict` hermetic tests registered in `scripts/ci-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-06-23-cleanup-stubs-tool-design.md`

---

## File Structure

- **Create `lib/places/stubCleanup.ts`** — pure classifier. Exports `classifyStub(sig, policy)`, types `StubCleanupPolicy` / `StubAction` / `StubSignal` / `StubVerdict`, and `DEAD_SITE_HEALTH`. No DB, no I/O. One responsibility: given one venue's signals + a policy, return `{ action, reason }`.
- **Create `scripts/test-stub-cleanup.ts`** — hermetic unit test (DB/keys unset) over a fixture table.
- **Create `scripts/cleanup-stubs.ts`** — CLI: query the stub population, classify under both policies for the report, apply the selected policy in one transaction.
- **Modify `package.json`** — add `cleanup:stubs` and `test:stub-cleanup` scripts.
- **Modify `scripts/ci-tests.sh`** — register `test:stub-cleanup` in the `TESTS` array.

---

## Task 1: Pure classifier `lib/places/stubCleanup.ts`

**Files:**
- Create: `lib/places/stubCleanup.ts`
- Test: `scripts/test-stub-cleanup.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-stub-cleanup.ts`:

```ts
/**
 * test-stub-cleanup — hermetic checks for the keep/hide/delete classifier
 * (lib/places/stubCleanup) that drives `pnpm cleanup:stubs`.
 * Run: tsx scripts/test-stub-cleanup.ts
 */
import assert from "node:assert/strict";
import {
  classifyStub,
  DEAD_SITE_HEALTH,
  type StubSignal,
  type StubCleanupPolicy,
} from "@/lib/places/stubCleanup";

let passed = 0;
function check(name: string, fn: () => void) { fn(); passed++; console.log(`  ✓ ${name}`); }

const sig = (s: Partial<StubSignal>): StubSignal => ({
  name: null, primaryType: null, types: null, websiteUrl: null, siteHealth: null, ...s,
});
const OR_SITE: StubCleanupPolicy = "alcohol-or-site";
const ALC_ONLY: StubCleanupPolicy = "alcohol-only";

check("DEAD_SITE_HEALTH is the six dead classes; blocked/ok are NOT dead", () => {
  assert.deepEqual([...DEAD_SITE_HEALTH].sort(),
    ["dns_dead", "expired_cert", "http_error", "invalid_cert", "parked", "unreachable"]);
  assert.ok(!DEAD_SITE_HEALTH.has("blocked"));
  assert.ok(!DEAD_SITE_HEALTH.has("ok"));
});

check("DELETE: menu-platform-only site (even a bar)", () => {
  const v = classifyStub(sig({ name: "Joe's Bar", primaryType: "bar", websiteUrl: "https://kwickmenu.com/x" }), OR_SITE);
  assert.equal(v.action, "delete");
});

check("DELETE: no-alcohol restaurant with no site", () => {
  assert.equal(classifyStub(sig({ name: "Pho House", primaryType: "restaurant" }), OR_SITE).action, "delete");
});

check("DELETE: no-alcohol restaurant with a dead site", () => {
  const v = classifyStub(sig({ name: "Taco Place", primaryType: "restaurant", websiteUrl: "http://x.com", siteHealth: "dns_dead" }), OR_SITE);
  assert.equal(v.action, "delete");
});

check("KEEP: alcohol-positive bar with no site (the url-less crowdsource bet) — both policies", () => {
  const bar = sig({ name: "The Tap Room", primaryType: "bar" });
  assert.equal(classifyStub(bar, OR_SITE).action, "keep");
  assert.equal(classifyStub(bar, ALC_ONLY).action, "keep");
});

check("KEEP: alcohol-by-name override even on a `restaurant` type", () => {
  assert.equal(classifyStub(sig({ name: "Behan's An Irish Pub", primaryType: "restaurant" }), ALC_ONLY).action, "keep");
});

check("HIDE: zero-HH cuisine (korean/viet/chinese), no alcohol — both policies", () => {
  const k = sig({ name: "KBBQ House", primaryType: "korean_restaurant", websiteUrl: "https://k.com", siteHealth: "ok" });
  assert.equal(classifyStub(k, OR_SITE).action, "hide");
  assert.equal(classifyStub(k, ALC_ONLY).action, "hide");
});

check("POLICY split: good-site restaurant — KEEP under alcohol-or-site, HIDE under alcohol-only", () => {
  const r = sig({ name: "Somerset Grill", primaryType: "american_restaurant", websiteUrl: "https://s.com", siteHealth: "ok" });
  assert.equal(classifyStub(r, OR_SITE).action, "keep");
  assert.equal(classifyStub(r, ALC_ONLY).action, "hide");
});

check("blocked (bot-wall) site is alive → not deleted; routes by policy", () => {
  const r = sig({ name: "Rise Woodfire", primaryType: "restaurant", websiteUrl: "https://r.com", siteHealth: "blocked" });
  assert.equal(classifyStub(r, OR_SITE).action, "keep");
  assert.equal(classifyStub(r, ALC_ONLY).action, "hide");
});

check("null site_health (never probed) is treated as alive → not deleted", () => {
  const r = sig({ name: "New Spot", primaryType: "restaurant", websiteUrl: "https://n.com", siteHealth: null });
  assert.equal(classifyStub(r, OR_SITE).action, "keep");
});

check("delete bucket is policy-independent (same delete under both policies)", () => {
  const junk = sig({ name: "Nowhere Cafe", primaryType: "restaurant" });
  assert.equal(classifyStub(junk, OR_SITE).action, "delete");
  assert.equal(classifyStub(junk, ALC_ONLY).action, "delete");
});

console.log(`\n${passed} checks passed.`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm tsx scripts/test-stub-cleanup.ts`
Expected: FAIL — `Cannot find module '@/lib/places/stubCleanup'`.

- [ ] **Step 3: Write the classifier**

Create `lib/places/stubCleanup.ts`:

```ts
/**
 * stubCleanup — the keep / hide / delete classifier behind `pnpm cleanup:stubs`.
 *
 * Decides one no-HH stub's fate from its discovery + site signals, given a policy. Pure and
 * hermetic (no DB/I/O) so the rule has one home and a fast unit test. Reuses the existing
 * predicates: hasAlcoholSignal (the bar bet — keyed on type/name, the same signal the url-less
 * delete review used), isMenuPlatformWebsite, and ZERO_HH_TYPES.
 *
 *   - keep   → stays visible as a help-wanted stub
 *   - hide   → venues.status='no_happy_hour' (reversible; persist/apply revives on HH insert)
 *   - delete → venues.deleted_at=now() (soft; google_place_id stays as re-discovery guard)
 *
 * The DELETE set is policy-independent (true junk only). `--policy` controls ONE thing: whether
 * a good-site restaurant (no alcohol evidence, live site) is kept visible or hidden.
 */
import { hasAlcoholSignal } from "@/lib/places/chainDenylist";
import { isMenuPlatformWebsite } from "@/lib/places/menuPlatform";
import { ZERO_HH_TYPES } from "@/lib/places/stubGate";

export type StubCleanupPolicy = "alcohol-or-site" | "alcohol-only";
export type StubAction = "keep" | "hide" | "delete";

/**
 * site_health values that mean the site is dead/unusable (lib/places/siteHealth). `blocked`
 * (bot-wall — the page may still serve HH) and `ok` count as ALIVE; `null` (never probed) is
 * treated as alive too, so an unprobed site never gets deleted (conservative).
 */
export const DEAD_SITE_HEALTH: ReadonlySet<string> = new Set([
  "dns_dead", "parked", "expired_cert", "invalid_cert", "http_error", "unreachable",
]);

export interface StubSignal {
  name: string | null;
  /** seed_candidates.primary_type */
  primaryType: string | null;
  /** seed_candidates.types */
  types: string[] | null;
  /** venues.website_url */
  websiteUrl: string | null;
  /** venues.site_health (free text typed by lib/places/siteHealth); null = never probed */
  siteHealth: string | null;
}

export interface StubVerdict { action: StubAction; reason: string; }

export function classifyStub(sig: StubSignal, policy: StubCleanupPolicy): StubVerdict {
  const alcoholPositive = hasAlcoholSignal(sig.name, sig.primaryType, sig.types);
  const hasSite = sig.websiteUrl != null && sig.websiteUrl.trim() !== "";
  const menuPlatformOnly = hasSite && isMenuPlatformWebsite(sig.websiteUrl);
  const deadSite = hasSite && sig.siteHealth != null && DEAD_SITE_HEALTH.has(sig.siteHealth);
  const zeroHhType = sig.primaryType != null && ZERO_HH_TYPES.has(sig.primaryType);

  // 1. DELETE — true junk (policy-independent).
  if (menuPlatformOnly) return { action: "delete", reason: "menu-platform-only site" };
  if (!alcoholPositive && (!hasSite || deadSite)) {
    return { action: "delete", reason: hasSite ? "no alcohol signal + dead site" : "no alcohol signal + no site" };
  }

  // 2. KEEP — the alcohol-positive crowdsource bet (bars/pubs/breweries by type or name).
  if (alcoholPositive) return { action: "keep", reason: "alcohol-positive" };

  // 3. HIDE — zero-HH cuisine. Hard delete of these stays in delete-empty-cuisine-stubs.ts.
  if (zeroHhType) return { action: "hide", reason: `zero-HH cuisine (${sig.primaryType})` };

  // 4. Good-site restaurant (no alcohol evidence, live non-platform site): policy decides.
  return policy === "alcohol-or-site"
    ? { action: "keep", reason: "restaurant w/ working site (recall-miss candidate)" }
    : { action: "hide", reason: "restaurant w/ working site (alcohol-only policy)" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm tsx scripts/test-stub-cleanup.ts`
Expected: PASS — `11 checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/places/stubCleanup.ts scripts/test-stub-cleanup.ts
git commit -m "feat(cleanup): pure keep/hide/delete stub classifier + hermetic test"
```

---

## Task 2: Register the test in CI

**Files:**
- Modify: `package.json` (scripts block)
- Modify: `scripts/ci-tests.sh` (TESTS array)

- [ ] **Step 1: Add the npm script**

In `package.json`, in the `"scripts"` block, add next to the other `test:*` entries:

```json
    "test:stub-cleanup": "tsx scripts/test-stub-cleanup.ts",
```

- [ ] **Step 2: Register in the CI suite**

In `scripts/ci-tests.sh`, add to the `TESTS=(` array (near `test:stub-gate` / other pure-logic tests):

```bash
  test:stub-cleanup
```

- [ ] **Step 3: Run the suite to confirm it picks up and passes**

Run: `pnpm test:stub-cleanup`
Expected: PASS — `11 checks passed.`

Run: `bash scripts/ci-tests.sh 2>&1 | grep -E "stub-cleanup|FAIL|passed"`
Expected: `test:stub-cleanup` listed, no `FAIL`.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/ci-tests.sh
git commit -m "test(cleanup): register test:stub-cleanup in CI suite"
```

---

## Task 3: The CLI script `scripts/cleanup-stubs.ts`

**Files:**
- Create: `scripts/cleanup-stubs.ts`

This task has no unit test of its own (the classification logic is covered in Task 1; the script is thin DB plumbing). It is verified by a manual dry-run against the local DB in Task 4. Model the query, transaction, and audit-log shape on `scripts/suppress-dead-end-stubs.ts` and `scripts/drop-menu-platform-stubs.ts`.

- [ ] **Step 1: Write the script**

Create `scripts/cleanup-stubs.ts`:

```ts
/**
 * cleanup-stubs — unified stub curation pass (keep / hide / delete).
 *
 * Classifies every no-HH active venue (lib/places/stubCleanup) and, with --apply, hides the
 * HIDE bucket (status='no_happy_hour', reversible) and soft-deletes the DELETE bucket
 * (deleted_at, google_place_id kept as re-discovery guard). Both audit-logged. Dry-run by
 * default: prints per-city keep/hide/delete counts under BOTH policies side by side so the
 * alcohol-only delta over the default alcohol-or-site is visible without a second run.
 *
 *   Dry-run (default, no writes), all cities, default policy:
 *     pnpm cleanup:stubs
 *   Scope + verbose listing:
 *     pnpm cleanup:stubs --city san-jose --state CA --verbose
 *   Refresh site_health first (for the dead-site delete test), then apply the tighter policy:
 *     pnpm cleanup:stubs --refresh-sites --policy alcohol-only --apply
 *
 * Requires DATABASE_URL only. Idempotent + re-runnable. All-cities when --city is omitted.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import {
  classifyStub,
  type StubAction,
  type StubCleanupPolicy,
} from "@/lib/places/stubCleanup";

interface Row {
  id: string;
  name: string;
  city: string;
  primary_type: string | null;
  types: string[] | null;
  serves_alcohol: boolean | null;
  website_url: string | null;
  site_health: string | null;
}

const POLICIES: StubCleanupPolicy[] = ["alcohol-or-site", "alcohol-only"];

function parsePolicy(args: string[]): StubCleanupPolicy {
  const i = args.indexOf("--policy");
  if (i === -1) return "alcohol-or-site";
  const v = args[i + 1];
  if (v !== "alcohol-or-site" && v !== "alcohol-only") {
    console.error(`ERROR: --policy must be 'alcohol-or-site' or 'alcohol-only' (got ${v ?? "nothing"}).`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const verbose = args.includes("--verbose");
  const refreshSites = args.includes("--refresh-sites");
  const policy = parsePolicy(args);
  const cityArgs = args.includes("--city") ? requireCityArgs() : null;

  // Refresh site_health first so the dead-site delete test is current. Reuses the existing probe.
  if (refreshSites) {
    const scopeFlags = cityArgs ? ` --city ${cityArgs.slug} --state ${cityArgs.state}` : "";
    console.log("Refreshing site_health via audit:venue-sites --persist …");
    execSync(`pnpm audit:venue-sites --persist${scopeFlags}`, { stdio: "inherit" });
  }

  const sql = postgres(dbUrl, { max: 1 });
  try {
    // Active, non-deleted venues with NO live happy hour, joined to their discovery candidate for
    // the alcohol/cuisine signal. A venue with no candidate has null signals → hasAlcoholSignal
    // false and no zero-HH type; with a website it routes by policy, without one it deletes.
    const rows = await sql<Row[]>`
      SELECT v.id, v.name, c.slug AS city,
             sc.primary_type, sc.types, sc.serves_alcohol,
             v.website_url, v.site_health
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      LEFT JOIN seed_candidates sc ON sc.google_place_id = v.google_place_id
      WHERE v.deleted_at IS NULL AND v.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h
          WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND lower(c.slug) = ${cityArgs.slug} AND lower(c.state) = ${cityArgs.state}` : sql``}
      ORDER BY c.slug, v.name
    `;

    const toSignal = (v: Row) => ({
      name: v.name, primaryType: v.primary_type, types: v.types,
      websiteUrl: v.website_url, siteHealth: v.site_health,
    });

    // Report: tally every venue under BOTH policies so the operator sees the alcohol-only delta.
    type Counts = Record<StubAction, number>;
    const perCity = new Map<string, Record<StubCleanupPolicy, Counts>>();
    const blank = (): Counts => ({ keep: 0, hide: 0, delete: 0 });
    for (const v of rows) {
      const bucket = perCity.get(v.city) ?? { "alcohol-or-site": blank(), "alcohol-only": blank() };
      for (const p of POLICIES) bucket[p][classifyStub(toSignal(v), p).action]++;
      perCity.set(v.city, bucket);
    }

    const scope = cityArgs ? `${cityArgs.slug}, ${cityArgs.state}` : "all cities";
    console.log(`\nStub cleanup — ${rows.length} HH-less active venue(s) in ${scope}.`);
    console.log(`Applying policy: ${policy}${apply ? "" : "  (dry-run)"}\n`);
    console.log("  city".padEnd(24) + "  alcohol-or-site (keep/hide/del)   alcohol-only (keep/hide/del)");
    const fmt = (c: Counts) => `${c.keep}/${c.hide}/${c.delete}`.padEnd(16);
    for (const [city, b] of [...perCity.entries()].sort()) {
      console.log("  " + city.padEnd(22) + "  " + fmt(b["alcohol-or-site"]) + "                 " + fmt(b["alcohol-only"]));
    }

    // Classify under the SELECTED policy for the actual action sets.
    const verdicts = rows.map((v) => ({ row: v, verdict: classifyStub(toSignal(v), policy) }));
    const hideIds = verdicts.filter((x) => x.verdict.action === "hide").map((x) => x.row.id);
    const deleteRows = verdicts.filter((x) => x.verdict.action === "delete");
    const keepN = verdicts.filter((x) => x.verdict.action === "keep").length;
    console.log(`\nUnder ${policy}: keep ${keepN}, hide ${hideIds.length}, delete ${deleteRows.length}.`);

    if (verbose) {
      for (const action of ["delete", "hide"] as const) {
        const list = verdicts.filter((x) => x.verdict.action === action);
        if (list.length === 0) continue;
        console.log(`\n  ${action.toUpperCase()} (${list.length}):`);
        for (const { row, verdict } of list) {
          console.log(`    - [${row.city}] ${row.name}  (${row.primary_type ?? "?"}, ${row.website_url ?? "no site"}) — ${verdict.reason}`);
        }
      }
    }

    if (!apply) {
      console.log(`\n(dry-run) nothing changed. Re-run with --apply to hide ${hideIds.length} and soft-delete ${deleteRows.length}.`);
      return;
    }
    if (hideIds.length === 0 && deleteRows.length === 0) return;

    const deleteIds = deleteRows.map((x) => x.row.id);
    await sql.begin(async (tx) => {
      if (hideIds.length > 0) {
        await tx`UPDATE venues SET status = 'no_happy_hour', updated_at = now() WHERE id = ANY(${hideIds}) AND status = 'active'`;
        for (const { row, verdict } of verdicts.filter((x) => x.verdict.action === "hide")) {
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('venues', ${row.id}, ${tx.json({ status: "active" })}, ${tx.json({ status: "no_happy_hour" })},
                    'script', ${`cleanup-stubs hide (${verdict.reason})`})
          `;
        }
      }
      if (deleteIds.length > 0) {
        await tx`UPDATE happy_hours SET active = false, updated_at = now() WHERE venue_id = ANY(${deleteIds}) AND active = true AND deleted_at IS NULL`;
        await tx`UPDATE venues SET deleted_at = now(), updated_at = now() WHERE id = ANY(${deleteIds})`;
        for (const { row, verdict } of deleteRows) {
          await tx`
            INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
            VALUES ('venues', ${row.id}, ${tx.json({ deletedAt: null })}, ${tx.json({ deletedAt: "now" })},
                    'script', ${`cleanup-stubs delete (${verdict.reason})`})
          `;
        }
      }
    });
    console.log(`\nApplied: hid ${hideIds.length}, soft-deleted ${deleteIds.length}.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (If `requireCityArgs` import path differs, match `scripts/suppress-dead-end-stubs.ts` line 23.)

- [ ] **Step 3: Commit**

```bash
git add scripts/cleanup-stubs.ts
git commit -m "feat(cleanup): cleanup-stubs CLI — dual-policy report + audit-logged apply"
```

---

## Task 4: Wire the npm script + manual dry-run verification

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add the npm script**

In `package.json` `"scripts"`, next to `suppress:dead-end-stubs`:

```json
    "cleanup:stubs": "tsx scripts/cleanup-stubs.ts",
```

- [ ] **Step 2: Dry-run against the local DB (requires Docker Postgres up)**

Run: `pnpm cleanup:stubs`
Expected: a per-city table with two count triples per row, then a one-line summary under the default `alcohol-or-site` policy, ending with `(dry-run) nothing changed.` No exceptions.

- [ ] **Step 3: Sanity-check one city verbose, both policies**

Run: `pnpm cleanup:stubs --city oakland --state CA --verbose`
Expected: DELETE list should contain url-less / no-alcohol restaurants (e.g. the Oakland entries from `docs/url-less-stubs-review-2026-06-23.md` that are NOT `[BAR]`), and the `[BAR]` entries should NOT appear in delete/hide (they classify `keep`). Confirm the `alcohol-only` column hides more than `alcohol-or-site` (good-site restaurants move keep→hide).

- [ ] **Step 4: Confirm hermetic suite still green**

Run: `bash scripts/ci-tests.sh 2>&1 | tail -5`
Expected: no `FAIL` lines.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat(cleanup): add cleanup:stubs npm script"
```

---

## Post-implementation (operator, not part of this plan)

1. `pnpm cleanup:stubs` (all cities, dry-run) → review counts.
2. Compare the `alcohol-only` delta in the same report; decide policy.
3. Optionally `pnpm cleanup:stubs --refresh-sites` to sharpen the dead-site delete test.
4. `pnpm cleanup:stubs --policy <chosen> --apply`.
5. Hand off to operator for prod publish (operator handles deploys).

---

## Self-Review

**Spec coverage:**
- Disposition model (keep/hide/delete) → Task 1 classifier + Task 3 writes. ✓
- Population query (no-HH active, join seed_candidates, website_url + site_health) → Task 3 SQL. ✓
- Signals (alcoholPositive/menuPlatformOnly/zeroHhType/hasSite/deadSite) → Task 1. ✓
- Classification ladder incl. policy split → Task 1 + Task 1 tests. ✓
- Dual-policy side-by-side report → Task 3 report block. ✓
- `--apply` single transaction + audit log → Task 3. ✓
- `--refresh-sites` → Task 3 execSync. ✓
- `--verbose`, `--policy`, `--city/--state` → Task 3 arg parsing. ✓
- Reuse hasAlcoholSignal / isMenuPlatformWebsite / ZERO_HH_TYPES → Task 1 imports. ✓
- Non-goals (no discovery change, no curated-removals dup, no admin UI) → respected (not implemented). ✓
- Testing (pure classifier unit test) → Task 1. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `classifyStub(sig, policy)`, `StubSignal` fields (`name`/`primaryType`/`types`/`websiteUrl`/`siteHealth`), `StubAction` (`keep`/`hide`/`delete`), `StubCleanupPolicy` (`alcohol-or-site`/`alcohol-only`), `DEAD_SITE_HEALTH` — used identically in Tasks 1 and 3. ✓
