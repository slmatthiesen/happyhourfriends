/**
 * Safe, non-destructive data sync between the local dev DB and prod.
 *
 * Two directions, both additive — neither ever TRUNCATEs or DELETEs, so user data
 * on prod and unpushed staging on local both survive:
 *
 *  - additivePush (local → prod): inserts only NEW venues (by id / google_place_id)
 *    and their full subtree, plus any missing cities/neighbourhoods/chains/tags/
 *    candidates. Existing prod venues are never modified — editing a live venue is a
 *    prod-side operation (see docs/pushing-data-to-prod.md). This is how you promote a
 *    city you curated locally without clobbering anything users contributed.
 *
 *  - upsertPull (prod → local): for every row on prod, upsert it into local by PK.
 *    Inserts rows users created on prod, updates ones they edited, and — crucially —
 *    NEVER touches local-only rows (a city you staged but haven't pushed). So a
 *    nightly pull keeps local current with prod without destroying staged work.
 *
 * Both wrap all writes in ONE transaction and support dryRun (rolls back, reporting
 * the counts that WOULD change) so you can preview before committing.
 *
 * All PKs are random UUIDs (db/schema/core.ts), so local and prod ids never collide
 * and a row's id is stable across a push+pull round-trip. Column lists and PKs are
 * read from information_schema at runtime, so generated columns (happy_hours.
 * crosses_midnight) are excluded automatically and new columns need no code change.
 */
import type { Sql, TransactionSql } from "postgres";

/** Either a top-level connection or an in-transaction handle — both are callable. */
type Queryable = Sql | TransactionSql;

/**
 * Tables to sync, in FK-dependency order (parents first). This is the venue/curation
 * data only — NOT user-generated tables (edit_submissions, flags, audit_log, …). The
 * destructive `pull:data` still does a full mirror including those when you need them.
 */
