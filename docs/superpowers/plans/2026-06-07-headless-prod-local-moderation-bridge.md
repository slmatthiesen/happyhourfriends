# Headless Prod + Local Moderation Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring prod's `queued_admin` submission leftovers down to the operator's local `/admin`, and on approval publish the resulting venue change back up to prod automatically — keeping prod headless.

**Architecture:** Two new functions in the existing `lib/sync/dbSync.ts` (`publishVenue` = scoped local→prod upsert of one venue's subtree; `pullQueuedSubmissions` = prod→local upsert of `queued_admin` rows). They're exposed as CLI directions in `scripts/sync/db-sync.ts`, wrapped by bash tunnel scripts that reuse the existing `with-prod-tunnel.sh` credential path, and called from the local `/admin` server actions (`applyAction` publishes after a local apply; `revertAction` publishes the reverted venue). Prod's AI pipeline is unchanged.

**Tech Stack:** TypeScript, postgres.js, Drizzle, Next.js App Router server actions, bash + SSH tunnel, tsx.

---

## Background facts (read before starting)

- `lib/sync/dbSync.ts` already has `additivePush` (local→prod insert-only) and `upsertPull` (prod→local PK-upsert), plus reusable helpers `tableMeta`, `insertRows`, `topoSortNeighborhoods`, `RollbackSignal`/`swallowRollback`, and `SYNC_TABLES`. **Reuse these.**
- `insertRows(target, table, cols, rows, conflict)` supports `conflict = "do-nothing"` or `{ pk, update }` (PK upsert). It infers nothing about natural keys.
- `happy_hours` has a **partial unique index** `happy_hours_natural_uq` on `(venue_id, days_of_week, start_time, end_time, location_within_venue) WHERE deleted_at IS NULL`. We do **not** write `ON CONFLICT` against it. A PK-upsert publish relies on this index to **reject** a rare duplicate-window insert loudly (transaction rolls back, operator sees the error) — that is the spec's "free insurance," not collision handling.
- `edit_submissions` has only a **self-FK** `parent_submission_id → edit_submissions`. No FK to `venues` (so pulling a submission whose target venue isn't local yet is safe). Status enum includes `queued_admin`, `applied`, `auto_applied`, `rejected`, `reverted`.
- `applySubmission` returns `ApplyResult { submissionId, status, tableName, rowId, auditId }`.
- `revertAudit` returns `RevertResult { auditId, revertAuditId, action }` and internally knows the reverted row's `tableName` + `rowId` (lines ~503-506) — we'll surface those.
- The test harness `scripts/sync/test-db-sync.ts` spins up two scratch DBs with the real schema and runs assertions. It needs live Docker Postgres and is run via `npm run test:db-sync` (NOT hermetic CI). We extend it.
- The publish path only ever runs **locally** (prod has no `/admin`), so shelling out to bash from a server action is acceptable.

## File structure

- **Modify** `lib/sync/dbSync.ts` — add `publishVenue` + `pullQueuedSubmissions` (+ a generic `topoSortByParent` helper). One responsibility: safe scoped data movement.
- **Modify** `scripts/sync/db-sync.ts` — add `publish-venue` and `pull-queue` CLI directions.
- **Create** `scripts/publish-venue-to-prod.sh`, `scripts/pull-queue-from-prod.sh` — thin bash wrappers over `with-prod-tunnel.sh`.
- **Modify** `package.json` — add `pull:queue` (and `publish:venue`) scripts.
- **Modify** `lib/apply/engine.ts` — export `venueIdForRow`; add `tableName`/`rowId` to `RevertResult`.
- **Create** `lib/sync/publishVenueToProd.ts` — client that execFiles the bash wrapper (the seam between the server action and the tunnel).
- **Modify** `app/admin/actions.ts` — `applyAction` + `revertAction` publish to prod; `ActionResult` gains `warning?`.
- **Modify** `scripts/sync/test-db-sync.ts` — assertions for `publishVenue` + `pullQueuedSubmissions`.
- **Modify** `docs/data-sync-runbook.md` — document the new flow + commands.

---

## Task 1: `publishVenue` — scoped local→prod upsert of one venue's subtree

**Files:**
- Modify: `lib/sync/dbSync.ts`
- Test: `scripts/sync/test-db-sync.ts`

- [ ] **Step 1: Add a generic parent topo-sort helper** (next to `topoSortNeighborhoods` in `lib/sync/dbSync.ts`)

```ts
/**
 * Order rows so a row never precedes the row it references via `parentKey` (a self-FK).
 * Rows whose parent isn't in the batch come first; cycles can't occur for our trees.
 * Generalises topoSortNeighborhoods for any single self-referential FK column.
 */
function topoSortByParent(
  rows: Record<string, unknown>[],
  parentKey: string,
): Record<string, unknown>[] {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const ordered: Record<string, unknown>[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (row: Record<string, unknown>) => {
    const id = row.id as string;
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const parentId = row[parentKey] as string | null;
    if (parentId && byId.has(parentId)) visit(byId.get(parentId)!);
    visiting.delete(id);
    placed.add(id);
    ordered.push(row);
  };
  for (const row of rows) visit(row);
  return ordered;
}
```

- [ ] **Step 2: Add `publishVenue`** (append after `upsertPull` in `lib/sync/dbSync.ts`)

```ts
/**
 * local → prod, scoped to ONE venue. Upserts (by PK) the venue plus its dependency
 * rows (city, chain, tags, neighbourhood chain) and its full subtree (happy_hours,
 * happy_hour_exceptions, offerings, venue_tags). Used when the operator approves a
 * submission locally and we publish the result up to a headless prod.
 *
 * happy_hours/offerings are upserted by PK. We deliberately do NOT special-case the
 * natural-key index: in the rare event prod already holds the same window under a
 * different id (a same-day double-edit), the partial unique index rejects the insert
 * and the whole transaction rolls back — a loud, safe failure, never a duplicate row.
 *
 * Soft-deletes propagate: a reverted/soft-deleted HH carries its deleted_at up, so
 * revert round-trips. If submissionId is given, the matching prod edit_submissions row
 * is flipped to 'applied' so it leaves the operator's queue on the next pull.
 */
export async function publishVenue(
  local: Sql,
  prod: Sql,
  opts: { venueId: string; submissionId?: string; dryRun?: boolean },
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const { venueId } = opts;

  const [venue] = await local<{ city_id: string; neighborhood_id: string | null; chain_id: string | null }[]>`
    SELECT city_id, neighborhood_id, chain_id FROM venues WHERE id = ${venueId}`;
  if (!venue) throw new Error(`publishVenue: venue ${venueId} not found locally`);

  // Walk the neighbourhood parent chain locally so prod has every ancestor first.
  const nbIds: string[] = [];
  let cur = venue.neighborhood_id;
  while (cur) {
    nbIds.push(cur);
    const [row] = await local<{ parent_id: string | null }[]>`
      SELECT parent_id FROM neighborhoods WHERE id = ${cur}`;
    cur = row?.parent_id ?? null;
    if (cur && nbIds.includes(cur)) break; // guard against a cycle
  }

  await prod.begin(async (tx) => {
    let hhIds: string[] = [];

    for (const table of SYNC_TABLES) {
      if (table === "seed_candidates") continue; // discovery data, not part of a venue publish

      const meta = await tableMeta(tx, table);
      let rows: Record<string, unknown>[] = [];

      if (table === "cities") {
        rows = await local`SELECT ${local(meta.columns)} FROM cities WHERE id = ${venue.city_id}`;
      } else if (table === "chains") {
        rows = venue.chain_id
          ? await local`SELECT ${local(meta.columns)} FROM chains WHERE id = ${venue.chain_id}`
          : [];
      } else if (table === "tags") {
        rows = await local`SELECT ${local(meta.columns)} FROM tags
          WHERE id IN (SELECT tag_id FROM venue_tags WHERE venue_id = ${venueId})`;
      } else if (table === "neighborhoods") {
        rows = nbIds.length
          ? topoSortByParent(
              await local`SELECT ${local(meta.columns)} FROM neighborhoods WHERE id = ANY(${nbIds})`,
              "parent_id",
            )
          : [];
      } else if (table === "venues") {
        rows = await local`SELECT ${local(meta.columns)} FROM venues WHERE id = ${venueId}`;
      } else if (table === "happy_hours") {
        rows = await local`SELECT ${local(meta.columns)} FROM happy_hours WHERE venue_id = ${venueId}`;
        hhIds = rows.map((r) => r.id as string);
      } else if (table === "happy_hour_exceptions" || table === "offerings") {
        rows = hhIds.length
          ? await local`SELECT ${local(meta.columns)} FROM ${local(table)} WHERE happy_hour_id = ANY(${hhIds})`
          : [];
      } else if (table === "venue_tags") {
        rows = await local`SELECT ${local(meta.columns)} FROM venue_tags WHERE venue_id = ${venueId}`;
      }

      const nonPk = meta.columns.filter((c) => !meta.pk.includes(c));
      const conflict =
        nonPk.length === 0 ? ("do-nothing" as const) : { update: nonPk, pk: meta.pk };
      const changed = await insertRows(tx, table, meta.columns, rows, conflict);
      results.push({ table, changed });
    }

    if (opts.submissionId) {
      await tx`UPDATE edit_submissions SET status = 'applied', decided_at = now()
        WHERE id = ${opts.submissionId} AND status = 'queued_admin'`;
    }

    if (opts.dryRun) throw new RollbackSignal();
  }).catch(swallowRollback);

  return results;
}
```

- [ ] **Step 3: Add the failing publishVenue test section** to `scripts/sync/test-db-sync.ts`. Add `publishVenue` to the import on line 16, and a new constant + assertions block inserted **before** the `console.log("✅ ...")` line (line ~185). First add to the `U` object (after `offNew`): `vEdit: "00000000-0000-0000-0000-000000000f04", hhEdit: "00000000-0000-0000-0000-0000000000e9",`. Then insert this block:

```ts
    // ── 4. publishVenue: an EDIT to an EXISTING prod venue publishes up ────────────
    // vShared exists on BOTH sides. Stage a local edit to it + a NEW happy hour, then
    // publish ONLY that venue. (additivePush in step 2 deliberately did NOT carry these.)
    await local`UPDATE venues SET name = 'Shared Bar (corrected locally)' WHERE id = ${U.vShared}`;
    await local`INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time)
      VALUES (${U.hhEdit}, ${U.vShared}, ARRAY[6]::smallint[], '14:00', '16:00')`;

    await publishVenue(local, prod, { venueId: U.vShared, dryRun: false });

    assert.equal(
      (await prod`SELECT name FROM venues WHERE id = ${U.vShared}`)[0].name,
      "Shared Bar (corrected locally)",
      "publishVenue must update an existing prod venue's fields",
    );
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM happy_hours WHERE id = ${U.hhEdit}`)[0].n),
      1,
      "publishVenue must carry the venue's new happy hour up to prod",
    );

    // ── 4b. Natural-key dup is rejected loudly, never duplicated ───────────────────
    // Insert the SAME window on prod under a DIFFERENT id, then try to publish local's.
    await prod`UPDATE happy_hours SET id = gen_random_uuid() WHERE id = ${U.hhEdit}`;
    let rejected = false;
    try {
      await publishVenue(local, prod, { venueId: U.vShared, dryRun: false });
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "publishVenue must reject (not duplicate) a same-window natural-key conflict");
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM happy_hours
        WHERE venue_id = ${U.vShared} AND days_of_week = ARRAY[6]::smallint[] AND deleted_at IS NULL`)[0].n),
      1,
      "a natural-key conflict must leave exactly one window on prod",
    );
```

