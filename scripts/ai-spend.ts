/**
 * Print this month's AI spend from ai_usage_ledger, broken down by stage. A quick CLI
 * view of what /admin/budget shows — handy for watching seed/enrich cost. Read-only.
 *
 * Usage:  tsx scripts/ai-spend.ts
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const rows = await sql<
      {
        stage: string;
        calls: string;
        in_tok: string;
        out_tok: string;
        cents: string;
      }[]
    >`
      SELECT stage,
             count(*)            AS calls,
             sum(input_tokens)   AS in_tok,
             sum(output_tokens)  AS out_tok,
             sum(cost_cents)     AS cents
      FROM ai_usage_ledger
      WHERE month = date_trunc('month', now())::date
      GROUP BY stage
      ORDER BY stage
    `;

    if (rows.length === 0) {
      console.log("No AI usage recorded this month.");
      return;
    }

    let totalCents = 0;
    let totalCalls = 0;
    console.log("\n── AI spend this month (by stage) ───────────────────────");
    console.log("  stage        calls   in_tok    out_tok    cost");
    for (const r of rows) {
      const cents = Number(r.cents);
      totalCents += cents;
      totalCalls += Number(r.calls);
      console.log(
        `  ${r.stage.padEnd(11)} ${String(r.calls).padStart(5)} ` +
          `${String(r.in_tok).padStart(8)} ${String(r.out_tok).padStart(9)}  ` +
          `$${(cents / 100).toFixed(2)}`,
      );
    }
    console.log("  ────────────────────────────────────────────────────");
    console.log(`  TOTAL        ${String(totalCalls).padStart(5)}                      $${(totalCents / 100).toFixed(2)}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
