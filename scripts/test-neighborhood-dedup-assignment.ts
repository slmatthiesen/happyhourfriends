/**
 * Integration test for canonical-name dedup in assignNeighborhoods stage 0:
 *   - spelling variants of one Google name ("Saint Phillips" / "Saint Philip's") land on
 *     ONE neighborhood row, and the orphaned variant row is tidied away;
 *   - a "X Village" Google name whose venues sit INSIDE coarse district X merges into X
 *     (no own row);
 *   - a name-only synonym whose venues are OUTSIDE the matching district ("Catalina
 *     Village" vs the far-away town of Catalina) keeps its own row.
 * Builds fixtures in a transaction and rolls back — leaves the DB unchanged.
 * Requires a live PostGIS DB (DATABASE_URL).
 * Run: tsx scripts/test-neighborhood-dedup-assignment.ts — exits non-zero on any failure.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import postgres from "postgres";
import { assignNeighborhoods } from "@/lib/geo/assignNeighborhoods";

const EXPECTED = 7;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  let passed = 0;
  try {
    await sql.begin(async (tx) => {
      const [city] = await tx<{ id: string }[]>`
        INSERT INTO cities (name, slug, state, country, default_timezone, currency_code)
        VALUES ('TestVille', 'testville-dedup', 'AZ', 'US', 'America/Phoenix', 'USD')
        RETURNING id`;

      const square = (lng0: number, lat0: number, lng1: number, lat1: number) =>
        `{"type":"Polygon","coordinates":[[[${lng0},${lat0}],[${lng1},${lat0}],[${lng1},${lat1}],[${lng0},${lat1}],[${lng0},${lat0}]]]}`;

      // Coarse district "Camelback East" — the Village-synonym target.
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Camelback East', 'camelback-east',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-111.0, 33.0, -110.9, 33.1)}), 4326)),
          'coarse', 1, false)`;
      // Coarse district "Catalina" — far from the "Catalina Village" venues below.
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Catalina', 'catalina',
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${square(-110.2, 32.0, -110.1, 32.1)}), 4326)),
          'coarse', 1, false)`;
      // Pre-existing variant rows from earlier runs (both polygon-less Google rows).
      await tx`INSERT INTO neighborhoods (city_id, name, slug, polygon, source, tier, recognizability, is_fallback)
        VALUES (${city.id}, 'Saint Philip''s Plaza', 'saint-philip-s-plaza', NULL, 'Google Places', 'fine', 1, false),
               (${city.id}, 'Saint Phillips Plaza', 'saint-phillips-plaza', NULL, 'Google Places', 'fine', 1, false)`;

      const venue = (slug: string, lat: number, lng: number, g: string | null) =>
        tx<{ id: string }[]>`
          INSERT INTO venues (city_id, name, slug, lat, lng, google_neighborhood)
          VALUES (${city.id}, ${slug}, ${slug}, ${lat}, ${lng}, ${g}) RETURNING id`;

      // Spelling variants, far from any polygon: 2× "Phillips", 1× "Philip's".
      const [p1] = await venue("phil-1", 32.5, -110.5, "Saint Phillips Plaza");
      const [p2] = await venue("phil-2", 32.5, -110.5, "Saint Phillips Plaza");
      const [p3] = await venue("phil-3", 32.5, -110.5, "Saint Philip's Plaza");
      // "Camelback East Village" venues INSIDE the Camelback East polygon.
      const [c1] = await venue("ce-1", 33.05, -110.95, "Camelback East Village");
      const [c2] = await venue("ce-2", 33.05, -110.95, "Camelback East Village");
      // "Catalina Village" venues far OUTSIDE the Catalina polygon.
      const [k1] = await venue("cv-1", 32.5, -110.6, "Catalina Village");
      const [k2] = await venue("cv-2", 32.5, -110.6, "Catalina Village");
      // EXACT coarse-name venues far OUTSIDE the polygon ("Catalina" 40km away).
      const [x1] = await venue("cx-1", 32.9, -110.9, "Catalina");
      const [x2] = await venue("cx-2", 32.9, -110.9, "Catalina");

      await assignNeighborhoods(tx as unknown as typeof sql, city.id);

      const nb = async (vid: string) => {
        const [r] = await tx<{ name: string | null; tier: string | null }[]>`
          SELECT n.name, n.tier FROM venues v
          LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
          WHERE v.id = ${vid}`;
        return r;
      };

      // 1. All three variant venues share ONE row, named by the dominant variant.
      const names = await Promise.all([p1, p2, p3].map((v) => nb(v.id)));
      assert.ok(
        names.every((n) => n.name === "Saint Phillips Plaza"),
        `all variant venues map to 'Saint Phillips Plaza', got ${JSON.stringify(names)}`,
      );
      passed++;
      console.log("  ✓ spelling variants assign to one canonical row");

      // 2. The orphaned variant row is gone — exactly one Philip-ish row remains.
      const [{ cnt: philipRows }] = await tx<{ cnt: number }[]>`
        SELECT count(*)::int AS cnt FROM neighborhoods
        WHERE city_id = ${city.id} AND name ILIKE 'Saint Phil%'`;
      assert.equal(philipRows, 1, "exactly one Saint Phil* neighborhood row survives");
      passed++;
      console.log("  ✓ orphaned spelling-variant row tidied away");

      // 3. Village synonym with containment merges into the coarse district.
      assert.equal((await nb(c1.id)).name, "Camelback East");
      assert.equal((await nb(c2.id)).name, "Camelback East");
      passed++;
      console.log("  ✓ 'X Village' venues inside coarse X merge into X");

      const [{ cnt: villageRows }] = await tx<{ cnt: number }[]>`
        SELECT count(*)::int AS cnt FROM neighborhoods
        WHERE city_id = ${city.id} AND name = 'Camelback East Village'`;
      assert.equal(villageRows, 0, "no 'Camelback East Village' row is created");
      passed++;
      console.log("  ✓ no synonym row created");

      // 4. Name-only synonym failing containment keeps its own row.
      assert.equal((await nb(k1.id)).name, "Catalina Village");
      assert.equal((await nb(k2.id)).name, "Catalina Village");
      passed++;
      console.log("  ✓ synonym failing containment keeps its own row (Catalina Village)");

      // 5. An EXACT coarse-name match always falls through to polygon assignment —
      // never assigned by name onto the district row, even when containment fails.
      const x = await Promise.all([x1, x2].map((v) => nb(v.id)));
      assert.ok(
        x.every((n) => n.name !== "Catalina"),
        `exact-name venues outside the polygon must not inherit the district by name, got ${JSON.stringify(x)}`,
      );
      passed++;
      console.log("  ✓ exact coarse-name match falls through to polygons (no name-grab)");

      // 6. Idempotent re-run: same rows, same mapping, still exactly one Philip row.
      await assignNeighborhoods(tx as unknown as typeof sql, city.id);
      const [{ cnt: philipRows2 }] = await tx<{ cnt: number }[]>`
        SELECT count(*)::int AS cnt FROM neighborhoods
        WHERE city_id = ${city.id} AND name ILIKE 'Saint Phil%'`;
      assert.equal(philipRows2, 1);
      assert.equal((await nb(p3.id)).name, "Saint Phillips Plaza");
      assert.equal((await nb(c1.id)).name, "Camelback East");
      passed++;
      console.log("  ✓ idempotent re-run");

      throw new Error("ROLLBACK_SENTINEL");
    });
  } catch (err) {
    if ((err as Error).message !== "ROLLBACK_SENTINEL") throw err;
  } finally {
    await sql.end();
  }
  console.log(`\n${passed}/${EXPECTED} checks passed (fixtures rolled back).`);
  if (passed !== EXPECTED) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
