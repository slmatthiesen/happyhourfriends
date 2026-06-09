/**
 * audit:data — scan a city's STORED venue happy-hour data for anomalies (lib/audit/anomalyRules),
 * write a review report, and upsert one data_audit row per venue (idempotency ledger). $0:
 * no network, no AI — it reads only what's already in the DB.
 *
 * Usage: pnpm tsx scripts/audit-data.ts --city <slug> --state <code> [--recheck] [--emit-batches] [--limit N]
 *   --recheck       re-scan venues already in data_audit
 *   --emit-batches  also write docs/audit-batches/<slug>-<n>.md for the in-session agent sniff-test
 */
import "dotenv/config";
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { auditVenue, type AuditWindow, type AnomalyFlag } from "@/lib/audit/anomalyRules";
import { offeringsFingerprint } from "@/lib/places/windowReconcile";
import { requireCityArgs, resolveCity } from "@/lib/cities/resolveCity";
import type { OpenPeriod } from "@/lib/geo/timezone";

function arg(f: string): string | undefined {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const RECHECK = process.argv.includes("--recheck");
const EMIT = process.argv.includes("--emit-batches");
const LIMIT = arg("--limit") ? parseInt(arg("--limit")!, 10) : null;
const BATCH_SIZE = 20;

interface VenueRow {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  hours_json: OpenPeriod[] | null;
}

async function main() {
  const { slug, state } = requireCityArgs();
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  try {
    const city = await resolveCity(sql, slug, state);

    const venuesRows = await sql<VenueRow[]>`
      SELECT v.id, v.name, v.slug, v.website_url, v.hours_json
      FROM venues v
      WHERE v.city_id = ${city.id}
        AND v.status = 'active'
        ${RECHECK ? sql`` : sql`AND NOT EXISTS (SELECT 1 FROM data_audit da WHERE da.venue_id = v.id)`}
      ORDER BY v.name
      ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}`;

    console.log(`[audit:data] ${venuesRows.length} venue(s) to scan in ${city.name}. $0 — no API/network.\n`);

    const report: { name: string; slug: string; website: string | null; flags: AnomalyFlag[]; windows: AuditWindow[] }[] = [];
    let flagged = 0;

    for (const v of venuesRows) {
      // Offerings ride along so the shared reconcile gate discriminates per-day specials /
      // distinct-deal overlaps the persist gate deliberately keeps (same join as reconcile-windows).
      const rawRows = await sql<
        (Omit<AuditWindow, "offeringsKey"> & { offs: { name: string | null; price_cents: number | null }[] })[]
      >`
        SELECT hh.days_of_week AS "daysOfWeek", hh.start_time AS "startTime", hh.end_time AS "endTime",
               hh.all_day AS "allDay", hh.active, hh.source_url AS "sourceUrl", hh.notes,
               coalesce(json_agg(json_build_object('name', o.name, 'price_cents', o.price_cents))
                        FILTER (WHERE o.id IS NOT NULL), '[]') AS offs
        FROM happy_hours hh
        LEFT JOIN offerings o ON o.happy_hour_id = hh.id AND o.deleted_at IS NULL AND o.active = true
        WHERE hh.venue_id = ${v.id} AND hh.deleted_at IS NULL
        GROUP BY hh.id`;
      const hhRows: AuditWindow[] = rawRows.map(({ offs, ...w }) => ({
        ...w,
        offeringsKey: offeringsFingerprint(offs.map((o) => ({ name: o.name, priceCents: o.price_cents }))),
      }));
      const flags = auditVenue({ websiteUrl: v.website_url, hoursJson: v.hours_json, windows: hhRows });
      const resolution = flags.length === 0 ? "clean" : "scanned";
      if (flags.length > 0) {
        flagged++;
        report.push({ name: v.name, slug: v.slug, website: v.website_url, flags, windows: hhRows.filter((w) => w.active) });
      }
      await sql`
        INSERT INTO data_audit (venue_id, flags, resolution, audited_at)
        VALUES (${v.id}, ${sql.json(flags as never)}, ${resolution}, now())
        ON CONFLICT (venue_id) DO UPDATE
          SET flags = EXCLUDED.flags, resolution = EXCLUDED.resolution, audited_at = now()`;
    }

    console.log(`Scanned ${venuesRows.length}; flagged ${flagged}.`);

    mkdirSync("docs", { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const base = `docs/${city.slug}-data-audit-${date}`;
    writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
    const md = [`# Data audit — ${city.name} (${date})`, "", `Flagged ${flagged} of ${venuesRows.length} scanned.`, ""];
    for (const r of report) {
      md.push(`## ${r.name}  (\`${r.slug}\`)`);
      md.push(`Website: ${r.website ?? "—"}`);
      md.push(`Flags: ${r.flags.map((f) => `\`${f.code}\`(${f.severity})`).join(", ")}`);
      for (const f of r.flags) md.push(`  - ${f.code}: ${f.evidence}`);
      md.push("Active windows:");
      for (const w of r.windows) md.push(`  - ${JSON.stringify(w.daysOfWeek)} ${w.startTime ?? "open"}–${w.endTime ?? "close"} src=${w.sourceUrl ?? "—"}`);
      md.push("");
    }
    writeFileSync(`${base}.md`, md.join("\n"));
    console.log(`Report → ${base}.{md,json}`);

    if (EMIT && report.length > 0) {
      mkdirSync("docs/audit-batches", { recursive: true });
      for (let i = 0; i < report.length; i += BATCH_SIZE) {
        const batch = report.slice(i, i + BATCH_SIZE);
        const n = i / BATCH_SIZE + 1;
        const lines = [`# Audit batch ${n} — ${city.name} (data only; agent sniff-test)`, ""];
        for (const r of batch) {
          lines.push(`### ${r.name}`);
          for (const w of r.windows) lines.push(`- ${JSON.stringify(w.daysOfWeek)} ${w.startTime ?? "open"}–${w.endTime ?? "close"} src=${w.sourceUrl ?? "—"} notes=${w.notes ?? "—"}`);
          lines.push("");
        }
        writeFileSync(`docs/audit-batches/${city.slug}-${n}.md`, lines.join("\n"));
      }
      console.log(`Emitted ${Math.ceil(report.length / BATCH_SIZE)} agent-review batch(es) → docs/audit-batches/${city.slug}-*.md`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
