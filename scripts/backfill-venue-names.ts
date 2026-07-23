/**
 * backfill-venue-names — retroactively apply the promotional-name cleanup that discovery now
 * does on every fresh venue (lib/places/venueName.stripPromoName) to ALREADY-STORED venues.
 * Owners stuff marketing into their Google business name ("… (open for all World Cup games)",
 * "… (Award-Winning Street Food)", "… (#1 Mandarin Style)") and it leaked into the title.
 *
 * Conservative: only strips a parenthetical whose contents look promotional; legitimate
 * qualifiers — branch/location ("(Divisadero)"), rename context ("(formerly …)"), service
 * ("(Halal)") — are left untouched (see lib/places/venueName). The SLUG is intentionally NOT
 * changed: it's the venue's public URL, and rewriting it would 404 the indexed page.
 *
 * Idempotent. Dry-run by default ($0, no writes); --apply mutates in one transaction and writes
 * an audit_log row per rename. Bumps updated_at so `pnpm push:prod` carries the fix to prod.
 *
 *   pnpm tsx scripts/backfill-venue-names.ts                       # dry-run, ALL cities
 *   pnpm tsx scripts/backfill-venue-names.ts --city san-francisco --state ca
 *   pnpm tsx scripts/backfill-venue-names.ts --apply               # write, ALL cities
 *   pnpm tsx scripts/backfill-venue-names.ts --city san-francisco --state ca --apply
 */
import "dotenv/config";
import postgres from "postgres";
import { stripPromoName } from "@/lib/places/venueName";
import { resolveCity } from "@/lib/cities/resolveCity";

const APPLY = process.argv.includes("--apply");
const ACTOR = "admin:backfill-venue-names";

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface VenueRow {
  id: string;
  name: string;
  city: string;
}

async function main() {
  const citySlug = getArg("--city");
  const state = getArg("--state");
  if ((citySlug && !state) || (!citySlug && state)) {
    throw new Error("--city and --state must be given together (or neither, for all cities).");
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    let cityId: string | null = null;
    if (citySlug && state) {
      const city = await resolveCity(sql, citySlug, state);
      cityId = city.id;
    }

    // Only venues carrying a bracketed group can change — cheap pre-filter for the scan.
    const rows = await sql<VenueRow[]>`
      SELECT v.id, v.name, c.name AS city
      FROM venues v JOIN cities c ON c.id = v.city_id
      WHERE v.deleted_at IS NULL
        AND (v.name LIKE '%(%' OR v.name LIKE '%[%')
        ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
      ORDER BY c.name, v.name`;

    const changes = rows
      .map((r) => ({ ...r, cleaned: stripPromoName(r.name) }))
      .filter((r) => r.cleaned !== r.name);

    for (const c of changes) {
      console.log(`  [${c.city}] "${c.name}"\n            → "${c.cleaned}"`);
    }
    console.log(`\n${changes.length} venue name(s) ${APPLY ? "renamed" : "would be renamed"} (of ${rows.length} scanned).`);

    if (!APPLY) {
      console.log("Dry-run — re-run with --apply to write.");
      return;
    }
    if (changes.length === 0) return;

    await sql.begin(async (tx) => {
      for (const c of changes) {
        await tx`UPDATE venues SET name = ${c.cleaned}, updated_at = now() WHERE id = ${c.id}`;
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('venues', ${c.id}, ${sql.json({ name: c.name })}, ${sql.json({ name: c.cleaned })},
                  ${ACTOR}, 'backfill: strip promotional cruft from venue name')`;
      }
    });
    console.log(`✓ Applied ${changes.length} rename(s). Run \`pnpm push:prod\` to reach prod.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
