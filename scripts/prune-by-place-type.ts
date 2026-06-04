/**
 * Prune unprocessed seed_candidates that the place-type gate would now exclude.
 * Uses the SAME isExcludedByPlaceType() as discovery, so the DB ends up matching
 * what a fresh discovery run would produce. Safe + idempotent:
 *   - Only deletes candidates with processed_at IS NULL (never touches enriched venues).
 *   - --dry-run (default) prints the matches without deleting; pass --apply to delete.
 *
 * Usage:
 *   tsx scripts/prune-by-place-type.ts --city tucson            # dry run
 *   tsx scripts/prune-by-place-type.ts --city tucson --apply    # delete
 */
import "dotenv/config";
import postgres from "postgres";
import {
  isExcludedByPlaceType,
  isExcludedByBusinessStatus,
  isLowSignalCandidate,
} from "@/lib/places/chainDenylist";

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return { city: get("--city") ?? "tucson", apply: argv.includes("--apply") };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const args = parseArgs();
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const [city] = await sql<{ id: string }[]>`
      SELECT id FROM cities WHERE slug = ${args.city}
    `;
    if (!city) throw new Error(`City '${args.city}' not found.`);

    const rows = await sql<
      {
        id: string;
        name: string;
        primary_type: string | null;
        types: string[] | null;
        business_status: string | null;
        user_rating_count: number | null;
        website_url: string | null;
        price_level: number | null;
      }[]
    >`
      SELECT id, name, primary_type, types, business_status,
             user_rating_count, website_url, price_level
      FROM seed_candidates
      WHERE city_id = ${city.id} AND processed_at IS NULL
      ORDER BY name
    `;

    // Apply the same gates discovery applies (place-type + closed + low-signal), so
    // the DB ends up matching what a fresh discovery run would produce.
    const matches = rows.filter(
      (r) =>
        isExcludedByPlaceType(r.primary_type, r.types) ||
        isExcludedByBusinessStatus(r.business_status) ||
        isLowSignalCandidate(r.user_rating_count),
    );

    console.log(
      `${args.city}: ${rows.length} unprocessed candidates, ${matches.length} match the exclusion gates.\n`,
    );
    for (const m of matches) {
      const reasons: string[] = [];
      if (isExcludedByPlaceType(m.primary_type, m.types)) reasons.push("place-type");
      if (isExcludedByBusinessStatus(m.business_status)) reasons.push("closed");
      if (isLowSignalCandidate(m.user_rating_count))
        reasons.push("low-signal");
      console.log(
        `  - ${m.name}  [primary=${m.primary_type ?? "—"}]  (${reasons.join(", ")})`,
      );
    }

    if (matches.length === 0) {
      console.log("\nNothing to prune.");
      return;
    }

    if (!args.apply) {
      console.log(`\nDRY RUN — pass --apply to delete these ${matches.length}.`);
      return;
    }

    const ids = matches.map((m) => m.id);
    const deleted = await sql`
      DELETE FROM seed_candidates WHERE id IN ${sql(ids)} RETURNING id
    `;
    console.log(`\nDeleted ${deleted.length} candidate(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