- [ ] **Step 4: Run the test — expect FAIL** (publishVenue undefined / not exported)

Run: `npm run test:db-sync`
Expected: FAIL — `publishVenue is not a function` or a TypeScript/import error, OR an assertion failure if partially wired.

- [ ] **Step 5: Run again after Steps 1-2 are in place — expect PASS**

Run: `npm run test:db-sync`
Expected: PASS — prints `✅ db-sync integration test passed`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (the two pre-existing Phase 0 lint/type issues may remain).

- [ ] **Step 7: Commit**

```bash
git add lib/sync/dbSync.ts scripts/sync/test-db-sync.ts
git commit -m "feat(sync): publishVenue — scoped local→prod upsert of one venue subtree"
```

---

## Task 2: `pullQueuedSubmissions` — bring prod's `queued_admin` leftovers down

**Files:**
- Modify: `lib/sync/dbSync.ts`
- Test: `scripts/sync/test-db-sync.ts`

- [ ] **Step 1: Add `pullQueuedSubmissions`** (append after `publishVenue` in `lib/sync/dbSync.ts`)

```ts
/**
 * prod → local, non-destructive. Upserts (by id) every prod edit_submissions row that
 * is currently 'queued_admin', plus any parent rows they reference (self-FK), so the
 * operator's local /admin queue shows exactly the leftovers the prod AI couldn't
 * resolve. Idempotent — re-running is safe, and a submission that has since been
 * resolved on prod (status flipped) simply stops matching. Never deletes local rows.
 */
export async function pullQueuedSubmissions(
  prod: Sql,
  local: Sql,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  await local.begin(async (tx) => {
    const meta = await tableMeta(tx, "edit_submissions");
    // queued_admin rows + their parents (a report fan-out parent may itself be resolved
    // but is still needed to satisfy the self-FK on its children).
    let rows: Record<string, unknown>[] = await prod`
      SELECT ${prod(meta.columns)} FROM edit_submissions
       WHERE status = 'queued_admin'
          OR id IN (
            SELECT parent_submission_id FROM edit_submissions
             WHERE status = 'queued_admin' AND parent_submission_id IS NOT NULL
          )`;
    rows = topoSortByParent(rows, "parent_submission_id");

    const nonPk = meta.columns.filter((c) => !meta.pk.includes(c));
    const changed = await insertRows(tx, "edit_submissions", meta.columns, rows, {
      update: nonPk,
      pk: meta.pk,
    });
    results.push({ table: "edit_submissions" as SyncTable, changed });

    if (opts.dryRun) throw new RollbackSignal();
  }).catch(swallowRollback);

  return results;
}
```

