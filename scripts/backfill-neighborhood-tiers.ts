/**
 * One-time, idempotent backfill of neighborhoods.tier / recognizability for rows that
 * predate those columns, keyed on the existing `source` text. Also DEMOTES Tucson's
 * obscure Neighborhood-Association layer to is_fallback so recognizable names win in
 * assignment.
 *
 *   npm run backfill:neighborhood-tiers
 *
 * Does NOT re-run assignment — run the OSM import / cardinal generator (which call
 * assignNeighborhoods) afterwards, or assignment is exercised by a later task.
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  try {
    // OSM-presence is the recognizability signal, so a pre-existing OSM row clears the bar
    // at score 1. We deliberately do NOT set 2 here: score 2 means "has a wikidata/wikipedia
    // tag", which we can't know without the Overpass tags. Re-running `import:osm-neighbourhoods`
    // bumps the genuinely wiki-tagged rows to 2 via GREATEST(); this backfill just guarantees
    // every existing OSM row is recognizable.
    const osm = await sql`
      UPDATE neighborhoods SET tier='fine', recognizability=GREATEST(recognizability, 1)
      WHERE source LIKE 'OpenStreetMap%'
      RETURNING id`;
    const villages = await sql`
      UPDATE neighborhoods SET tier='coarse', recognizability=1, is_fallback=false
      WHERE source LIKE '%Urban Villages%' OR source LIKE '%Council Districts%'
      RETURNING id`;
    const census = await sql`
      UPDATE neighborhoods SET tier='coarse', recognizability=2, is_fallback=false
      WHERE source LIKE '%Census%' OR source LIKE '%CDP%'
      RETURNING id`;
    const zillow = await sql`
      UPDATE neighborhoods SET tier='coarse', recognizability=1
      WHERE source LIKE '%Zillow%'
      RETURNING id`;
    const demoted = await sql`
      UPDATE neighborhoods SET tier='fine', recognizability=0, is_fallback=true
      WHERE source LIKE '%Neighborhood Associations%'
      RETURNING id`;
    console.log(
      `Backfill: OSM=${osm.length} villages/districts=${villages.length} ` +
        `census=${census.length} zillow=${zillow.length} demoted-NA=${demoted.length}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
