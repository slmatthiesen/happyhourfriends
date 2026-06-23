/**
 * Suppress dead-end stubs from the PUBLIC list (Build A — San Jose post-mortem).
 *
 * A dead-end stub is an active venue with NO live happy hour that also has no realistic path to
 * one: it fails the alcohol gate (no alcohol) OR its primary type is a zero-HH cuisine
 * (lib/places/stubGate). These pad the public list and make the product read as empty/broken.
 *
 * Mechanism is HIDE, not delete: set venues.status='no_happy_hour'. The public queries exclude
 * that status (lib/queries/venues); admin still sees them; and the persist/apply path flips the
 * status back to 'active' the instant an active HH lands (Jina recovery, regate, crowdsource) —
 * so suppression is fully reversible and never traps data. Only touches status='active' rows
 * (never an operator's closed/paused). Audit-logged.
 *
 *   Dry-run (default — by-type report, no writes):
 *     pnpm suppress:dead-end-stubs [--city <slug> --state <code>]
 *   Apply:
 *     pnpm suppress:dead-end-stubs --apply [--city <slug> --state <code>]
 *
 * Requires DATABASE_URL only. Idempotent + re-runnable. All-cities when --city is omitted.
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { isDeadEndStub } from "@/lib/places/stubGate";

interface Row {
  id: string;
  name: string;
  city: string;
  serves_alcohol: boolean | null;
  primary_type: string | null;
  types: string[] | null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const cityArgs = args.includes("--city") ? requireCityArgs() : null;

  const sql = postgres(dbUrl, { max: 1 });
  try {
    // Active, non-deleted venues with NO live happy hour, joined to their discovery candidate for
    // the alcohol/cuisine signal. A venue with no candidate (curated import) has null signal and
    // is never a dead end (the shared predicate handles that). The dead-end JUDGEMENT is made in
    // JS so the rule has one home (lib/places/stubGate).
    const rows = await sql<Row[]>`
      SELECT v.id, v.name, c.slug AS city,
             sc.serves_alcohol, sc.primary_type, sc.types
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      LEFT JOIN seed_candidates sc ON sc.google_place_id = v.google_place_id
      WHERE v.deleted_at IS NULL AND v.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h
          WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND lower(c.slug) = ${cityArgs.slug} AND lower(c.state) = ${cityArgs.state}` : sql``}
      ORDER BY c.slug, v.name
    `;

    const targets = rows.filter((v) =>
      isDeadEndStub({
        hasActiveHappyHour: false, // the query already excludes venues with a live HH
        signal: {
          servesAlcohol: v.serves_alcohol,
          name: v.name,
          primaryType: v.primary_type,
          types: v.types,
        },
      }),
    );

    const scope = cityArgs ? `${cityArgs.slug}, ${cityArgs.state}` : "all cities";
    console.log(`${targets.length} dead-end stub(s) to hide in ${scope} (of ${rows.length} HH-less active venues):\n`);

    // By-type breakdown — the report the operator reads to sanity-check the rule before --apply.
    const byType = new Map<string, number>();
    for (const t of targets) byType.set(t.primary_type ?? "(no candidate type)", (byType.get(t.primary_type ?? "(no candidate type)") ?? 0) + 1);
    for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${type}`);
    }

    if (!apply) {
      console.log(`\n(dry-run) nothing changed. Re-run with --apply to hide these ${targets.length}.`);
      return;
    }
    if (targets.length === 0) return;

    const ids = targets.map((t) => t.id);
    await sql.begin(async (tx) => {
      await tx`UPDATE venues SET status = 'no_happy_hour', updated_at = now() WHERE id = ANY(${ids}) AND status = 'active'`;
      for (const t of targets) {
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('venues', ${t.id}, ${tx.json({ status: "active" })}, ${tx.json({ status: "no_happy_hour" })},
                  'script', ${`dead-end stub suppressed (alcohol=${t.serves_alcohol}, type=${t.primary_type ?? "?"})`})
        `;
      }
    });
    console.log(`\nHid ${targets.length} dead-end stub(s) from the public list (reversible; status='no_happy_hour').`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
