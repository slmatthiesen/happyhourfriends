import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { venues, cities } from "@/db/schema";
import { SiteHealthRow, type SiteHealthVenue } from "@/components/admin/site-health-row";

export const dynamic = "force-dynamic";

// Worst-first: dead/parked/cert problems are actionable; http_error/unreachable can be transient.
const ORDER = ["dns_dead", "parked", "expired_cert", "invalid_cert", "http_error", "unreachable"];

export default async function SiteHealthPage() {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      cityName: cities.name,
      state: cities.state,
      websiteUrl: venues.websiteUrl,
      health: venues.siteHealth,
      detail: venues.siteHealthDetail,
      suggestedUrl: venues.siteHealthSuggestedUrl,
      checkedAt: venues.siteHealthCheckedAt,
    })
    .from(venues)
    .leftJoin(cities, eq(venues.cityId, cities.id))
    .where(
      and(
        isNull(venues.deletedAt),
        // Broken set only: probed and not healthy. `blocked` (bot walls) are not broken.
        sql`${venues.siteHealth} IS NOT NULL`,
        notInArray(venues.siteHealth, ["ok", "blocked"]),
      ),
    )
    .limit(1000);

  const items: SiteHealthVenue[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    cityName: r.cityName,
    state: r.state,
    websiteUrl: r.websiteUrl,
    health: r.health,
    detail: r.detail,
    suggestedUrl: r.suggestedUrl,
    checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
  }));
  items.sort((a, b) => {
    const oa = ORDER.indexOf(a.health ?? "");
    const ob = ORDER.indexOf(b.health ?? "");
    return (oa < 0 ? 99 : oa) - (ob < 0 ? 99 : ob) || (a.cityName ?? "").localeCompare(b.cityName ?? "");
  });

  const withSuggestion = items.filter((v) => v.suggestedUrl).length;

  return (
    <div className="px-4 py-6">
      <h1 className="text-lg font-medium text-text-primary">Site health</h1>
      <p className="mt-1 text-sm text-text-muted">
        Venues whose stored website link is broken. Accept the suggested fix, edit the URL, or
        remove the venue — each publishes to prod in one click. Refresh this queue with{" "}
        <code className="rounded bg-bg-elevated px-1">pnpm audit:venue-sites --persist</code>.
      </p>
      <p className="mt-1 text-xs text-text-muted">
        {items.length} broken · {withSuggestion} with an auto-suggested fix
      </p>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">
          No broken links. Run the audit with <code className="rounded bg-bg-elevated px-1">--persist</code>{" "}
          to populate this queue.
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-text-muted">
              <th className="px-3 py-2 font-medium">Venue</th>
              <th className="px-3 py-2 font-medium">Problem</th>
              <th className="px-3 py-2 font-medium">Fix</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <SiteHealthRow key={v.id} venue={v} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