Note: the `as SyncTable` cast is needed because `edit_submissions` is intentionally not in `SYNC_TABLES`. That is correct — keep it out of the bulk sync list.

- [ ] **Step 2: Add the failing pullQueuedSubmissions test section.** Add `pullQueuedSubmissions` to the import on line 16. Add to the `U` object: `subQueued: "00000000-0000-0000-0000-0000000000b1",`. Insert before the `console.log("✅ ...")` line:

```ts
    // ── 5. pullQueuedSubmissions: prod's queued_admin leftovers come down ──────────
    await prod`INSERT INTO edit_submissions (id, target_type, target_id, diff_jsonb, status)
      VALUES (${U.subQueued}, 'venue', ${U.vShared}, '{"after":{"name":"x"}}'::jsonb, 'queued_admin')`;
    // A prod submission that is NOT queued_admin must NOT come down.
    await prod`INSERT INTO edit_submissions (target_type, target_id, diff_jsonb, status)
      VALUES ('venue', ${U.vShared}, '{"after":{"name":"y"}}'::jsonb, 'auto_applied')`;

    await pullQueuedSubmissions(prod, local, { dryRun: false });

    assert.equal(
      Number((await local`SELECT count(*)::int n FROM edit_submissions WHERE id = ${U.subQueued}`)[0].n),
      1,
      "pullQueuedSubmissions must bring a queued_admin row into local",
    );
    assert.equal(
      Number((await local`SELECT count(*)::int n FROM edit_submissions WHERE status = 'auto_applied'`)[0].n),
      0,
      "pullQueuedSubmissions must NOT bring down non-queued_admin rows",
    );
```

