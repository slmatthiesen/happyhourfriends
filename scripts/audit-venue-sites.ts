/**
 * audit-venue-sites — $0 detector for venues whose stored website link is BROKEN.
 *
 * Grounding case (2026-06-19): Ernie's Inn / Scottsdale stored the correct site
 * (http://www.erniesinn.com) but the venue let its TLS cert lapse, so every click lands on
 * a browser cert-error page. The URL was right; the SITE was broken. URL-form normalization
 * can't catch that — only probing can. This script probes each venue's `website_url`,
 * classifies the failure (lib/places/siteHealth), and writes a review report. Common classes:
 *   expired_cert · invalid_cert · dns_dead · unreachable · http_error · parked
 *
 * $0 and READ-ONLY: it makes one HTTP GET per venue site (no Anthropic, no Google, no DB
 * writes). The JSON report under docs/ is the operator's review queue — decide per venue
 * whether to fix the URL, re-extract, or drop the venue. Re-run after fixes to confirm.
 *
 * Usage:
 *   tsx scripts/audit-venue-sites.ts                          # all live venues, all cities
 *   tsx scripts/audit-venue-sites.ts --city scottsdale --state az
 *   tsx scripts/audit-venue-sites.ts --status all            # include non-live venues too
 *   tsx scripts/audit-venue-sites.ts --include-ok            # report healthy ones too
 *   tsx scripts/audit-venue-sites.ts --limit 50 --concurrency 16
 */
import "dotenv/config";
import postgres from "postgres";
import { writeFile } from "node:fs/promises";
import { classifySiteHealth, type SiteHealth } from "@/lib/places/siteHealth";
import { probeUrl } from "@/lib/places/probeUrl";
import { resolveWorkingUrl } from "@/lib/places/resolveWebsiteUrl";
import { resolveCity } from "@/lib/cities/resolveCity";

interface Args {
  city?: string;
  state?: string;
  status: "live" | "all";
  limit: number | null;
  concurrency: number;
  includeOk: boolean;
  persist: boolean;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    city: get("--city")?.toLowerCase(),
    state: get("--state")?.toLowerCase(),
    status: get("--status") === "all" ? "all" : "live",
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : null,
    concurrency: get("--concurrency") ? Math.max(1, parseInt(get("--concurrency")!, 10)) : 12,
    includeOk: argv.includes("--include-ok"),
    persist: argv.includes("--persist"),
  };
}

async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

interface VenueRow {
  id: string;
  name: string;
  slug: string;
  website_url: string;
  status: string;
  city_slug: string;
  state: string;
}

interface ReportRow {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
  status: string;
  website_url: string;
  final_url: string | null;
  http_status: number | null;
  health: SiteHealth;
  detail: string;
  suggested_url: string | null;
}

async function main() {
  const args = parseArgs();
  const sql = postgres(process.env.DATABASE_URL!);

  let cityId: string | null = null;
  let scopeLabel = "all-cities";
  if (args.city && args.state) {
    const city = await resolveCity(sql, args.city, args.state);
    cityId = city.id;
    scopeLabel = `${city.slug}-${city.state}`;
  } else if (args.city || args.state) {
    throw new Error("Pass BOTH --city and --state to scope to one city, or neither for all cities.");
  }

  const venues = await sql<VenueRow[]>`
    SELECT v.id, v.name, v.slug, v.website_url, v.status, c.slug AS city_slug, c.state
    FROM venues v JOIN cities c ON c.id = v.city_id
    WHERE v.deleted_at IS NULL
      AND v.website_url IS NOT NULL AND v.website_url <> ''
      ${args.status === "live" ? sql`AND v.status = 'active'` : sql``}
      ${cityId ? sql`AND v.city_id = ${cityId}` : sql``}
    ORDER BY c.state, c.slug, v.name
    ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
  `;

  console.log(`Probing ${venues.length} venue site(s) [scope=${scopeLabel}, status=${args.status}] …`);

  const verdicts = await pool(venues, args.concurrency, async (v) => {
    const outcome = await probeUrl(v.website_url);
    const verdict = classifySiteHealth(outcome, v.website_url);
    // For broken links, try to derive a working URL (www/protocol/redirect variant with a
    // valid cert) so the operator can one-click accept it in /admin/site-health.
    const suggestedUrl = verdict.broken
      ? (await resolveWorkingUrl(v.website_url)).suggestedUrl
      : null;
    return { v, outcome, verdict, suggestedUrl };
  });

  const counts: Record<string, number> = {};
  const rows: ReportRow[] = [];
  for (const { v, outcome, verdict, suggestedUrl } of verdicts) {
    counts[verdict.health] = (counts[verdict.health] ?? 0) + 1;
    if (verdict.broken || args.includeOk) {
      rows.push({
        id: v.id,
        name: v.name,
        slug: v.slug,
        city: v.city_slug,
        state: v.state,
        status: v.status,
        website_url: v.website_url,
        final_url: outcome.finalUrl,
        http_status: outcome.status,
        health: verdict.health,
        detail: verdict.detail,
        suggested_url: suggestedUrl,
      });
    }
  }

  // Worst-first: certs/dns/parked are actionable; http_error/unreachable can be transient.
  const ORDER: SiteHealth[] = ["dns_dead", "parked", "expired_cert", "invalid_cert", "http_error", "unreachable", "blocked", "ok"];
  rows.sort((a, b) => ORDER.indexOf(a.health) - ORDER.indexOf(b.health) || a.city.localeCompare(b.city));

  const date = new Date().toISOString().slice(0, 10);
  const outPath = `docs/venue-site-health-${scopeLabel}-${date}.json`;
  const broken = rows.filter((r) => r.health !== "ok").length;
  await writeFile(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), scope: scopeLabel, probed: venues.length, broken, counts, rows }, null, 2),
  );

  console.log("\nHealth breakdown:");
  for (const h of ORDER) if (counts[h]) console.log(`  ${h.padEnd(13)} ${counts[h]}`);
  console.log(`\n${broken} broken / ${venues.length} probed → ${outPath}`);

  if (args.persist && verdicts.length > 0) {
    // Stamp link-health onto every probed venue (healthy ones too, so a fixed link clears its
    // stale broken status) — one bulk UPDATE via unnest, not a query per row.
    const now = new Date();
    const ids = verdicts.map((x) => x.v.id);
    const healths = verdicts.map((x) => x.verdict.health);
    const details = verdicts.map((x) => x.verdict.detail);
    const suggests = verdicts.map((x) => x.suggestedUrl);
    await sql`
      UPDATE venues AS v SET
        site_health = d.health,
        site_health_detail = d.detail,
        site_health_suggested_url = d.suggested,
        site_health_checked_at = ${now}
      FROM (
        SELECT * FROM unnest(${ids}::uuid[], ${healths}::text[], ${details}::text[], ${suggests}::text[])
          AS t(id, health, detail, suggested)
      ) d
      WHERE v.id = d.id
    `;
    console.log(`Persisted site_health for ${verdicts.length} venue(s).`);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
