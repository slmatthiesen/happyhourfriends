/**
 * Neighborhood coverage gate (PRD §3 + operator bar: ≥95% per city is a launch requirement).
 *
 *   npm run analyze:neighborhood-coverage              # all cities, summary
 *   npm run analyze:neighborhood-coverage -- --city tucson --list   # + blank venues w/ coords
 *
 * Prints each city's venue→neighborhood assignment rate and PASS/FAIL against the 95%
 * gate. With --list, dumps the unassigned venues (name + lat/lng + nearest neighborhood +
 * distance) — the worklist for adding polygons / AI backfill. Exit code 1 if any analyzed
 * city is below the gate, so this can guard a launch script.
 */
import "dotenv/config";
import postgres from "postgres";

const GATE = 0.95;

async function main() {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const citySlug = get("--city");
  const list = argv.includes("--list");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });

  try {
    const rows = await sql<
      {
        slug: string;
        venues: number;
        assigned: number;
        rate: number;
        on_fine: number;
        recognizable_rate: number;
      }[]
    >`
      SELECT c.slug,
             count(v.id)::int AS venues,
             count(v.neighborhood_id)::int AS assigned,
             COALESCE(count(v.neighborhood_id)::float / NULLIF(count(v.id), 0), 0) AS rate,
             count(v.id) FILTER (WHERE n.tier = 'fine' AND n.recognizability >= 1)::int AS on_fine,
             COALESCE(
               count(v.id) FILTER (WHERE n.tier = 'fine' AND n.recognizability >= 1)::float
               / NULLIF(count(v.neighborhood_id), 0), 0) AS recognizable_rate
      FROM cities c
      LEFT JOIN venues v ON v.city_id = c.id AND v.deleted_at IS NULL
      LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
      ${citySlug ? sql`WHERE c.slug = ${citySlug}` : sql``}
      GROUP BY c.slug
      HAVING count(v.id) > 0
      ORDER BY rate ASC
    `;

    let anyFail = false;
    console.log("\nNeighborhood coverage (gate = 95%):");
    console.log("─".repeat(54));
    for (const r of rows) {
      const pct = (r.rate * 100).toFixed(1);
      const pass = r.rate >= GATE;
      if (!pass) anyFail = true;
      const recPct = (r.recognizable_rate * 100).toFixed(0);
      console.log(
        `  ${pass ? "PASS" : "FAIL"}  ${r.slug.padEnd(18)} ` +
          `${pct.padStart(5)}%  (${r.assigned}/${r.venues}, ${r.venues - r.assigned} blank)` +
          `  — ${recPct.padStart(3)}% recognizable (${r.on_fine}/${r.assigned})`,
      );
    }
    console.log("─".repeat(54));

    if (list) {
      const blanks = await sql<
        { name: string; lat: string; lng: string; nearest: string | null; m: number | null }[]
      >`
        WITH c AS (SELECT id FROM cities WHERE slug = ${citySlug ?? null})
        SELECT v.name, v.lat::text, v.lng::text,
          (SELECT n.name FROM neighborhoods n
             WHERE n.city_id = v.city_id AND n.polygon IS NOT NULL
             ORDER BY ST_Distance(n.polygon::geography,
               ST_SetSRID(ST_MakePoint(v.lng::float8, v.lat::float8), 4326)::geography) ASC
             LIMIT 1) AS nearest,
          (SELECT round(MIN(ST_Distance(n.polygon::geography,
               ST_SetSRID(ST_MakePoint(v.lng::float8, v.lat::float8), 4326)::geography))::numeric, 0)::int
             FROM neighborhoods n WHERE n.city_id = v.city_id AND n.polygon IS NOT NULL) AS m
        FROM venues v
        WHERE v.deleted_at IS NULL AND v.neighborhood_id IS NULL
          AND v.lat IS NOT NULL AND v.lng IS NOT NULL
          ${citySlug ? sql`AND v.city_id = (SELECT id FROM c)` : sql``}
        ORDER BY m ASC NULLS LAST
      `;
      console.log(`\nUnassigned venues${citySlug ? ` in ${citySlug}` : ""} (${blanks.length}):`);
      for (const b of blanks) {
        console.log(
          `  ${b.name} — ${b.lat},${b.lng}  ` +
            `[nearest: ${b.nearest ?? "—"} ${b.m ?? "?"}m]`,
        );
      }
    }

    process.exit(anyFail ? 1 : 0);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