If `edit_submissions` has NOT-NULL columns beyond those in the INSERTs above, the test INSERT will fail loudly — add the missing columns with minimal valid values (check `db/schema/moderation.ts` for `notNull()` columns without defaults; e.g. include `submitter_fingerprint` if required).

- [ ] **Step 3: Run the test — expect FAIL**

Run: `npm run test:db-sync`
Expected: FAIL — `pullQueuedSubmissions is not a function`.

- [ ] **Step 4: Run again after Step 1 — expect PASS**

Run: `npm run test:db-sync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/dbSync.ts scripts/sync/test-db-sync.ts
git commit -m "feat(sync): pullQueuedSubmissions — bring prod queued_admin leftovers to local"
```

---

## Task 3: CLI directions `publish-venue` and `pull-queue`

**Files:**
- Modify: `scripts/sync/db-sync.ts`

- [ ] **Step 1: Extend the CLI** to handle the two new directions. Replace the body of `main()` in `scripts/sync/db-sync.ts` (lines ~33-63) with:

```ts
async function main() {
  const [direction, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  const dryRun = !apply;

  const VALID = ["push", "pull", "publish-venue", "pull-queue"];
  if (!VALID.includes(direction)) {
    console.error("Usage: db-sync.ts <push|pull|publish-venue|pull-queue> [--apply] [--venue <id>] [--submission <id>]");
    process.exit(1);
  }

  const localUrl = process.env.DATABASE_URL;
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!localUrl) throw new Error("DATABASE_URL is not set (local DB)");
  if (!prodUrl) throw new Error("PROD_DATABASE_URL is not set (prod DB / tunnel)");

  const flagValue = (name: string): string | undefined => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };

  const local = connect(localUrl);
  const prod = connect(prodUrl);
  try {
    if (direction === "push") {
      printResults("local → prod (additive push)", await additivePush(local, prod, { dryRun }), dryRun);
    } else if (direction === "pull") {
      printResults("prod → local (upsert pull)", await upsertPull(prod, local, { dryRun }), dryRun);
    } else if (direction === "pull-queue") {
      printResults("prod → local (queued_admin submissions)", await pullQueuedSubmissions(prod, local, { dryRun }), dryRun);
    } else {
      const venueId = flagValue("--venue");
      if (!venueId) throw new Error("publish-venue requires --venue <id>");
      const submissionId = flagValue("--submission");
      printResults(
        `local → prod (publish venue ${venueId})`,
        await publishVenue(local, prod, { venueId, submissionId, dryRun }),
        dryRun,
      );
    }
    if (dryRun) console.log("\nRe-run with --apply to commit.");
  } finally {
    await local.end({ timeout: 5 });
    await prod.end({ timeout: 5 });
  }
}
```

