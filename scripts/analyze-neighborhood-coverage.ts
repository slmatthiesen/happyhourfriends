/**
 * Neighborhood coverage gate (PRD §3 + operator bar: ≥95% per city is a launch requirement).
 *
 *   npm run analyze:neighborhood-coverage              # all cities, summary (run periodically!)
 *   npm run analyze:neighborhood-coverage -- --city tucson --state wa --list   # + blank venues w/ coords
 *
 * Prints each city's venue→neighborhood assignment rate and PASS/FAIL against the 95%
 * gate. With --list, dumps the unassigned venues (name + lat/lng + nearest neighborhood +
 * distance) — the worklist for adding polygons / AI backfill. Exit code 1 if any analyzed
 * city is below the gate, so this can guard a launch script.
 *
 * The `poly` column is the number of polygon-backed neighborhoods. poly=0 on a FAILing city
 * means the cardinal-district step was SKIPPED at onboarding: the city is coasting on Google
 * vernacular names alone and the snap-assignment stages never fired. The fix is a one-command
 * `generate:cardinal-districts` (see the FIX hint printed inline). Run this with no --city
 * periodically to catch any city that slipped past the runbook.
 */
import "dotenv/config";
import postgres from "postgres";
import { RECOGNIZABLE_BAR } from "@/lib/geo/recognizability";
import { MIN_VENUES_PER_NEIGHBORHOOD } from "@/lib/geo/assignNeighborhoods";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

const GATE = 0.95;

async function main() {
  const argv = process.argv.slice(2);
  const hasCityFlag = argv.includes("--city");
  const list = argv.includes("--list");

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });

  // --city is optional; when provided, --state is also required.
  let citySlug: string | undefined;

  try {
    if (hasCityFlag) {
      const { slug, state } = requireCityArgs();
      const city = await resolveCity(sql, slug, state);
      citySlug = city.slug;
    }

    const rows = await sql<
      {
        slug: string;
        venues: number;
        assigned: number;
        rate: number;
        on_fine: number;
        recognizable_rate: number;
        ui_hidden: number;
        poly: number;
      }[]
    >`
      WITH nb_counts AS (
        SELECT neighborhood_id, count(*) AS cnt
        FROM venues
        WHERE deleted_at IS NULL AND neighborhood_id IS NOT NULL
        GROUP BY neighborhood_id
      )
      SELECT c.slug,
             count(v.id)::int AS venues,
             count(v.neighborhood_id)::int AS assigned,
             COALESCE(count(v.neighborhood_id)::float / NULLIF(count(v.id), 0), 0) AS rate,
             count(v.id) FILTER (WHERE n.tier = 'fine' AND n.recognizability >= ${RECOGNIZABLE_BAR})::int AS on_fine,
             COALESCE(
               count(v.id) FILTER (WHERE n.tier = 'fine' AND n.recognizability >= ${RECOGNIZABLE_BAR})::float
               / NULLIF(count(v.neighborhood_id), 0), 0) AS recognizable_rate,
             -- Assigned in the DB but rendered blank in the UI: the venue's neighborhood is
             -- below the MIN_VENUES_PER_NEIGHBORHOOD suppression bar (lib/queries/venues.ts).
             count(v.id) FILTER (WHERE nc.cnt < ${MIN_VENUES_PER_NEIGHBORHOOD})::int AS ui_hidden,
             (SELECT count(*) FROM neighborhoods nn
                WHERE nn.city_id = c.id AND nn.polygon IS NOT NULL)::int AS poly
      FROM cities c
      LEFT JOIN venues v ON v.city_id = c.id AND v.deleted_at IS NULL
      LEFT JOIN neighborhoods n ON n.id = v.neighborhood_id
      LEFT JOIN nb_counts nc ON nc.neighborhood_id = v.neighborhood_id
      ${citySlug ? sql`WHERE c.slug = ${citySlug}` : sql``}
      GROUP BY c.slug, c.id
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
          `  — ${recPct.padStart(3)}% recognizable (${r.on_fine}/${r.assigned})` +
          `  — ${r.poly} polygons` +
          (r.ui_hidden > 0 ? `  — ${r.ui_hidden} UI-hidden (lone-venue neighborhood)` : ""),
      );
      // poly=0 on a failing city is the unmistakable "cardinal step skipped" signature.
      if (!pass && r.poly === 0) {
        console.log(
          `        ↳ FIX: no polygon layer — run  pnpm generate:cardinal-districts -- ` +
            `--city ${r.slug} --state <code> --downtown <cbd-lat,lng>`,
        );
      }
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
