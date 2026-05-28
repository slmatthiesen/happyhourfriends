/**
 * Dump seed_candidates for a city to a CSV you can open/sort/triage in a spreadsheet.
 * Read-only. The CSV is gitignored (scraped Google data — not redistributed).
 *
 * Usage:  tsx scripts/export-candidates.ts [--city tacoma] [--out data/tacoma-candidates.csv]
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    city: get("--city") ?? "tacoma",
    out: get("--out") ?? "data/tacoma-candidates.csv",
  };
}

function csvCell(v: string | null): string {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
        name: string;
        address: string | null;
        google_place_id: string | null;
        processed_at: Date | null;
        outcome: string | null;
      }[]
    >`
      SELECT name, address, google_place_id, processed_at, outcome
      FROM seed_candidates
      WHERE city_id = ${city.id}
      ORDER BY name
    `;

    const header = "name,address,place_id,processed,outcome";
    const lines = rows.map((r) =>
      [
        csvCell(r.name),
        csvCell(r.address),
        csvCell(r.google_place_id),
        r.processed_at ? "yes" : "no",
        csvCell(r.outcome),
      ].join(","),
    );
    const path = join(process.cwd(), args.out);
    writeFileSync(path, [header, ...lines].join("\n"), "utf8");

    const processed = rows.filter((r) => r.processed_at).length;
    console.log(`Wrote ${rows.length} candidates → ${path}`);
    console.log(`  processed: ${processed} · unprocessed: ${rows.length - processed}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
