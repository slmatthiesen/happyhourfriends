/**
 * $0 read-only preview of the canonical-neighborhood plan (stage 0 of
 * assignNeighborhoods): which Google-name spelling variants fold together, which names
 * merge into an existing district (inferred synonym + containment gate, or curated
 * override), and which rows would be renamed. Nothing is written — run
 * `backfill:neighborhoods` to apply.
 *
 * Usage:  tsx scripts/report-neighborhood-merges.ts [--city tucson --state az]
 * Required env: DATABASE_URL
 */
import "dotenv/config";
import postgres from "postgres";
import { planCityNeighborhoods, type CityRef } from "@/lib/geo/assignNeighborhoods";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 1 });
  try {
    let cities: CityRef[];
    if (process.argv.includes("--city")) {
      const { slug, state } = requireCityArgs();
      const city = await resolveCity(sql, slug, state);
      cities = [{ id: city.id, name: city.name, slug: city.slug, state: city.state }];
    } else {
      cities = await sql<CityRef[]>`SELECT id, name, slug, state FROM cities ORDER BY slug`;
    }

    let interesting = 0;
    for (const city of cities) {
      const plan = await planCityNeighborhoods(sql, city);
      const notable = plan.filter(
        (c) =>
          c.names.length > 1 ||
          c.synonymOf ||
          c.curatedInto ||
          (c.attachTo && c.attachTo.name !== c.displayName),
      );
      if (!notable.length) continue;
      console.log(`\n${city.name} (${city.state})`);
      for (const c of notable) {
        const variants = c.names.length > 1 ? ` [variants: ${c.names.join(" | ")}]` : "";
        if (c.curatedInto) {
          console.log(
            `  CURATED MERGE  ${c.displayName} (${c.venues} venues)${variants} → ${c.curatedInto.name}`,
          );
        } else if (c.synonymOf) {
          const pct = Math.round((c.containment ?? 0) * 100);
          const verdict = c.mergesAway ? "MERGE" : "KEEP (containment too low)";
          console.log(
            `  SYNONYM ${verdict}  ${c.displayName} (${c.venues} venues)${variants} → ${c.synonymOf.name} [${pct}% inside]`,
          );
        } else {
          const rename =
            c.attachTo && c.attachTo.name !== c.displayName
              ? ` (renames row '${c.attachTo.name}')`
              : "";
          console.log(`  FOLD  ${c.displayName} (${c.venues} venues)${variants}${rename}`);
        }
        interesting++;
      }
    }
    console.log(
      interesting
        ? `\n${interesting} active canonicalization rule(s). These describe the standing plan ` +
            `(synonym names keep resolving to their district); apply/refresh with: ` +
            `pnpm backfill:neighborhoods [--city <slug> --state <code>]`
        : "No folds, merges, or renames — neighborhood names are already canonical.",
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
