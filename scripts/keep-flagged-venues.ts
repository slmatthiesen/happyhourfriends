/**
 * keep-flagged-venues — operator "Keep" for /admin/flags, from the CLI.
 *
 * When the operator has verified that a flagged venue's HH data is CORRECT (e.g. confirmed
 * the happy hour on the venue's site), this settles its data_audit row to `operator_kept`
 * via the SAME canonical path as the admin UI (lib/audit/flagReview.keepFlaggedVenue) — the
 * flags stay recorded for the eval corpus, an audit_log row notes the overruled codes, and
 * the venue drops out of the /admin/flags queue (which hides resolution=operator_kept).
 *
 * Dry-run by default. Match venues by name (case-insensitive substring) within one city.
 *
 *   pnpm tsx scripts/keep-flagged-venues.ts --city berkeley --state ca \
 *     --venue "Super Duper Burgers" --venue "Vanessa's Bistro" [--note "..."] [--apply]
 */
import "dotenv/config";
import { and, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cities, dataAudit, venues } from "@/db/schema";
import { keepFlaggedVenue } from "@/lib/audit/flagReview";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import type { AnomalyFlag } from "@/lib/audit/anomalyRules";

const APPLY = process.argv.includes("--apply");
const ADMIN_EMAIL = "steven.matthiesen@gmail.com"; // the operator's verify decision

function venueArgs(): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === "--venue") out.push(process.argv[i + 1]);
  }
  return out;
}
function noteArg(): string | undefined {
  const i = process.argv.indexOf("--note");
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { slug, state } = requireCityArgs();
  const names = venueArgs();
  if (names.length === 0) {
    console.error("Pass at least one --venue \"<name>\".");
    process.exit(1);
  }
  const note = noteArg();

  const [city] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(ilike(cities.slug, slug), ilike(cities.state, state)))
    .limit(1);
  if (!city) throw new Error(`No city for --city ${slug} --state ${state}`);

  console.log(`keep-flagged-venues — ${APPLY ? "APPLY" : "DRY-RUN ($0)"} · ${slug}/${state}`);
  let kept = 0;
  for (const name of names) {
    const rows = await db
      .select({
        id: venues.id,
        name: venues.name,
        flags: dataAudit.flags,
        resolution: dataAudit.resolution,
      })
      .from(venues)
      .innerJoin(dataAudit, eq(dataAudit.venueId, venues.id))
      .where(and(eq(venues.cityId, city.id), ilike(venues.name, `%${name}%`)));

    if (rows.length === 0) {
      console.log(`  · no flagged venue matching "${name}"`);
      continue;
    }
    for (const r of rows) {
      const codes = ((r.flags ?? []) as AnomalyFlag[]).map((f) => f.code).join(", ") || "none";
      if (r.resolution === "operator_kept") {
        console.log(`  · ${r.name} already operator_kept`);
        continue;
      }
      if (!APPLY) {
        console.log(`  → would keep  ${r.name}  (overrules: ${codes})`);
        continue;
      }
      await keepFlaggedVenue(db, { venueId: r.id, adminEmail: ADMIN_EMAIL, note });
      kept++;
      console.log(`  ✓ kept        ${r.name}  (overruled: ${codes})`);
    }
  }
  console.log(`\n${APPLY ? "Kept" : "Would keep"}: ${APPLY ? kept : "(dry-run)"}`);
  if (!APPLY) console.log("Re-run with --apply to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
