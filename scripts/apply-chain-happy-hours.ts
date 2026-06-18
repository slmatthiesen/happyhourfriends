/**
 * apply-chain-happy-hours — apply the curated CHAIN_HAPPY_HOURS floor to every matching
 * venue across all cities. Dry-run by default ($0, read-only); pass --apply to write.
 *
 * Locks in an operator-confirmed chain HH for current AND future locations: this is the
 * backfill for venues already in the DB; seed:enrich applies the same floor to new venues
 * as they're created (lib/recover/applyChainHappyHour). Idempotent — safe to re-run.
 *
 *   pnpm tsx scripts/apply-chain-happy-hours.ts            # dry-run, $0
 *   pnpm tsx scripts/apply-chain-happy-hours.ts --apply    # write
 */
import "dotenv/config";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cities, venues } from "@/db/schema";
import { CHAIN_HAPPY_HOURS, chainHappyHourFor } from "@/lib/places/chainHappyHours";
import { applyChainHappyHourIfMissing } from "@/lib/recover/applyChainHappyHour";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (CHAIN_HAPPY_HOURS.length === 0) {
    console.log("No chain happy hours registered.");
    return;
  }
  // Cheap prefilter on the chain key; chainHappyHourFor re-confirms with a normalized match.
  const rows = await db
    .select({ id: venues.id, name: venues.name, cityId: venues.cityId, citySlug: cities.slug })
    .from(venues)
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .where(
      and(
        sql`${venues.deletedAt} IS NULL`,
        or(...CHAIN_HAPPY_HOURS.map((c) => ilike(venues.name, `%${c.chain}%`))),
      ),
    );

  console.log(`chain-happy-hours — ${APPLY ? "APPLY" : "DRY-RUN ($0)"} · ${rows.length} candidate venue(s)`);
  let applied = 0;
  let skipped = 0;
  for (const v of rows) {
    const c = chainHappyHourFor(v.name);
    if (!c) continue;
    const r = await applyChainHappyHourIfMissing({
      venueId: v.id,
      cityId: v.cityId,
      venueName: v.name,
      actor: "apply:chain-hh",
      dryRun: !APPLY,
    });
    if (r.applied) {
      applied++;
      console.log(`  ${APPLY ? "✓ applied" : "→ would apply"}  ${v.citySlug}/${v.name} — ${c.label} ${c.daysOfWeek.join("")} ${c.startTime}-${c.endTime}`);
    } else {
      skipped++;
      console.log(`  · skip      ${v.citySlug}/${v.name} (${r.skippedReason})`);
    }
  }
  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${applied} · skipped: ${skipped}`);
  if (!APPLY && applied > 0) console.log("Re-run with --apply to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