- [ ] **Step 2: Update the import** on line 17 of `scripts/sync/db-sync.ts`:

```ts
import { additivePush, upsertPull, publishVenue, pullQueuedSubmissions, type SyncResult } from "@/lib/sync/dbSync";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync/db-sync.ts
git commit -m "feat(sync): publish-venue + pull-queue CLI directions"
```

---

## Task 4: Bash wrappers + package.json scripts

**Files:**
- Create: `scripts/publish-venue-to-prod.sh`
- Create: `scripts/pull-queue-from-prod.sh`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/pull-queue-from-prod.sh`**

```bash
#!/usr/bin/env bash
# Pull prod's queued_admin submission leftovers DOWN to local for review in /admin.
# Non-destructive upsert by id; never deletes. Defaults to a DRY RUN; add --apply.
#   PROD_IP=203.0.113.10 npm run pull:queue            # preview
#   PROD_IP=203.0.113.10 npm run pull:queue -- --apply # commit
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel.sh"
run_sync pull-queue "$@"
```

- [ ] **Step 2: Create `scripts/publish-venue-to-prod.sh`**

```bash
#!/usr/bin/env bash
# Publish ONE locally-approved venue (subtree) UP to prod by PK upsert, and flip its
# prod submission to 'applied'. Called by the local /admin Apply/Revert actions.
# Defaults to a DRY RUN; the server action passes --apply.
#   PROD_IP=203.0.113.10 bash scripts/publish-venue-to-prod.sh --venue <id> --submission <id> --apply
set -euo pipefail
source "$(dirname "$0")/sync/with-prod-tunnel.sh"
run_sync publish-venue "$@"
```

- [ ] **Step 3: Make them executable**

Run: `chmod +x scripts/publish-venue-to-prod.sh scripts/pull-queue-from-prod.sh`

- [ ] **Step 4: Add npm scripts** to `package.json` (next to the existing `pull:data:upsert`):

```json
    "pull:queue": "bash scripts/pull-queue-from-prod.sh",
    "publish:venue": "bash scripts/publish-venue-to-prod.sh",
