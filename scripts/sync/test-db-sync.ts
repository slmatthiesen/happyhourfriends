/**
 * Integration test for lib/sync/dbSync.ts. Needs a live local Postgres (the docker
 * image, where `hhf` is a superuser) — NOT in the hermetic CI suite. Run:
 *
 *   npm run test:db-sync
 *
 * Spins up two scratch databases (a fake "local" and a fake "prod"), loads the real
 * schema into both via pg_dump --schema-only, seeds a divergent scenario, and asserts
 * the two safety guarantees:
 *   1. additivePush adds NEW venues + subtree to prod and NEVER clobbers a prod-side edit.
 *   2. upsertPull brings prod rows down WITHOUT deleting local-only staged work.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import postgres from "postgres";
import { additivePush, upsertPull, publishVenue, publishChanged, pullQueuedSubmissions, markSubmissionRejected, pushDeletions } from "@/lib/sync/dbSync";

const BASE = process.env.DATABASE_URL;
if (!BASE) throw new Error("DATABASE_URL must be set (local docker DB)");

const LOCAL_DB = "hhf_sync_local_test";
const PROD_DB = "hhf_sync_prod_test";
const adminUrl = BASE.replace(/\/[^/]+$/, "/postgres");
const localUrl = BASE.replace(/\/[^/]+$/, `/${LOCAL_DB}`);
const prodUrl = BASE.replace(/\/[^/]+$/, `/${PROD_DB}`);

function sh(cmd: string) {
  execSync(cmd, { stdio: ["ignore", "ignore", "inherit"], shell: "/bin/bash" });
}

async function recreate(admin: postgres.Sql, db: string) {
  await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${db} AND pid <> pg_backend_pid()`;
  await admin.unsafe(`DROP DATABASE IF EXISTS ${db}`);
  await admin.unsafe(`CREATE DATABASE ${db}`);
}

// Stable UUIDs for the scenario.
const U = {
  city: "00000000-0000-0000-0000-0000000000c1",
  nbCoarse: "00000000-0000-0000-0000-0000000000a0",
  nbFine: "00000000-0000-0000-0000-0000000000a1",
  tag: "00000000-0000-0000-0000-0000000000d1",
  vShared: "00000000-0000-0000-0000-000000000f01",
  vNew: "00000000-0000-0000-0000-000000000f02",
  vProdOnly: "00000000-0000-0000-0000-000000000f03",
  hhNew: "00000000-0000-0000-0000-0000000000e2",
  offNew: "00000000-0000-0000-0000-0000000000fa",
  vEdit: "00000000-0000-0000-0000-000000000f04",
  hhEdit: "00000000-0000-0000-0000-0000000000e9",
  nbStaged: "00000000-0000-0000-0000-0000000000a2", // local-only, has polygon (push round-trip)
  nbProdOnly: "00000000-0000-0000-0000-0000000000a3", // prod-only, has polygon (pull round-trip)
  subQueued: "00000000-0000-0000-0000-0000000000b1",
  vStranded: "00000000-0000-0000-0000-000000000f05", // on both; local drift older than watermark
  vProdNewer: "00000000-0000-0000-0000-000000000f06", // on both; prod edited more recently
};

const POLY = "MULTIPOLYGON(((-122.5 47.2,-122.4 47.2,-122.4 47.3,-122.5 47.3,-122.5 47.2)))";

async function seedCommon(sql: postgres.Sql) {
  await sql`INSERT INTO cities (id, slug, name, state, country, default_timezone, currency_code, status)
    VALUES (${U.city}, 'testville', 'Testville', 'wa', 'US', 'America/Los_Angeles', 'USD', 'live')`;
  // Coarse parent + fine child to exercise the neighbourhood topo-sort.
  await sql`INSERT INTO neighborhoods (id, city_id, name, slug, tier) VALUES (${U.nbCoarse}, ${U.city}, 'Central', 'central', 'coarse')`;
  await sql`INSERT INTO neighborhoods (id, city_id, name, slug, tier, parent_id) VALUES (${U.nbFine}, ${U.city}, 'Old Town', 'old-town', 'fine', ${U.nbCoarse})`;
  await sql`INSERT INTO tags (id, slug, label, category) VALUES (${U.tag}, 'patio', 'Patio', 'amenity')`;
  await sql`INSERT INTO venues (id, city_id, name, slug, google_place_id, neighborhood_id, status)
    VALUES (${U.vShared}, ${U.city}, 'Shared Bar', 'shared-bar', 'gp_shared', ${U.nbFine}, 'active')`;
}

async function main() {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await recreate(admin, LOCAL_DB);
    await recreate(admin, PROD_DB);
  } finally {
    await admin.end({ timeout: 5 });
  }

  // Load the real schema into both scratch DBs.
  sh(`pg_dump --schema-only --no-owner --no-acl "${BASE}" | psql -q "${localUrl}"`);
  sh(`pg_dump --schema-only --no-owner --no-acl "${BASE}" | psql -q "${prodUrl}"`);

  const local = postgres(localUrl, { max: 4, onnotice: () => {} });
  const prod = postgres(prodUrl, { max: 4, onnotice: () => {} });

  try {
    // Both sides start with the shared baseline.
    await seedCommon(local);
    await seedCommon(prod);

    // Prod-side state that a push must NOT clobber + a row a pull must bring down.
    await prod`UPDATE venues SET name = 'Shared Bar (edited by a user on prod)' WHERE id = ${U.vShared}`;
    await prod`INSERT INTO venues (id, city_id, name, slug, google_place_id, status)
      VALUES (${U.vProdOnly}, ${U.city}, 'User Added On Prod', 'user-added', 'gp_prodonly', 'active')`;
    // Prod-only neighbourhood WITH a polygon (exercises PostGIS round-trip on pull).
    await prod`INSERT INTO neighborhoods (id, city_id, name, slug, tier, polygon)
      VALUES (${U.nbProdOnly}, ${U.city}, 'Prod Quarter', 'prod-quarter', 'fine', ST_GeomFromText(${POLY}, 4326))`;

    // Local-only neighbourhood WITH a polygon (exercises PostGIS round-trip on push)
    // and the topo-sort against a parent that already exists on prod.
    await local`INSERT INTO neighborhoods (id, city_id, name, slug, tier, parent_id, polygon)
      VALUES (${U.nbStaged}, ${U.city}, 'Staged Quarter', 'staged-quarter', 'fine', ${U.nbCoarse}, ST_GeomFromText(${POLY}, 4326))`;
    // Local-side staged work: a brand-new venue + its HH + offering + tag link.
    await local`INSERT INTO venues (id, city_id, name, slug, google_place_id, neighborhood_id, status)
      VALUES (${U.vNew}, ${U.city}, 'Freshly Curated', 'freshly-curated', 'gp_new', ${U.nbStaged}, 'active')`;
    await local`INSERT INTO happy_hours (id, venue_id, days_of_week, start_time, end_time)
      VALUES (${U.hhNew}, ${U.vNew}, ARRAY[1,2,3]::smallint[], '16:00', '18:00')`;
    await local`INSERT INTO offerings (id, happy_hour_id, kind, category, name, price_cents)
      VALUES (${U.offNew}, ${U.hhNew}, 'drink', 'beer', '$5 drafts', 500)`;
    await local`INSERT INTO venue_tags (venue_id, tag_id) VALUES (${U.vNew}, ${U.tag})`;
    // Also stage an HH on the SHARED venue — a push must NOT carry an edit to an
    // existing prod venue.
    await local`INSERT INTO happy_hours (venue_id, days_of_week, start_time, end_time)
      VALUES (${U.vShared}, ARRAY[5]::smallint[], '15:00', '17:00')`;

    // Bulk-stage enough NEW venues that a single multi-row INSERT would exceed Postgres'
    // 65534-param cap (34 insertable cols × rows). This forces additivePush to chunk;
    // before chunking landed it threw MAX_PARAMETERS_EXCEEDED. 3700 rows ≈ 125k params.
    const BULK_VENUES = 3700;
    await local`INSERT INTO venues (id, city_id, name, slug, google_place_id, status)
      SELECT gen_random_uuid(), ${U.city}, 'Bulk ' || g, 'bulk-' || g, 'gp_bulk_' || g, 'active'
        FROM generate_series(1, ${BULK_VENUES}) g`;

    // ── 1. DRY-RUN push writes nothing ──────────────────────────────────────────
    const prodVenuesBefore = Number((await prod`SELECT count(*)::int n FROM venues`)[0].n);
    await additivePush(local, prod, { dryRun: true });
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM venues`)[0].n),
      prodVenuesBefore,
      "dry-run push must not change prod",
    );

    // ── 2. APPLY push: new venue + subtree land; prod edit + prod-only untouched ──
    await additivePush(local, prod, { dryRun: false });

    const newOnProd = await prod`SELECT name FROM venues WHERE id = ${U.vNew}`;
    assert.equal(newOnProd.length, 1, "new venue should be pushed to prod");
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM happy_hours WHERE venue_id = ${U.vNew}`)[0].n),
      1,
      "new venue's happy hour should be pushed",
    );
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM offerings WHERE happy_hour_id = ${U.hhNew}`)[0].n),
      1,
      "new venue's offering should be pushed",
    );
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM venue_tags WHERE venue_id = ${U.vNew}`)[0].n),
      1,
      "new venue's tag link should be pushed",
    );
    // The staged neighbourhood's polygon round-tripped intact through the push.
    assert.equal(
      (await prod`SELECT ST_AsText(polygon) t FROM neighborhoods WHERE id = ${U.nbStaged}`)[0].t,
      POLY,
      "neighbourhood polygon must survive the push round-trip",
    );
    // The prod-side edit survives — local's stale name did NOT overwrite it.
    assert.equal(
      (await prod`SELECT name FROM venues WHERE id = ${U.vShared}`)[0].name,
      "Shared Bar (edited by a user on prod)",
      "push must NOT clobber a prod-side edit to an existing venue",
    );
    // The HH staged on the SHARED (existing) venue was NOT pushed.
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM happy_hours WHERE venue_id = ${U.vShared}`)[0].n),
      0,
      "push must NOT carry an edit (new HH) onto an existing prod venue",
    );
    // Every bulk venue crossed the chunk boundary and landed — no MAX_PARAMETERS_EXCEEDED.
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM venues WHERE slug LIKE 'bulk-%'`)[0].n),
      BULK_VENUES,
      "push must chunk wide multi-row inserts past the 65534-param cap",
    );

    // ── 3. APPLY pull: prod rows come down; local staged work survives ────────────
    await upsertPull(prod, local, { dryRun: false });

    assert.equal(
      Number((await local`SELECT count(*)::int n FROM venues WHERE id = ${U.vProdOnly}`)[0].n),
      1,
      "pull should bring the prod-only venue into local",
    );
    assert.equal(
      (await local`SELECT name FROM venues WHERE id = ${U.vShared}`)[0].name,
      "Shared Bar (edited by a user on prod)",
      "pull should update local's shared venue to prod's value",
    );
    // The staged local-only venue is STILL there (pull never deletes local-only rows).
    assert.equal(
      Number((await local`SELECT count(*)::int n FROM venues WHERE id = ${U.vNew}`)[0].n),
      1,
      "pull must NOT delete local-only staged work",
    );
    // Prod-only neighbourhood's polygon round-tripped intact through the pull.
    assert.equal(
      (await local`SELECT ST_AsText(polygon) t FROM neighborhoods WHERE id = ${U.nbProdOnly}`)[0].t,
      POLY,
      "neighbourhood polygon must survive the pull round-trip",
    );

    // ── 3b. publishChanged --full flushes watermark-stranded drift (root-cause fix) ────
    // Two venues on BOTH sides. vStranded: local carries newer curation (a moved neighborhood)
    // than prod, but its timestamp predates a later push watermark — the exact way real
    // curation goes missing on prod. vProdNewer: prod was edited more recently and must never
    // be clobbered, even by a full reconcile. Assert on the SELECTED set (dry-run, no writes):
    // the fix is purely which venues publishChanged hands to publishVenue.
    await prod`INSERT INTO venues (id, city_id, name, slug, google_place_id, neighborhood_id, status, updated_at)
      VALUES (${U.vStranded}, ${U.city}, 'Stranded Bar', 'stranded-bar', 'gp_stranded', ${U.nbCoarse}, 'active', '2020-01-01T00:00:00Z')`;
    await local`INSERT INTO venues (id, city_id, name, slug, google_place_id, neighborhood_id, status, updated_at)
      VALUES (${U.vStranded}, ${U.city}, 'Stranded Bar', 'stranded-bar', 'gp_stranded', ${U.nbFine}, 'active', '2021-01-01T00:00:00Z')`;
    await prod`INSERT INTO venues (id, city_id, name, slug, google_place_id, neighborhood_id, status, updated_at)
      VALUES (${U.vProdNewer}, ${U.city}, 'Prod Newer Bar', 'prod-newer-bar', 'gp_prodnewer', ${U.nbFine}, 'active', '2021-01-01T00:00:00Z')`;
    await local`INSERT INTO venues (id, city_id, name, slug, google_place_id, neighborhood_id, status, updated_at)
      VALUES (${U.vProdNewer}, ${U.city}, 'Prod Newer Bar', 'prod-newer-bar', 'gp_prodnewer', ${U.nbCoarse}, 'active', '2020-01-01T00:00:00Z')`;

    // Bug repro: the watermark path (cutoff AFTER the local edit) STRANDS genuine drift.
    const windowed = await publishChanged(local, prod, { dryRun: true, cutoffMs: Date.UTC(2022, 0, 1) });
    assert.ok(
      !windowed.some((v) => v.venueId === U.vStranded),
      "watermark push reproduces the bug: drift older than the cutoff is skipped",
    );
    // Fix: --full ignores the watermark, so the stranded drift IS selected for publish…
    const reconciled = await publishChanged(local, prod, { dryRun: true, full: true });
    assert.ok(
      reconciled.some((v) => v.venueId === U.vStranded),
      "full reconcile must select watermark-stranded drift",
    );
    // …but a venue prod edited MORE recently is still never selected (prod-wins holds).
    assert.ok(
      !reconciled.some((v) => v.venueId === U.vProdNewer),
      "full reconcile must NOT select a venue that prod edited more recently",
    );
    // City scoping: the same drift is selected when scoped to its city, and NOT to another.
    const inCity = await publishChanged(local, prod, { dryRun: true, full: true, cityId: U.city });
    assert.ok(
      inCity.some((v) => v.venueId === U.vStranded),
      "full reconcile scoped to the venue's city must still select its drift",
    );
    const otherCity = await publishChanged(local, prod, {
      dryRun: true,
      full: true,
      cityId: "00000000-0000-0000-0000-0000000000ff",
    });
    assert.ok(
      !otherCity.some((v) => v.venueId === U.vStranded),
      "full reconcile scoped to a different city must exclude it",
    );

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

    // ── 5b. markSubmissionRejected: a local reject flips prod's row to 'rejected' ───
    // U.subQueued is still queued_admin on prod here. Dry-run must not touch it.
    await markSubmissionRejected(prod, U.subQueued, { dryRun: true });
    assert.equal(
      (await prod`SELECT status FROM edit_submissions WHERE id = ${U.subQueued}`)[0].status,
      "queued_admin",
      "dry-run reject must not change prod",
    );
    // APPLY: prod's row leaves queued_admin so it stops reappearing on pull:queue.
    const rej = await markSubmissionRejected(prod, U.subQueued, { dryRun: false });
    assert.equal(rej[0].changed, 1, "markSubmissionRejected must report the flipped row");
    assert.equal(
      (await prod`SELECT status FROM edit_submissions WHERE id = ${U.subQueued}`)[0].status,
      "rejected",
      "markSubmissionRejected must set prod status = 'rejected'",
    );
    // Guarded to queued_admin → a second call is a no-op (never clobbers an already-decided row).
    const rej2 = await markSubmissionRejected(prod, U.subQueued, { dryRun: false });
    assert.equal(rej2[0].changed, 0, "markSubmissionRejected must not re-touch an already-rejected row");

    // ── 6. pushDeletions: a venue soft-deleted LOCALLY is soft-deleted on prod ─────
    // Soft-delete vShared locally (matched to prod by google_place_id gp_shared). vNew is
    // also live on both and NOT deleted locally — it must be left alone.
    await local`UPDATE venues SET deleted_at = now() WHERE id = ${U.vShared}`;
    // DRY-RUN writes nothing.
    await pushDeletions(local, prod, { dryRun: true });
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM venues WHERE id = ${U.vShared} AND deleted_at IS NOT NULL`)[0].n),
      0,
      "dry-run delete must not change prod",
    );
    // APPLY: prod's matching venue is soft-deleted + its happy hours deactivated.
    await pushDeletions(local, prod, { dryRun: false });
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM venues WHERE id = ${U.vShared} AND deleted_at IS NOT NULL`)[0].n),
      1,
      "pushDeletions must soft-delete the prod venue matched by google_place_id",
    );
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM happy_hours WHERE venue_id = ${U.vShared} AND active = true`)[0].n),
      0,
      "pushDeletions must deactivate the deleted venue's happy hours",
    );
    assert.equal(
      Number((await prod`SELECT count(*)::int n FROM venues WHERE id = ${U.vNew} AND deleted_at IS NULL`)[0].n),
      1,
      "pushDeletions must NOT touch a venue that was not deleted locally",
    );
    // Idempotent: a second run changes nothing more (already-deleted prod rows are skipped).
    const second = await pushDeletions(local, prod, { dryRun: false });
    assert.equal(second.find((r) => r.table === "venues")?.changed, 0, "pushDeletions is idempotent");

    console.log("✅ db-sync integration test passed (push additive + no-clobber, pull upsert + staged-safe, delete-propagation).");
  } finally {
    await local.end({ timeout: 5 });
    await prod.end({ timeout: 5 });
    const admin2 = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      for (const db of [LOCAL_DB, PROD_DB]) {
        await admin2`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${db} AND pid <> pg_backend_pid()`;
        await admin2.unsafe(`DROP DATABASE IF EXISTS ${db}`);
      }
    } finally {
      await admin2.end({ timeout: 5 });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