export const SYNC_TABLES = [
  "cities",
  "chains",
  "tags",
  "neighborhoods", // self-referential parent_id → inserted parent-first (topoSort)
  "venues",
  "happy_hours",
  "happy_hour_exceptions",
  "offerings",
  "venue_tags",
  "seed_candidates",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

export interface SyncResult {
  table: SyncTable;
  changed: number; // rows inserted (push) or inserted+updated (pull)
}

interface TableMeta {
  columns: string[]; // insertable columns (generated columns excluded)
  pk: string[];
}

/** Read insertable columns (generated excluded) + primary-key columns for a table. */
async function tableMeta(sql: Queryable, table: string): Promise<TableMeta> {
  const cols = await sql<{ column_name: string }[]>`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ${table}
       AND is_generated = 'NEVER'
     ORDER BY ordinal_position`;
  const pk = await sql<{ attname: string }[]>`
    SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = ${table}::regclass
       AND i.indisprimary`;
  return { columns: cols.map((c) => c.column_name), pk: pk.map((p) => p.attname) };
}

/**
 * Order neighbourhood rows so a row never precedes its parent_id (the only self-
 * referential FK we sync). Rows whose parent isn't in the batch (already on the
 * target, or null) come first; orphans that can't resolve are appended last so the
 * DB raises a clear FK error rather than us silently dropping them.
 */
function topoSortNeighborhoods(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const ordered: Record<string, unknown>[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (row: Record<string, unknown>) => {
    const id = row.id as string;
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const parentId = row.parent_id as string | null;
    if (parentId && byId.has(parentId)) visit(byId.get(parentId)!);
    visiting.delete(id);
    placed.add(id);
    ordered.push(row);
  };
  for (const row of rows) visit(row);
  return ordered;
}

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

type Conflict = "do-nothing" | { pk: string[]; update: string[] };

// Postgres caps a single statement at 65534 bind parameters. A multi-row INSERT binds
// rows × cols params, so wide tables (venues) overflow well before they run out of rows.
// Chunk so each statement stays under the cap, with headroom for any driver-added params.
const MAX_BIND_PARAMS = 60000;

/** Build the multi-row INSERT and run it; returns the number of rows actually written. */
async function insertRows(
  target: Queryable,
  table: string,
  cols: string[],
  rows: Record<string, unknown>[],
  conflict: Conflict,
): Promise<number> {
  if (rows.length === 0) return 0;

  // Build the upsert SET clause once — it's independent of the row batch.
  const set =
    conflict === "do-nothing"
      ? undefined
      : (() => {
          const setFrags = conflict.update.map((c) => target`${target(c)} = excluded.${target(c)}`);
          let frag = setFrags[0];
          for (let i = 1; i < setFrags.length; i++) frag = target`${frag}, ${setFrags[i]}`;
          return frag;
        })();

  const rowsPerChunk = Math.max(1, Math.floor(MAX_BIND_PARAMS / Math.max(cols.length, 1)));
  let written = 0;
  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    const chunk = rows.slice(i, i + rowsPerChunk);
    // postgres.js: target(rows, ...cols) → ("c1","c2") values (…),(…) with params.
    if (conflict === "do-nothing") {
      const res = await target`
        INSERT INTO ${target(table)} ${target(chunk, ...cols)}
        ON CONFLICT DO NOTHING
        RETURNING 1`;
      written += res.count;
    } else {
      const res = await target`
        INSERT INTO ${target(table)} ${target(chunk, ...cols)}
        ON CONFLICT (${target(conflict.pk)}) DO UPDATE SET ${set!}
        RETURNING 1`;
      written += res.count;
    }
  }
  return written;
}

/**
 * local → prod, additive. Inserts missing reference rows (cities/chains/tags/
 * neighbourhoods/candidates) and NEW venues + their HH/offerings/tags subtree.
 * Existing prod venues are left untouched. Returns per-table insert counts.
 */
export async function additivePush(
  local: Sql,
  prod: Sql,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  // Which local venues are genuinely new to prod (by id AND by google_place_id)?
  const prodVenues = await prod<{ id: string; google_place_id: string | null }[]>`
    SELECT id, google_place_id FROM venues`;
  const prodVenueIds = new Set(prodVenues.map((v) => v.id));
  const prodPlaceIds = new Set(
    prodVenues.map((v) => v.google_place_id).filter((g): g is string => g !== null),
  );

  await prod.begin(async (tx) => {
    let newVenueIds = new Set<string>();
    let newHhIds = new Set<string>();

    for (const table of SYNC_TABLES) {
      const meta = await tableMeta(tx, table);
      let rows: Record<string, unknown>[] = await local<Record<string, unknown>[]>`
        SELECT ${local(meta.columns)} FROM ${local(table)}`;

      if (table === "venues") {
        rows = rows.filter((r) => {
          const id = r.id as string;
          const gp = r.google_place_id as string | null;
          if (prodVenueIds.has(id)) return false;
          if (gp !== null && prodPlaceIds.has(gp)) return false;
          return true;
        });
        newVenueIds = new Set(rows.map((r) => r.id as string));
      } else if (table === "happy_hours") {
        rows = rows.filter((r) => newVenueIds.has(r.venue_id as string));
        newHhIds = new Set(rows.map((r) => r.id as string));
      } else if (table === "happy_hour_exceptions" || table === "offerings") {
        rows = rows.filter((r) => newHhIds.has(r.happy_hour_id as string));
      } else if (table === "venue_tags") {
        rows = rows.filter((r) => newVenueIds.has(r.venue_id as string));
      } else if (table === "seed_candidates") {
        // resulting_venue_id can point at a venue this push excluded (already in prod
        // under a different id via google_place_id match) — null it rather than drop
        // the whole candidate row, or the FK insert fails the entire transaction.
        rows = rows.map((r) => {
          const rv = r.resulting_venue_id as string | null;
          if (rv !== null && !prodVenueIds.has(rv) && !newVenueIds.has(rv)) {
            return { ...r, resulting_venue_id: null };
          }
          return r;
        });
      }

      if (table === "neighborhoods") rows = topoSortNeighborhoods(rows);

      const changed = await insertRows(tx, table, meta.columns, rows, "do-nothing");
      results.push({ table, changed });
    }

    if (opts.dryRun) throw new RollbackSignal();
  }).catch(swallowRollback);

  return results;
}

/**
 * prod → local, non-destructive upsert. Every prod row is inserted-or-updated into
 * local by PK; local-only rows are never visited, so staged work survives. Returns
 * per-table changed counts (insert + update).
 */
export async function upsertPull(
  prod: Sql,
  local: Sql,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  await local.begin(async (tx) => {
    for (const table of SYNC_TABLES) {
      const meta = await tableMeta(tx, table);
      let rows: Record<string, unknown>[] = await prod<Record<string, unknown>[]>`
        SELECT ${prod(meta.columns)} FROM ${prod(table)}`;
      if (table === "neighborhoods") rows = topoSortNeighborhoods(rows);

      const nonPk = meta.columns.filter((c) => !meta.pk.includes(c));
      // venue_tags is all-PK (no non-PK columns) → nothing to update, fall back to
      // insert-if-new so the join row still lands.
      const conflict =
        nonPk.length === 0
          ? ("do-nothing" as const)
          : { update: nonPk, pk: meta.pk };
      const changed = await insertRows(tx, table, meta.columns, rows, conflict);
      results.push({ table, changed });
    }

    if (opts.dryRun) throw new RollbackSignal();
  }).catch(swallowRollback);

  return results;
}

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

/**
 * prod → local, non-destructive. Upserts (by id) every prod edit_submissions row that
 * is currently 'queued_admin', plus any parent rows they reference (self-FK), so the
 * operator's local /admin queue shows exactly the leftovers the prod AI couldn't
 * resolve. Idempotent — re-running is safe, and a submission that has since been
 * resolved on prod (status flipped) simply stops matching. Never deletes local rows.
 */
/**
 * Print a one-line-per-submission breakdown of what a queued-pull will bring down, so the
 * operator can see WHICH venues/changes are in the queue without opening /admin. Resolves
 * venue + city names from prod (the target_id, or the venueId inside a new_happy_hour diff);
 * the human `summary` on each diff describes the change. Best-effort — a name lookup failure
 * never blocks the pull.
 */
async function logQueuedBreakdown(prod: Sql, rows: Record<string, unknown>[]): Promise<void> {
  const createdMs = (r: Record<string, unknown>) => {
    const t = new Date(r.created_at as string | Date).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const queued = rows
    .filter((r) => r.status === "queued_admin")
    .sort((a, b) => createdMs(a) - createdMs(b));
  if (queued.length === 0) return;

  const diffOf = (r: Record<string, unknown>) =>
    (r.diff_jsonb ?? {}) as { summary?: string; after?: { venueId?: string } };
  const venueIdOf = (r: Record<string, unknown>) =>
    (r.target_id as string | null) ?? diffOf(r).after?.venueId ?? null;

  const ids = [...new Set(queued.map(venueIdOf).filter((id): id is string => id != null))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const venues = await prod<{ id: string; name: string; state: string; slug: string }[]>`
      SELECT v.id, v.name, c.state, c.slug
        FROM venues v JOIN cities c ON c.id = v.city_id
       WHERE v.id = ANY(${ids})`;
    for (const v of venues) names.set(v.id, `${v.name} (${v.state}/${v.slug})`);
  }

  console.log(`\n  Queued for review (${queued.length}):`);
  for (const r of queued) {
    const id = venueIdOf(r);
    const where = (id && names.get(id)) ?? "(unknown venue)";
    const summary = diffOf(r).summary?.trim() || "(no summary)";
    console.log(`    ${String(r.target_type ?? "?").padEnd(16)} ${where} — ${summary}`);
  }
}

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

    await logQueuedBreakdown(prod, rows);

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

/**
 * Mark ONE submission 'rejected' on prod — the reject counterpart to publishVenue's
 * `status='applied'` flip. A rejection in local /admin writes only the LOCAL row, so
 * without this prod keeps the submission `queued_admin` and it reappears on every
 * pull:queue. Touches only edit_submissions (a reject can have no venue change); guarded
 * to `queued_admin` so an already-decided prod row is never clobbered. Idempotent.
 */
export async function markSubmissionRejected(
  prod: Sql,
  submissionId: string,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  await prod.begin(async (tx) => {
    const rows = await tx`
      UPDATE edit_submissions SET status = 'rejected', decided_at = now()
       WHERE id = ${submissionId} AND status = 'queued_admin'
       RETURNING id`;
    results.push({ table: "edit_submissions" as SyncTable, changed: rows.length });
    if (opts.dryRun) throw new RollbackSignal();
  }).catch(swallowRollback);
  return results;
}

/**
 * local → prod, propagate SOFT-DELETIONS only — the deletion counterpart to additivePush
 * (which only ever INSERTs, so a stub you removed locally would otherwise live on forever on
 * prod). For every venue soft-deleted locally (deleted_at set) whose google_place_id still
 * maps to a LIVE prod venue, soft-delete it on prod exactly as the local cleanup does:
 * venues.deleted_at + deactivate its happy_hours. Matched by google_place_id (the cross-DB
 * dedup key — local/prod ids can differ for the same place); idempotent (a venue already
 * deleted on prod is skipped via `deleted_at IS NULL`); reversible (soft-delete, never a hard
 * DELETE). Returns the per-table changed counts. User data is untouched — only venues YOU
 * deleted locally are affected, and only their own happy_hours are deactivated.
 */
export async function pushDeletions(
  local: Sql,
  prod: Sql,
  opts: { dryRun?: boolean } = {},
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const deletedLocal = await local<{ google_place_id: string }[]>`
    SELECT google_place_id FROM venues
    WHERE deleted_at IS NOT NULL AND google_place_id IS NOT NULL`;
  const placeIds = deletedLocal.map((v) => v.google_place_id);

  await prod.begin(async (tx) => {
    let venuesChanged = 0;
    let hhChanged = 0;
    if (placeIds.length > 0) {
      const venueRows = await tx<{ id: string }[]>`
        UPDATE venues SET deleted_at = now(), updated_at = now()
        WHERE google_place_id = ANY(${placeIds}) AND deleted_at IS NULL
        RETURNING id`;
      venuesChanged = venueRows.length;
      const venueIds = venueRows.map((r) => r.id);
      if (venueIds.length > 0) {
        const hhRows = await tx`
          UPDATE happy_hours SET active = false, updated_at = now()
          WHERE venue_id = ANY(${venueIds}) AND active = true AND deleted_at IS NULL
          RETURNING id`;
        hhChanged = hhRows.length;
      }
    }
    results.push({ table: "venues", changed: venuesChanged });
    results.push({ table: "happy_hours", changed: hhChanged });
    if (opts.dryRun) throw new RollbackSignal();
  }).catch(swallowRollback);

  return results;
}

/**
 * Per-venue `max(updated_at)` across the curation subtree (venue + happy_hours +
 * offerings + exceptions). The change-detection signal for publishChanged: a venue whose
 * subtree is newer locally than on prod has local edits worth pushing. `updated_at` is
 * bumped by every write path (apply engine, admin actions, soft-deletes), so an offering
 * hidden on a live venue moves the venue's timestamp even though venues.updated_at itself
 * didn't change.
 */
async function subtreeTimestamps(sql: Sql): Promise<Map<string, number>> {
  const rows = await sql<{ id: string; ts: string | Date }[]>`
    SELECT id, max(ts) AS ts FROM (
      SELECT id, updated_at AS ts FROM venues
      UNION ALL
      SELECT venue_id, updated_at FROM happy_hours
      UNION ALL
      SELECT hh.venue_id, o.updated_at
        FROM offerings o JOIN happy_hours hh ON hh.id = o.happy_hour_id
      UNION ALL
      SELECT hh.venue_id, e.updated_at
        FROM happy_hour_exceptions e JOIN happy_hours hh ON hh.id = e.happy_hour_id
    ) x GROUP BY id`;
  return new Map(rows.map((r) => [r.id, new Date(r.ts).getTime()]));
}

/**
 * local → prod, UPDATE existing venues whose local curation changed. The update
 * counterpart to additivePush (new venues) and pushDeletions (removed venues): for every
 * venue that ALREADY exists on prod and whose local subtree is newer (by max updated_at),
 * re-publish it via publishVenue — a PK upsert of the whole subtree, soft-deletes and all,
 * so a window's edited source_url or a hidden offering both land. Venues where PROD is
 * newer (a user edited them there) are SKIPPED, so user-applied changes are never
 * clobbered. Curation tables only; user tables (edit_submissions, flags, audit_log) are
 * never touched. Each venue publishes in its own transaction (dryRun rolls each back).
 * Returns the per-venue results so the CLI can list exactly what moved.
 */
export async function publishChanged(
  local: Sql,
  prod: Sql,
  opts: { dryRun?: boolean; sinceHours?: number; cutoffMs?: number; full?: boolean } = {},
): Promise<{ venueId: string; results: SyncResult[] }[]> {
  // Normally bounded to a recent curation window for speed: re-diffing all ~4k venues on
  // every routine push is wasteful. cutoffMs (the CLI's persisted last-push watermark) takes
  // precedence; sinceHours is the fallback for a first run with no watermark yet.
  //
  // BUT that window is a performance filter layered ON TOP of the real correctness check
  // (`ts > prodTs`, below), and it silently STRANDS genuine drift whose timestamp is older
  // than the watermark. This is how curation goes missing on prod: anything edited before the
  // first `--apply` (which set the watermark to "now") is older than every later watermark, so
  // it's never "new" (additivePush's job) and never "recent enough" here — permanently invisible.
  // `full` drops the window (cutoff = 0) so EVERY venue where local genuinely differs from prod
  // is reconciled regardless of age. Slower, and the first run flushes the whole stranded
  // backlog — that's the point; afterwards the fast watermark path keeps up. The `ts > prodTs`
  // guard still holds, so a more-recent prod-side user edit is never clobbered.
  const cutoff = opts.full ? 0 : opts.cutoffMs ?? Date.now() - (opts.sinceHours ?? 24) * 3600_000;

  const [localTs, prodTs] = await Promise.all([subtreeTimestamps(local), subtreeTimestamps(prod)]);

  const staleVenueIds: string[] = [];
  for (const [id, ts] of localTs) {
    if (ts < cutoff) continue; // not touched in the window — leave it
    const prodTsForId = prodTs.get(id);
    // Publish only when prod HAS the venue (new venues are additivePush's job) and local is
    // strictly newer — so a venue a user edited more recently on prod is never clobbered.
    if (prodTsForId !== undefined && ts > prodTsForId) staleVenueIds.push(id);
  }

  const out: { venueId: string; results: SyncResult[] }[] = [];
  for (const venueId of staleVenueIds) {
    out.push({ venueId, results: await publishVenue(local, prod, { venueId, dryRun: opts.dryRun }) });
  }
  return out;
}

// dryRun is implemented by throwing inside the transaction so postgres.js rolls back.
class RollbackSignal extends Error {}
function swallowRollback(err: unknown) {
  if (err instanceof RollbackSignal) return;
  throw err;
}
