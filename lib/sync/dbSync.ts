/**
 * Safe, non-destructive data sync between the local dev DB and prod.
 *
 * Two directions, both additive — neither ever TRUNCATEs or DELETEs, so user data
 * on prod and unpushed staging on local both survive:
 *
 *  - additivePush (local → prod): inserts only NEW venues (by id / google_place_id)
 *    and their full subtree, plus any missing cities/neighbourhoods/chains/tags/
 *    candidates. Existing prod venues are never modified — editing a live venue is a
 *    prod-side operation (see docs/data-sync-runbook.md). This is how you promote a
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

type Conflict = "do-nothing" | { pk: string[]; update: string[] };

/** Build the multi-row INSERT and run it; returns the number of rows actually written. */
async function insertRows(
  target: Queryable,
  table: string,
  cols: string[],
  rows: Record<string, unknown>[],
  conflict: Conflict,
): Promise<number> {
  if (rows.length === 0) return 0;
  // postgres.js: target(rows, ...cols) → ("c1","c2") values (…),(…) with params.
  if (conflict === "do-nothing") {
    const res = await target`
      INSERT INTO ${target(table)} ${target(rows, ...cols)}
      ON CONFLICT DO NOTHING
      RETURNING 1`;
    return res.count;
  }
  // Upsert: conflict on PK, update every non-PK column from the incoming row.
  const setFrags = conflict.update.map((c) => target`${target(c)} = excluded.${target(c)}`);
  let set = setFrags[0];
  for (let i = 1; i < setFrags.length; i++) set = target`${set}, ${setFrags[i]}`;
  const res = await target`
    INSERT INTO ${target(table)} ${target(rows, ...cols)}
    ON CONFLICT (${target(conflict.pk)}) DO UPDATE SET ${set}
    RETURNING 1`;
  return res.count;
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

// dryRun is implemented by throwing inside the transaction so postgres.js rolls back.
class RollbackSignal extends Error {}
function swallowRollback(err: unknown) {
  if (err instanceof RollbackSignal) return;
  throw err;
}
