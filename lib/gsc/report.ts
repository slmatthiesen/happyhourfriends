/**
 * Groups raw GSC rows by landing page, resolves each page to a route entity, and for
 * venue pages enriches with the venue's data-status via an injected lookup (so this stays
 * pure and testable — the DB call lives in the orchestrator). Status reflects how well the
 * entry can answer a happy-hour query: no windows = stub, windows but no deals = bare.
 */
import { resolvePage, type ResolvedPage } from "@/lib/gsc/resolvePage";
import type { SearchAnalyticsRow } from "@/lib/gsc/client";

export type VenueStatus = "stub" | "bare" | "complete" | "unresolved";

export type VenueLookup = (resolved: {
  stateSlug: string;
  citySlug: string;
  slug: string;
}) => Promise<{ name: string; windowCount: number; offeringCount: number } | null>;

export interface PageReportEntry {
  page: string;
  kind: ResolvedPage["kind"];
  impressions: number;
  clicks: number;
  topQueries: { query: string; impressions: number; clicks: number }[];
  venue?: { name: string | null; status: VenueStatus; windowCount: number; offeringCount: number };
}

function deriveStatus(windowCount: number, offeringCount: number): VenueStatus {
  if (windowCount === 0) return "stub";
  if (offeringCount === 0) return "bare";
  return "complete";
}

export async function buildReport(
  rows: SearchAnalyticsRow[],
  lookup: VenueLookup,
): Promise<PageReportEntry[]> {
  const byPage = new Map<string, SearchAnalyticsRow[]>();
  for (const row of rows) {
    const list = byPage.get(row.page) ?? [];
    list.push(row);
    byPage.set(row.page, list);
  }

  const entries: PageReportEntry[] = [];
  for (const [page, pageRows] of byPage) {
    const resolved = resolvePage(page);
    const impressions = pageRows.reduce((n, r) => n + r.impressions, 0);
    const clicks = pageRows.reduce((n, r) => n + r.clicks, 0);
    const topQueries = pageRows
      .slice()
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 5)
      .map((r) => ({ query: r.query, impressions: r.impressions, clicks: r.clicks }));

    const entry: PageReportEntry = { page, kind: resolved.kind, impressions, clicks, topQueries };

    if (resolved.kind === "venue") {
      const found = await lookup(resolved);
      entry.venue = found
        ? { name: found.name, status: deriveStatus(found.windowCount, found.offeringCount), windowCount: found.windowCount, offeringCount: found.offeringCount }
        : { name: null, status: "unresolved", windowCount: 0, offeringCount: 0 };
    }
    entries.push(entry);
  }

  return entries.sort((a, b) => b.impressions - a.impressions);
}
