/**
 * Integration test for stage-0 name-primary assignment in assignNeighborhoods. A venue's
 * Google neighborhood NAME wins over any spatial polygon; venues without a name fall back
 * to the spatial stages. Builds fixtures in a transaction and rolls back — leaves the DB
 * unchanged. Requires a live PostGIS DB (DATABASE_URL).
 * Run: npx tsx scripts/test-name-primary-assignment.ts — exits non-zero on any failure.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  let passed = 0;
  try {
    await sql.begin(async (tx) => {
      // Throwaway city. Required NOT-NULL cols (verified against the live schema):
      // slug, name, state, country, default_timezone, currency_code.
      const [city] = await tx<{ id: string }[]>`
        INSERT INTO cities (name, slug, state, country, default_timezone, currency_code)
        VALUES ('TestVille', 'testville-name-primary', 'AZ', 'US', 'America/Phoenix', 'USD')
        RETURNING id`;

      // Helper to insert a square polygon covering [lng0..lng1] x [lat0..lat1].
      const square = (lng0: number, lat0: number, lng1: number, lat1: number) =>
        `{"type":"Polygon","coordinates":[[[${lng0},${lat0}],[${lng1},${lat0}],[${lng1},${lat1}],[${lng0},${lat1}],[${lng0},${lat0}]]]}`;

      // COARSE polygon district "North" covering [-111..-110] x [32..33].
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'North', 'north',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-111, 32, -110, 33)}), 4326)),
          'coarse', 1, false)`;

      // Venue A: has a Google neighborhood NAME, coords INSIDE "North". Expect → 'Temescal'.
      const [vA] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue A', 'venue-a', 32.5, -110.5, 'Temescal') RETURNING id`;
      // Venue B: NO Google name, coords INSIDE "North". Expect → 'North' (spatial fallback).
      const [vB] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng)
        VALUES (${city.id}, 'Venue B', 'venue-b', 32.5, -110.5) RETURNING id`;
      // Venue C: second 'Temescal' venue — the name needs MIN_VENUES_PER_NEIGHBORHOOD
      // venues (critical mass) before stage 0 honors it over the containing polygon.
      await tx`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue C', 'venue-c', 32.5, -110.5, 'Temescal')`;

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      // Full neighborhood row a venue maps to.
      const nb = async (vid: string) => {
        const [r] = await tx<
          {
            name: string | null;
            tier: string | null;
            source: string | null;
            polygon_null: boolean | null;
          }[]
        >`
          SELECT n.name, n.tier, n.source, (n.polygon IS NULL) AS polygon_null
          FROM venues v LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
          WHERE v.id = ${vid}`;
        return r;
      };

      const a = await nb(vA.id);
      assert.equal(a.name, "Temescal", "named venue maps to its Google neighborhood name");
      assert.equal(a.tier, "fine", "name-primary neighborhood is tier='fine'");
      assert.equal(a.polygon_null, true, "name-primary neighborhood has NULL polygon");
      assert.equal(a.source, "Google Places", "name-primary neighborhood source='Google Places'");
      passed++;
      console.log("  ✓ Google name wins over containing polygon (fine/NULL polygon/Google Places)");

      const b = await nb(vB.id);
      assert.equal(b.name, "North", "venue without a Google name falls back to the spatial polygon");
      passed++;
      console.log("  ✓ venue without a Google name → spatial polygon");

      // Idempotency: re-run must NOT create a second 'Temescal' row, and A still maps to it.
      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      const [{ cnt }] = await tx<{ cnt: number }[]>`
        SELECT count(*)::int AS cnt FROM neighborhoods
        WHERE city_id = ${city.id} AND name = 'Temescal'`;
      assert.equal(cnt, 1, "exactly one 'Temescal' neighborhood row exists after re-run");
      assert.equal((await nb(vA.id)).name, "Temescal", "named venue still maps to its name after re-run");
      passed++;
      console.log("  ✓ idempotent: no duplicate name row, mapping stable");

      // Roll back: throw a sentinel so sql.begin aborts the txn.
      throw new Error("ROLLBACK_SENTINEL");
    });
  } catch (err) {
    if ((err as Error).message !== "ROLLBACK_SENTINEL") throw err;
  } finally {
    await sql.end();
  }
  console.log(`\n${passed} checks passed (fixtures rolled back).`);
  if (passed !== 3) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
