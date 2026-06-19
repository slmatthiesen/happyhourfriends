/**
 * gsc:pull — deterministic ($0, no AI) Search Console pull. Fetches the last N days of
 * page+query impressions, resolves each landing page to a venue with its data-status, and
 * writes tmp/gsc-report.{json,md}. The weekly routine reads the report and does the AI
 * verification + bubble-up. See docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md.
 *
 * Usage:
 *   tsx scripts/gsc-pull.ts                 # last 28 days, up to 1000 rows
 *   tsx scripts/gsc-pull.ts --days 90 --limit 5000
 *
 * Required env: GSC_SERVICE_ACCOUNT_KEY_PATH, GSC_PROPERTY, DATABASE_URL.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { googleSearchConsoleClient } from "@/lib/gsc/client";
import { buildReport, type VenueLookup, type PageReportEntry } from "@/lib/gsc/report";
import { getCityByPath, getVenueBySlug } from "@/lib/queries/venues";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

function isoDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

const lookup: VenueLookup = async ({ stateSlug, citySlug, slug }) => {
  const city = await getCityByPath(stateSlug, citySlug);
  if (!city) return null;
  const venue = await getVenueBySlug(city.id, slug);
  if (!venue) return null;
  const windowCount = venue.happyHours.length;
  const offeringCount = venue.happyHours.reduce((n, w) => n + w.offerings.length, 0);
  return { name: venue.name, windowCount, offeringCount };
};

function toMarkdown(report: PageReportEntry[]): string {
  const lines = ["# GSC visibility report", ""];
  for (const e of report) {
    const status = e.venue ? ` — **${e.venue.status}** (${e.venue.windowCount}w/${e.venue.offeringCount}o)` : ` — ${e.kind}`;
    lines.push(`## ${e.page}${status}`);
    lines.push(`impressions ${e.impressions} · clicks ${e.clicks}`);
    for (const q of e.topQueries) lines.push(`- "${q.query}" (${q.impressions} impr)`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const property = process.env.GSC_PROPERTY;
  if (!property) {
    throw new Error("GSC_PROPERTY is not set. See docs/superpowers/specs/2026-06-19-gsc-visibility-check-design.md");
  }
  const days = arg("days", 28);
  const rowLimit = arg("limit", 1000);

  const client = googleSearchConsoleClient();
  const rows = await client.fetchRows({
    property,
    startDate: isoDaysAgo(days),
    endDate: isoDaysAgo(0),
    rowLimit,
  });
  console.log(`Fetched ${rows.length} page+query rows over ${days} days.`);

  const report = await buildReport(rows, lookup);
  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/gsc-report.json", JSON.stringify(report, null, 2));
  writeFileSync("tmp/gsc-report.md", toMarkdown(report));

  const flagged = report.filter((e) => e.venue && e.venue.status !== "complete");
  console.log(`Wrote tmp/gsc-report.json + .md — ${report.length} pages, ${flagged.length} venue pages flagged (stub/bare/unresolved).`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