```

- [ ] **Step 5: Verify the dry-run CLI wiring** without prod by faking both URLs at the same DB (sanity that argv parsing + a dry run roll back cleanly; uses local docker DB for both ends):

Run: `DATABASE_URL="$DATABASE_URL" PROD_DATABASE_URL="$DATABASE_URL" ./node_modules/.bin/tsx scripts/sync/db-sync.ts pull-queue`
Expected: prints `prod → local (queued_admin submissions) (DRY RUN — nothing written)` and a TOTAL line, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/publish-venue-to-prod.sh scripts/pull-queue-from-prod.sh package.json
git commit -m "feat(sync): pull:queue + publish:venue bash wrappers"
```

---

## Task 5: Export `venueIdForRow` + surface `tableName`/`rowId` on revert

**Files:**
- Modify: `lib/apply/engine.ts`

- [ ] **Step 1: Add an exported `venueIdForRow`** to `lib/apply/engine.ts` (place it just above `resolveVenueRevalidationTarget`, ~line 184):

```ts
/**
 * Resolve the owning venue id for an audited row. venues → itself; happy_hours →
 * its venue_id; offerings → its happy hour's venue_id. Returns null for anything else.
 * Used by the admin actions to know which venue to publish to prod after apply/revert.
 */
export async function venueIdForRow(
  tableName: string,
  rowId: string,
): Promise<string | null> {
  if (tableName === "venues") return rowId;
  if (tableName === "happy_hours") {
    const [hh] = await db
      .select({ venueId: happyHours.venueId })
      .from(happyHours)
      .where(eq(happyHours.id, rowId))
      .limit(1);
    return hh?.venueId ?? null;
  }
  if (tableName === "offerings") {
    const [row] = await db
      .select({ venueId: happyHours.venueId })
      .from(offerings)
      .innerJoin(happyHours, eq(offerings.happyHourId, happyHours.id))
      .where(eq(offerings.id, rowId))
      .limit(1);
    return row?.venueId ?? null;
  }
  return null;
}
```

- [ ] **Step 2: DRY up `resolveVenueRevalidationTarget`** to call it. Replace the `let venueId` block (lines ~189-207) with:

```ts
  const venueId = await venueIdForRow(tableName, rowId);
```

(Leave the `if (!venueId) return null;` and everything after it unchanged.)

- [ ] **Step 3: Add `tableName` + `rowId` to `RevertResult`** (the interface at ~line 480):

```ts
export interface RevertResult {
  auditId: string;
  revertAuditId: string;
  action: "restored" | "soft_deleted";
  tableName: string;
  rowId: string;
}
```

- [ ] **Step 4: Return them** from `revertAudit`. The transaction already has `tableName` and `rowId` in scope (lines ~503-506) and returns `{ result, tableName, rowId }`. Update the inner `result` object (~line 547-548) to include them:

```ts
    return {
      result: { auditId, revertAuditId: revertAudit.id, action, tableName, rowId },
      tableName,
      rowId,
    };
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/apply/engine.ts
git commit -m "refactor(engine): export venueIdForRow; surface tableName/rowId on revert"
```

---

## Task 6: `publishVenueToProd` client (server action → bash tunnel seam)

**Files:**
- Create: `lib/sync/publishVenueToProd.ts`

- [ ] **Step 1: Create the client**

