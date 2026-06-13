/**
 * Soft-delete stub venues whose ONLY website is a third-party menu platform
 * (kwickmenu / menu11 / wheree — see lib/places/menuPlatform). Operator 2026-06-13:
 * these aren't real first-party venues worth featuring. SAFE scope: only venues with
 * NO live happy hour are dropped (a platform-site venue that somehow has a verified HH
 * is kept). Soft delete (deleted_at) — the google_place_id unique row stays as the
 * re-discovery guard; any active happy_hours are deactivated too. Audit-logged.
 *
 *   Dry-run (default — lists what WOULD be dropped, no writes):
 *     pnpm drop:menu-platform-stubs [--city <slug> --state <code>]
 *   Apply:
 *     pnpm drop:menu-platform-stubs --apply [--city <slug> --state <code>]
 *
 * Requires DATABASE_URL only. Idempotent + re-runnable.
 */
import "dotenv/config";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { isMenuPlatformWebsite } from "@/lib/places/menuPlatform";

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
    // Pull non-deleted venues that have a website and NO live happy hour; the precise
    // menu-platform decision is made in JS (isMenuPlatformWebsite) so the host list has
    // one home and subdomains/www are handled correctly.
    const candidates = await sql<
      { id: string; name: string; city: string; website_url: string }[]
    >`
      SELECT v.id, v.name, c.slug AS city, v.website_url
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      WHERE v.deleted_at IS NULL AND v.website_url IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours h
          WHERE h.venue_id = v.id AND h.active = true AND h.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND c.slug = ${cityArgs.slug} AND c.state = ${cityArgs.state}` : sql``}
      ORDER BY c.slug, v.name
    `;

    const targets = candidates.filter((v) => isMenuPlatformWebsite(v.website_url));
    console.log(
      `${targets.length} menu-platform stub(s) with no live HH` +
        (cityArgs ? ` in ${cityArgs.slug}, ${cityArgs.state}` : " across all cities") + ":",
    );
    for (const t of targets) console.log(`  - [${t.city}] ${t.name} — ${t.website_url}`);

    if (!apply) {
      console.log(`\n(dry-run) nothing changed. Re-run with --apply to soft-delete these ${targets.length}.`);
      return;
    }
    if (targets.length === 0) return;

    const ids = targets.map((t) => t.id);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE happy_hours SET active = false, updated_at = now()
        WHERE venue_id = ANY(${ids}) AND active = true AND deleted_at IS NULL
      `;
      await tx`UPDATE venues SET deleted_at = now(), updated_at = now() WHERE id = ANY(${ids})`;
      for (const t of targets) {
        await tx`
          INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
          VALUES ('venues', ${t.id}, ${tx.json({ deletedAt: null })}, ${tx.json({ deletedAt: "now" })},
                  'script', ${`menu-platform stub drop: website is a menu platform (${t.website_url})`})
        `;
      }
    });
    console.log(`\nSoft-deleted ${targets.length} menu-platform stub(s).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
