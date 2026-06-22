/**
 * backfill-offering-names — retroactively apply the offering-name cleanup that
 * sanitizeOfferings now does on every fresh extraction (PR #208) to ALREADY-STORED rows.
 * persistExtractedWindows is insert-only for offerings, so a re-extract never heals the
 * existing set — this $0 deterministic sweep does.
 *
 * Two in-place fixes (see lib/recover/offeringSanity.classifyStoredOffering):
 *   - RENAME: strip a redundant leading "$N " price prefix when price_cents is set
 *             ("$19 Kamala Llama hummus" → "Kamala Llama hummus"). Never a "$N off …"
 *             discount, never when price_cents is null.
 *   - DROP:   soft-delete a happy-hour section heading mis-captured as an offering
 *             ("HAPPY HOUR AT GLK", "Happy Hour Menu"). Reversible (deleted_at + active=false).
 *
 * Idempotent. Dry-run by default ($0, no writes); --apply mutates in one transaction and
 * writes an audit_log row per change.
 *
 *   pnpm tsx scripts/backfill-offering-names.ts                       # dry-run, ALL cities
 *   pnpm tsx scripts/backfill-offering-names.ts --city oakland --state ca
 *   pnpm tsx scripts/backfill-offering-names.ts --apply               # write, ALL cities
 *   pnpm tsx scripts/backfill-offering-names.ts --city oakland --state ca --apply
 */
import "dotenv/config";
import postgres from "postgres";
import { classifyStoredOffering } from "@/lib/recover/offeringSanity";
import { resolveCity } from "@/lib/cities/resolveCity";

const APPLY = process.argv.includes("--apply");
const ACTOR = "admin:backfill-offering-names";

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface OfferingRow {
  id: string;
  name: string | null;
  price_cents: number | null;
  venue: string;
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

    // Active, non-deleted offerings only — the ones users and the review queues see.
    const rows = await sql<OfferingRow[]>`
      SELECT o.id, o.name, o.price_cents, v.name AS venue, c.name AS city
      FROM offerings o
      JOIN happy_hours hh ON hh.id = o.happy_hour_id
      JOIN venues v ON v.id = hh.venue_id
      JOIN cities c ON c.id = v.city_id
      WHERE o.deleted_at IS NULL AND o.active = true
        ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
      ORDER BY c.name, v.name`;

    const renames: { row: OfferingRow; newName: string }[] = [];
    const drops: OfferingRow[] = [];
    for (const row of rows) {
      const verdict = classifyStoredOffering({ name: row.name, priceCents: row.price_cents });
      if (verdict.action === "rename") renames.push({ row, newName: verdict.newName });
      else if (verdict.action === "drop") drops.push(row);
    }

    const scope = cityId ? `${citySlug}, ${state}` : "ALL cities";
    console.log(`\nScanned ${rows.length} active offerings (${scope}).`);
    console.log(`  ${renames.length} to RENAME (strip redundant price prefix)`);
    console.log(`  ${drops.length} to DROP (happy-hour section heading)\n`);

    const sample = (label: string, lines: string[]) => {
      if (lines.length === 0) return;
      console.log(label);
      for (const l of lines.slice(0, 12)) console.log(`    ${l}`);
      if (lines.length > 12) console.log(`    … and ${lines.length - 12} more`);
      console.log();
    };
    sample(
      "RENAME samples:",
      renames.map((r) => `[${r.row.city} · ${r.row.venue}] "${r.row.name}" → "${r.newName}"`),
    );
    sample(
      "DROP samples:",
      drops.map((d) => `[${d.city} · ${d.venue}] "${d.name}"`),
    );

    if (!APPLY) {
      console.log("Dry-run — no writes. Re-run with --apply to commit.");
      return;
    }

    await sql.begin(async (tx) => {
      for (const { row, newName } of renames) {
        await tx`UPDATE offerings SET name = ${newName}, updated_at = now() WHERE id = ${row.id}`;
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('offerings', ${row.id}, ${sql.json({ name: row.name })}, ${sql.json({ name: newName })},
                  ${ACTOR}, 'backfill: strip redundant price prefix from offering name')`;
      }
      for (const row of drops) {
        await tx`UPDATE offerings SET deleted_at = now(), active = false, updated_at = now() WHERE id = ${row.id}`;
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('offerings', ${row.id}, ${sql.json({ name: row.name, deletedAt: null })},
                  ${sql.json({ deletedAt: "now" })}, ${ACTOR},
                  'backfill: soft-delete happy-hour section heading mis-captured as an offering')`;
      }
    });

    console.log(`Applied: ${renames.length} renamed, ${drops.length} dropped.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
