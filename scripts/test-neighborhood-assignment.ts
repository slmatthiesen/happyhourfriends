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
      // Throwaway city. Required NOT-NULL cols (verified against the live schema):
      // slug, name, state, country, default_timezone, currency_code.
      const [city] = await tx<{ id: string }[]>`
        INSERT INTO cities (name, slug, state, country, default_timezone, currency_code)
        VALUES ('TestVille', 'testville-assign', 'AZ', 'US', 'America/Phoenix', 'USD')
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

      // Venue D: lone google_neighborhood name ("Micro Spot", below the 2-venue critical
      // mass), located inside Famous Hood. The micro-name must NOT win (it would render
      // blank in the UI) — the venue falls through to polygon assignment.
      const [vD] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue D', 'venue-d', 32.85, -110.95, 'Micro Spot') RETURNING id`;
      // Venues E + F share a google_neighborhood ("Cool Name", meets critical mass) inside
      // Big District. Name-primary must still win for both.
      const [vE] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue E', 'venue-e', 32.5, -110.5, 'Cool Name') RETURNING id`;
      const [vF] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue F', 'venue-f', 32.51, -110.51, 'Cool Name') RETURNING id`;

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      assert.equal(await got(vD.id), "Famous Hood",
        "sub-critical-mass google name falls through to polygon assignment");
      passed++;
      console.log("  ✓ lone google name falls through to polygon");

      assert.equal(await got(vE.id), "Cool Name",
        "google name with critical mass stays name-primary");
      assert.equal(await got(vF.id), "Cool Name",
        "google name with critical mass stays name-primary");
      passed++;
      console.log("  ✓ critical-mass google name stays name-primary");

      const [micro] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM neighborhoods
        WHERE city_id = ${city.id} AND slug = 'micro-spot'`;
      assert.equal(micro.n, 0,
        "no neighborhood row is created for a sub-critical-mass google name");
      passed++;
      console.log("  ✓ no orphan row for sub-critical-mass name");

      // Venues G + H: critical-mass google name "Obscure NA" colliding with the EXISTING
      // imported fine row (recognizability 0, source != 'Google Places'). The name must
      // win onto that row — not be dropped because of its source, and not spawn a
      // duplicate polygon-less Google row. (Regression: Tucson's West University / Sam
      // Hughes / Downtown were stuck on cardinal districts.)
      const [vG] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue G', 'venue-g', 32.5, -110.6, 'Obscure NA') RETURNING id`;
      const [vH] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue H', 'venue-h', 32.52, -110.62, 'Obscure NA') RETURNING id`;

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      assert.equal(await got(vG.id), "Obscure NA",
        "critical-mass google name wins onto an existing imported row");
      assert.equal(await got(vH.id), "Obscure NA",
        "critical-mass google name wins onto an existing imported row");
      passed++;
      console.log("  ✓ critical-mass google name wins onto existing imported row");

      const [obscureRows] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM neighborhoods
        WHERE city_id = ${city.id} AND slug = 'obscure-na'`;
      assert.equal(obscureRows.n, 1,
        "no duplicate row is created when the name collides with an imported row");
      passed++;
      console.log("  ✓ no duplicate row for a colliding name");

      // Venues I + J: critical-mass google name "Big District" colliding with the COARSE
      // district row, both located inside Famous Hood. A name that equals a coarse
      // district adds no specificity — the containing fine polygon must win instead
      // (regression: McCormick Ranch venues carry google_neighborhood='South Scottsdale').
      const [vI] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue I', 'venue-i', 32.85, -110.95, 'Big District') RETURNING id`;
      const [vJ] = await tx<{ id: string }[]>`
        INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
        VALUES (${city.id}, 'Venue J', 'venue-j', 32.86, -110.96, 'Big District') RETURNING id`;

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      assert.equal(await got(vI.id), "Famous Hood",
        "name colliding with a coarse district falls through to polygon assignment");
      assert.equal(await got(vJ.id), "Famous Hood",
        "name colliding with a coarse district falls through to polygon assignment");
      passed++;
      console.log("  ✓ coarse-collision name falls through to polygon");

      // Roll back: throw a sentinel so sql.begin aborts the txn.
      throw new Error("ROLLBACK_SENTINEL");
    });
  } catch (err) {
    if ((err as Error).message !== "ROLLBACK_SENTINEL") throw err;
  } finally {
    await sql.end();
  }
  console.log(`\n${passed} checks passed (fixtures rolled back).`);
  if (passed !== 9) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
