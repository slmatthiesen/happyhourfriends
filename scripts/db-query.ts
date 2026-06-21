/**
 * db-query — run a READ-ONLY SQL query against DATABASE_URL and print the rows.
 *
 * Exists so ad-hoc SELECTs don't each need a fresh permission prompt: a single
 * allowlist entry `Bash(tsx scripts/db-query.ts:*)` covers every read. A hard guard
 * rejects anything that isn't a single SELECT/WITH statement, so allowlisting it can
 * never authorise a write.
 *
 * Usage:
 *   tsx scripts/db-query.ts "SELECT slug, state FROM cities ORDER BY slug"
 *   tsx scripts/db-query.ts --json "SELECT ..."   # raw JSON instead of a table
 */
import "dotenv/config";
import postgres from "postgres";

const WRITE = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|copy|vacuum|reindex|merge|call|do)\b/i;

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const sql_text = args.filter((a) => a !== "--json").join(" ").trim();

  if (!sql_text) {
    console.error('Usage: tsx scripts/db-query.ts [--json] "SELECT ..."');
    process.exit(1);
  }
  // Read-only guard: one statement, must start with SELECT/WITH, no write verbs.
  const oneStatement = sql_text.replace(/;\s*$/, "");
  if (/;/.test(oneStatement)) {
    console.error("Refused: only a single statement is allowed (no ';').");
    process.exit(1);
  }
  if (!/^\s*(select|with)\b/i.test(oneStatement) || WRITE.test(oneStatement)) {
    console.error("Refused: read-only — only SELECT/WITH queries are permitted.");
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql.unsafe(oneStatement);
    if (json) console.log(JSON.stringify(rows, null, 2));
    else if (rows.length === 0) console.log("(0 rows)");
    else console.table(rows);
    console.error(`(${rows.length} row${rows.length === 1 ? "" : "s"})`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
