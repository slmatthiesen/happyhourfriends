/**
 * Integration test for assignNeighborhoods ranking. Builds fixtures in a transaction and
 * rolls back — leaves the DB unchanged. Requires a live PostGIS DB (DATABASE_URL).
 * Run: npx tsx scripts/test-neighborhood-assignment.ts — exits non-zero on any failure.
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
      // Throwaway city. Required NOT-NULL cols (verified in db/schema/core.ts):
      // slug, name, country, default_timezone, currency_code.
      const [city] = await tx<{ id: string }[]>`
        INSERT INTO cities (name, slug, country, default_timezone, currency_code)
        VALUES ('TestVille', 'testville-assign', 'US', 'America/Phoenix', 'USD')
        RETURNING id`;

      // Helper to insert a square polygon covering [lng0..lng1] x [lat0..lat1].
      const square = (lng0: number, lat0: number, lng1: number, lat1: number) =>
        `{"type":"Polygon","coordinates":[[[${lng0},${lat0}],[${lng1},${lat0}],[${lng1},${lat1}],[${lng0},${lat1}],[${lng0},${lat0}]]]}`;

      // Big COARSE district covering everything (recognizability 1).
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Big District', 'big-district',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-111, 32, -110, 33)}), 4326)),
          'coarse', 1, false)`;
      // Small RECOGNIZABLE FINE neighborhood in the NW corner (recognizability 2).
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Famous Hood', 'famous-hood',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-111, 32.8, -110.9, 32.9)}), 4326)),
          'fine', 2, false)`;
      // Small OBSCURE FINE neighborhood in the SE corner (recognizability 0, NOT a fallback).
      // Under the OLD "is_fallback then smallest area" ranking this would WIN over Big District
      // (non-fallback + smaller area). The new logic must shadow it and prefer Big District.
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Obscure NA', 'obscure-na',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-110.2, 32.1, -110.1, 32.2)}), 4326)),
          'fine', 0, false)`;

      // Venue A inside Famous Hood (and Big District). Expect → Famous Hood.
      const [vA] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng)
        VALUES (${city.id}, 'Venue A', 'venue-a', 32.85, -110.95) RETURNING id`;
      // Venue B inside Obscure NA (and Big District). Expect → Big District (obscure shadowed).
      const [vB] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng)
        VALUES (${city.id}, 'Venue B', 'venue-b', 32.15, -110.15) RETURNING id`;

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      const got = async (vid: string) => {
        const [r] = await tx<{ name: string | null }[]>`
          SELECT n.name FROM venues v LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
          WHERE v.id = ${vid}`;
        return r.name;
      };

      assert.equal(await got(vA.id), "Famous Hood",
        "recognizable fine neighborhood wins when it contains the venue");
      passed++;
      console.log("  ✓ recognizable fine wins over coarse");

      assert.equal(await got(vB.id), "Big District",
        "obscure fine is shadowed; venue rolls up to the coarse district");
      passed++;
      console.log("  ✓ obscure fine is shadowed → coarse rollup");

      // Venue C: inside Big District (coarse, contains it) but only ~47m from Famous Hood
      // (within the 100m snap, NOT inside it). Containing coarse must beat merely-near fine.
      // Verified: ST_Distance(Famous Hood, lng=-110.8995 lat=32.85) ≈ 46.8m (0 < d < 100).
      const [vC] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng)
        VALUES (${city.id}, 'Venue C', 'venue-c', 32.85, -110.8995) RETURNING id`;

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      assert.equal(await got(vC.id), "Big District",
        "containing coarse district beats a recognizable fine the venue is only near");
      passed++;
      console.log("  ✓ containing coarse beats merely-near fine");

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