```ts
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PublishResult {
  ok: boolean;
  /** true when publishing was skipped because prod isn't configured (local-only dev). */
  skipped?: boolean;
  error?: string;
}

/**
 * Publish one locally-approved venue UP to prod by shelling out to the existing
 * tunnel script (which reads prod credentials off the box — never from local disk).
 * No-ops cleanly when PROD_IP is unset so local dev without prod config still works.
 * Only ever runs locally (prod has no /admin), so spawning bash here is fine.
 */
export async function publishVenueToProd(
  venueId: string,
  submissionId?: string,
): Promise<PublishResult> {
  if (!process.env.PROD_IP) return { ok: true, skipped: true };

  const args = ["scripts/publish-venue-to-prod.sh", "--venue", venueId, "--apply"];
  if (submissionId) args.push("--submission", submissionId);

  try {
    await run("bash", args, {
      cwd: process.cwd(),
      env: process.env,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, error: (err.stderr || err.message || "publish failed").trim().slice(0, 500) };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/sync/publishVenueToProd.ts
git commit -m "feat(sync): publishVenueToProd client (admin action → tunnel seam)"
```

---

## Task 7: Wire publish into `applyAction`

**Files:**
- Modify: `app/admin/actions.ts`

- [ ] **Step 1: Add `warning` to `ActionResult`** (the interface at ~line 17):

```ts
export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set when the local apply succeeded but publishing to prod did not. */
  warning?: string;
}
```

- [ ] **Step 2: Add imports** to `app/admin/actions.ts`:

```ts
import { applySubmission, rejectSubmission, revertAudit, venueIdForRow } from "@/lib/apply/engine";
import { publishVenueToProd } from "@/lib/sync/publishVenueToProd";
```

(Replace the existing 3-name import from `@/lib/apply/engine`.)

- [ ] **Step 3: Publish after a successful local apply.** Replace the body of `applyAction` (lines ~27-41) with:

```ts
  try {
    const admin = await requireAdmin();
    const res = await applySubmission(
      submissionId,
      { actor: adminActor(admin.email) },
      overrideAfter && Object.keys(overrideAfter).length > 0 ? overrideAfter : undefined,
    );
    revalidatePath("/admin");
    revalidatePath("/admin/audit");

    const venueId = await venueIdForRow(res.tableName, res.rowId);
    let warning: string | undefined;
    if (venueId) {
      const pub = await publishVenueToProd(venueId, submissionId);
      if (!pub.ok) warning = `Applied locally, but publishing to prod failed: ${pub.error}`;
    }
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Apply failed" };
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Build (server-only import must not leak to client bundles)**

Run: `npm run build`
Expected: compiles. The `import "server-only"` in `publishVenueToProd.ts` is correct because `actions.ts` is `"use server"`. If the build complains about `server-only` in a client path, the import chain is wrong — stop and fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add app/admin/actions.ts
git commit -m "feat(admin): approving a submission auto-publishes the venue to prod"
```

---

## Task 8: Wire publish into `revertAction` (round-trip undo)

**Files:**
- Modify: `app/admin/actions.ts`

- [ ] **Step 1: Publish the reverted venue.** Replace the body of `revertAction` (lines ~112-122) with:

```ts
  try {
    const admin = await requireAdmin();
    const res = await revertAudit(auditId, { actor: adminActor(admin.email) });
    revalidatePath("/admin/audit");
    revalidatePath("/admin");

    const venueId = await venueIdForRow(res.tableName, res.rowId);
    let warning: string | undefined;
    if (venueId) {
      const pub = await publishVenueToProd(venueId);
      if (!pub.ok) warning = `Reverted locally, but publishing the revert to prod failed: ${pub.error}`;
    }
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Revert failed" };
  }
```

Note: revert publishes the venue's **current** local state (post-revert) — a restored value or a soft-deleted (`deleted_at` set) row — by PK upsert, so the revert reaches prod. No `submissionId` is passed (revert shouldn't flip a submission to `applied`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Surface the warning in the UI (optional but recommended).** Grep for where `applyAction`/`revertAction` results are consumed:

Run: `grep -rn "applyAction\|revertAction" app components`

