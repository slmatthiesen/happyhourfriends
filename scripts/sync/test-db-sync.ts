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
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import postgres from "postgres";
import { additivePush, upsertPull } from "@/lib/sync/dbSync";

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
  nbStaged: "00000000-0000-0000-0000-0000000000a2", // local-only, has polygon (push round-trip)
  nbProdOnly: "00000000-0000-0000-0000-0000000000a3", // prod-only, has polygon (pull round-trip)
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

    console.log("✅ db-sync integration test passed (push additive + no-clobber, pull upsert + staged-safe).");
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
