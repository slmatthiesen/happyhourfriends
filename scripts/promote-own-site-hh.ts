/**
 * promote-own-site-hh — auto-cleanup for the hidden-HH backlog.
 *
 * For each no-live-HH stub venue WITH a website, probe its own domain for a reachable
 * happy-hour page ($0, plain HTTP), persist the verdict (venues.hh_page_url + hh_probe_status),
 * then route:
 *   - readable → re-extract from that first-party URL (resolveVenue) → goes LIVE through the
 *     canonical realness+provenance gate. The junk hidden window is superseded by the reconcile.
 *   - blocked  → still attempt re-extract (extractor escalates to headless render); if it STILL
 *     yields nothing, the venue is left hh_probe_status='blocked' for the admin manual-entry queue.
 *   - none     → no-op.
 *
 * --dry-run = probe + persist verdict + report routing, $0 (no resolveVenue, no extraction).
 * Default/real run SPENDS on re-extract (~$0.015–0.03/venue) — gate it behind operator go-ahead.
 *
 * Usage:
 *   pnpm promote:own-site-hh --city tucson --state az --dry-run     # $0: probe + report
 *   pnpm promote:own-site-hh --city tucson --state az [--limit N]   # PAID: re-extract readable/blocked
 *   pnpm promote:own-site-hh --dry-run                              # $0: all cities
 *
 * Required env: DATABASE_URL (+ ANTHROPIC_API_KEY for a real run).
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { requireCityArgs } from "@/lib/cities/resolveCity";
import { probeOwnSiteHhPage, type ProbeStatus } from "@/lib/places/ownSiteHhProbe";
import { resolveVenue } from "@/lib/recover/resolveVenue";

const DATABASE_URL = process.env.DATABASE_URL;
const args = process.argv.slice(2);
const argValue = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const hasCityFlag = args.includes("--city");
const cityArgs = hasCityFlag ? requireCityArgs() : null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Row {
  venue_id: string;
  city: string;
  venue: string;
  website_url: string | null;
}

interface Outcome {
  venue: string;
  city: string;
  websiteUrl: string | null;
  status: ProbeStatus;
  hhPageUrl: string | null;
  result: "live" | "still-empty" | "no-page" | "dry-run";
  windowsLive?: number;
  costCents?: number;
}

async function main() {
  if (!DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, { max: 4 });
  const outcomes: Outcome[] = [];
  try {
    const rows = await sql<Row[]>`
      SELECT v.id AS venue_id, c.name AS city, v.name AS venue, v.website_url
      FROM venues v
      JOIN cities c ON c.id = v.city_id
      WHERE v.status = 'active' AND v.deleted_at IS NULL AND v.data_completeness = 'stub'
        AND v.website_url IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM happy_hours a
          WHERE a.venue_id = v.id AND a.active AND a.deleted_at IS NULL
        )
        ${cityArgs ? sql`AND c.slug = ${cityArgs.slug} AND c.state = ${cityArgs.state}` : sql``}
      ORDER BY c.name, v.name
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;

    console.log(`${rows.length} no-live-HH stub venue(s) with a website to probe${dryRun ? " (dry-run, $0)" : ""}.`);

    for (const r of rows) {
      const probe = await probeOwnSiteHhPage(r.website_url);
      // Persist the verdict regardless of dry-run — the probe is free and reused by enrich + admin.
      await sql`
        UPDATE venues SET hh_page_url = ${probe.hhPageUrl}, hh_probe_status = ${probe.status}, updated_at = now()
        WHERE id = ${r.venue_id}
      `;

      const base: Outcome = {
        venue: r.venue, city: r.city, websiteUrl: r.website_url,
        status: probe.status, hhPageUrl: probe.hhPageUrl, result: "no-page",
      };

      if (probe.status === "none") {
        outcomes.push(base); // no own-site HH page found → nothing to re-extract
        continue;
      }
      if (dryRun) {
        outcomes.push({ ...base, result: "dry-run" });
        continue;
      }
      // readable or blocked → re-extract from the own-site HH page (blocked still tries; the
      // extractor escalates to render). resolveVenue persists live windows via the ONE path.
      const res = await resolveVenue({ venueId: r.venue_id, urls: probe.hhPageUrl ? [probe.hhPageUrl] : [], actor: "script:promote-own-site-hh" });
      outcomes.push({
        ...base,
        result: res.recovered ? "live" : "still-empty",
        windowsLive: res.windowsLive,
        costCents: res.costCents,
      });
    }

    const stamp = today();
    const tally = (s: ProbeStatus) => outcomes.filter((o) => o.status === s).length;
    const live = outcomes.filter((o) => o.result === "live").length;
    const stillBlocked = outcomes.filter((o) => o.result === "still-empty").length;
    const spent = outcomes.reduce((n, o) => n + (o.costCents ?? 0), 0);

    const md = [
      `# Own-site HH promote — ${stamp}${cityArgs ? ` (${cityArgs.slug}, ${cityArgs.state})` : " (all cities)"}`,
      "",
      `Probed ${outcomes.length}: readable ${tally("readable")}, blocked ${tally("blocked")}, none ${tally("none")}.`,
      dryRun ? "DRY-RUN — verdicts persisted, no extraction." : `Re-extracted → ${live} live. Still-blocked (manual queue): ${stillBlocked}. Spent ${(spent / 100).toFixed(2)} USD.`,
      "",
      "| result | status | city | venue | hh page | live | cost¢ |",
      "|---|---|---|---|---|---|---|",
      ...outcomes.map((o) => `| ${o.result} | ${o.status} | ${o.city} | ${o.venue} | ${o.hhPageUrl ?? ""} | ${o.windowsLive ?? ""} | ${o.costCents ?? ""} |`),
      "",
    ].join("\n");
    const path = `docs/own-site-hh-promote-${stamp}.md`;
    writeFileSync(path, md);
    console.log(dryRun
      ? `readable ${tally("readable")}, blocked ${tally("blocked")}, none ${tally("none")} → ${path}`
      : `${live} live, ${stillBlocked} still-blocked (manual queue), $${(spent / 100).toFixed(2)} → ${path}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