For each call site that shows `result.error`, also show `result.warning` (e.g. a yellow toast/banner). If the call sites only check `result.ok`, add a minimal `if (result.warning) <show it>`. Keep it small — this is operator feedback, not a redesign.

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add app/admin app/components components
git commit -m "feat(admin): revert round-trips to prod; surface publish warnings"
```

---

## Task 9: Documentation + manual end-to-end verification

**Files:**
- Modify: `docs/data-sync-runbook.md`

- [ ] **Step 1: Document the bridge** — add a section to `docs/data-sync-runbook.md` after the upsert-pull section:

```markdown
## Moderation bridge (headless prod → local /admin → auto-publish)

Prod has no /admin. Its AI pipeline auto-applies what it can confirm; the rest park as
`queued_admin`. This bridge brings those leftovers to your local /admin and publishes
your approvals back up.

- **Pull leftovers down** (nightly cron + on demand):
  ```bash
  PROD_IP=<ip> npm run pull:queue            # DRY RUN
  PROD_IP=<ip> npm run pull:queue -- --apply # commit
  ```
  Upserts prod `edit_submissions` rows where `status='queued_admin'` into local by id.
  Idempotent; never deletes. Add to the nightly cron next to `pull:data:upsert`.

- **Approve in local /admin** → the Apply button applies locally AND auto-publishes that
  venue to prod (`publishVenueToProd` → `scripts/publish-venue-to-prod.sh`), flipping the
  prod submission to `applied`. Needs `PROD_IP` in the local environment; without it the
  apply still works locally and publishing is skipped.

- **Revert** round-trips: reverting an applied change publishes the reverted venue state
  (restored or soft-deleted) back to prod too.

> Follow-up (tracked, not yet done): use a dedicated, narrowly-scoped SSH key for publish
> instead of the root key the sync scripts currently use.
```

- [ ] **Step 2: Add the on-demand pull to the nightly cron example** in the runbook (the existing cron block): add a line `30 4 * * * cd <repo> && PROD_IP=<ip> npm run pull:queue -- --apply >> /tmp/hhf-queue.log 2>&1`.

- [ ] **Step 3: Full automated test pass**

Run: `npm run test:db-sync && npm run typecheck && npm run build`
Expected: integration test prints ✅; typecheck and build clean.

- [ ] **Step 4: Manual end-to-end smoke (requires prod access)** — document the result in the commit message. With a disposable test submission on prod:

```bash
# 1. Create a queued_admin submission on prod (via the live submit flow or psql).
# 2. Pull it down (preview, then apply):
PROD_IP=<ip> npm run pull:queue
PROD_IP=<ip> npm run pull:queue -- --apply
# 3. Confirm it appears in local /admin queue (npm run dev → /admin).
# 4. Approve it in /admin. Confirm:
#    - local DB shows the change,
#    - prod shows the change (psql over tunnel),
#    - prod edit_submissions.status is now 'applied'.
# 5. Revert it in /admin/audit. Confirm prod reflects the revert.
```

Expected: the change and its revert both reach prod; the submission leaves the queue.

- [ ] **Step 5: Commit**

```bash
git add docs/data-sync-runbook.md
git commit -m "docs: document the headless-prod moderation bridge + cron"
```

---

## Self-review checklist (run after all tasks)

- [ ] **Spec coverage:** pull leftovers down (Task 2/4/9), local review via existing /admin (no work needed), approve→auto-publish (Task 1/6/7), edits to existing venues (Task 1 — PK upsert updates existing prod rows), natural-key safety (Task 1 Step 3 test 4b), revert round-trips (Task 5/8), on-demand `pull:queue` (Task 4), credentials reuse existing SSH path (Task 4/6). All covered.
- [ ] **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- [ ] **Type consistency:** `publishVenue` / `pullQueuedSubmissions` signatures match between `dbSync.ts`, the CLI import (Task 3), and the test import. `RevertResult` gains `tableName`/`rowId` (Task 5) which `revertAction` consumes (Task 8). `ActionResult.warning` added (Task 7) and set in both actions. `venueIdForRow` signature identical in engine, actions.
- [ ] **No prod /admin:** nothing in this plan adds an admin route or runtime to prod. The publish path runs only locally.
