/**
 * clean-junk-offerings — find (and optionally soft-delete) offerings that are page-scrape
 * noise rather than real happy-hour deals, using the shared lib/recover/offeringJunk rules
 * (nav bar, bare soft drinks, price-only names). Companion to the persist-time gate in
 * sanitizeOfferings: that stops new junk landing; this cleans what's already stored.
 *
 * Soft-delete only (active=false, deleted_at=now()) — fully reversible, audit-logged, and
 * windows are left intact (a venue keeps its real HH time even if every offering was junk).
 *
 *   Report (default, $0, no writes) — every hit + a CSV under docs/:
 *     pnpm tsx scripts/clean-junk-offerings.ts
 *   Apply (soft-delete the heuristic hits, LOCAL db; sync prod separately):
 *     pnpm tsx scripts/clean-junk-offerings.ts --apply
 *   Purge ALL offerings for one venue (operator-verified fabricated, e.g. site has no deals):
 *     pnpm tsx scripts/clean-junk-offerings.ts --purge-venue <venue_id> [--apply]
 *
 * Requires DATABASE_URL only. Idempotent + re-runnable.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { classifyOfferingJunk } from "@/lib/recover/offeringJunk";

interface Row {
  id: string;
  name: string | null;
  price_cents: number | null;
  description: string | null;
  kind: string;
  venue_id: string;
  venue: string;
  city: string;
  state: string;
}

function selectOfferings(sql: postgres.Sql, venueId: string | null) {
  const venueFilter = venueId ? sql`AND v.id = ${venueId}` : sql``;
  return sql<Row[]>`
    SELECT o.id, o.name, o.price_cents, o.description, o.kind,
           v.id AS venue_id, v.name AS venue, c.slug AS city, c.state
    FROM offerings o
    JOIN happy_hours hh ON hh.id = o.happy_hour_id
    JOIN venues v ON v.id = hh.venue_id
    JOIN cities c ON c.id = v.city_id
    WHERE o.active AND o.deleted_at IS NULL AND hh.active AND hh.deleted_at IS NULL
      ${venueFilter}
    ORDER BY c.slug, v.name`;
}

function csvCell(s: unknown): string {
  return `"${String(s ?? "").replace(/"/g, '""')}"`;
}

async function softDelete(
  sql: postgres.Sql,
  rows: Array<{ id: string; reason: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  await sql.begin(async (tx) => {
    await tx`UPDATE offerings SET active = false, deleted_at = now(), updated_at = now()
             WHERE id = ANY(${rows.map((r) => r.id)}) AND active = true`;
    for (const r of rows) {
      await tx`
        INSERT INTO audit_log (table_name, row_id, before_jsonb, after_jsonb, actor, reason)
        VALUES ('offerings', ${r.id}, ${tx.json({ active: true })}, ${tx.json({ active: false })},
                'script', ${r.reason})`;
    }
  });
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const purgeIdx = args.indexOf("--purge-venue");
  const purgeVenueId = purgeIdx >= 0 ? args[purgeIdx + 1] : null;

  const sql = postgres(dbUrl, { max: 1 });
  try {
    if (purgeVenueId) {
      const rows = await selectOfferings(sql, purgeVenueId);
      if (rows.length === 0) {
        console.log(`No active offerings for venue ${purgeVenueId}.`);
        return;
      }
      console.log(`\nPURGE venue ${rows[0].venue} (${rows[0].city}/${rows[0].state}) — ${rows.length} offering(s):`);
      for (const r of rows) console.log(`  • [${r.kind}] ${r.name ?? r.description ?? "(unnamed)"}  ${r.price_cents != null ? `$${(r.price_cents / 100).toFixed(2)}` : ""}`);
      if (apply) {
        await softDelete(sql, rows.map((r) => ({ id: r.id, reason: "venue-purge: site publishes no happy-hour deal list (operator-verified)" })));
        console.log(`\nSoft-deleted ${rows.length} offering(s). Window(s) kept intact.`);
      } else {
        console.log(`\n(dry-run — re-run with --apply to soft-delete)`);
      }
      return;
    }

    const rows = await selectOfferings(sql, null);
    const hits = rows
      .map((r) => ({ row: r, verdict: classifyOfferingJunk({ name: r.name, priceCents: r.price_cents, description: r.description, kind: r.kind }) }))
      .filter((h): h is { row: Row; verdict: NonNullable<ReturnType<typeof classifyOfferingJunk>> } => h.verdict !== null);

    console.log(`\nScanned ${rows.length} live offerings — ${hits.length} junk hit(s):\n`);
    const byRule: Record<string, number> = {};
    for (const h of hits) {
      byRule[h.verdict.rule] = (byRule[h.verdict.rule] ?? 0) + 1;
      console.log(`  [${h.verdict.rule}] ${h.row.city}/${h.row.state} · ${h.row.venue} · "${h.row.name ?? h.row.description ?? "(unnamed)"}"`);
    }
    console.log(`\nby rule: ${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join("  ") || "(none)"}`);

    if (hits.length > 0) {
      const date = new Date().toISOString().slice(0, 10);
      const csvPath = path.join("docs", `junk-offerings-${date}.csv`);
      const header = "rule,city,state,venue,venue_id,offering_id,name,price_cents,description";
      const lines = hits.map((h) =>
        [h.verdict.rule, h.row.city, h.row.state, h.row.venue, h.row.venue_id, h.row.id, h.row.name, h.row.price_cents, h.row.description].map(csvCell).join(","),
      );
      fs.writeFileSync(csvPath, [header, ...lines].join("\n") + "\n");
      console.log(`\nWrote ${csvPath}`);
    }

    if (apply) {
      await softDelete(sql, hits.map((h) => ({ id: h.row.id, reason: `junk offering (${h.verdict.rule}): ${h.verdict.reason}` })));
      console.log(`\nSoft-deleted ${hits.length} junk offering(s) (LOCAL db). Sync prod separately.`);
    } else {
      console.log(`\n(dry-run — re-run with --apply to soft-delete)`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
