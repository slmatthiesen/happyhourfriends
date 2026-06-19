import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { venues, cities, happyHours } from "@/db/schema";
import { BareWindowRow, type BareVenue, type BareWindow } from "@/components/admin/bare-window-row";

export const dynamic = "force-dynamic";

/**
 * Bare-window bucket: venues we extracted that have a LIVE happy-hour window but ZERO
 * offerings — usually because the deals live in a menu image/PDF the extractor couldn't
 * fully read. Nothing we attempt is lost: each lands here for the operator to re-extract
 * (paste the menu URL) or add the deals by hand.
 */
export default async function BareWindowsPage() {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      type: venues.type,
      cityName: cities.name,
      websiteUrl: venues.websiteUrl,
      hhPageUrl: venues.hhPageUrl,
    })
    .from(venues)
    .leftJoin(cities, eq(venues.cityId, cities.id))
    .where(
      and(
        eq(venues.status, "active"),
        isNull(venues.deletedAt),
        sql`EXISTS (SELECT 1 FROM happy_hours h WHERE h.venue_id = ${venues.id} AND h.active = true AND h.deleted_at IS NULL)`,
        sql`NOT EXISTS (
          SELECT 1 FROM happy_hours h2
          JOIN offerings o ON o.happy_hour_id = h2.id AND o.active = true AND o.deleted_at IS NULL
          WHERE h2.venue_id = ${venues.id} AND h2.active = true AND h2.deleted_at IS NULL)`,
      ),
    )
    .orderBy(cities.name, venues.name)
    .limit(500);

  const ids = rows.map((r) => r.id);
  const wins = ids.length
    ? await db
        .select({
          id: happyHours.id,
          venueId: happyHours.venueId,
          days: happyHours.daysOfWeek,
          start: happyHours.startTime,
          end: happyHours.endTime,
          allDay: happyHours.allDay,
          sourceUrl: happyHours.sourceUrl,
        })
        .from(happyHours)
        .where(and(inArray(happyHours.venueId, ids), eq(happyHours.active, true), isNull(happyHours.deletedAt)))
    : [];

  const winsByVenue = new Map<string, BareWindow[]>();
  for (const w of wins) {
    const list = winsByVenue.get(w.venueId) ?? [];
    list.push({ id: w.id, daysOfWeek: w.days, startTime: w.start, endTime: w.end, allDay: w.allDay, sourceUrl: w.sourceUrl });
    winsByVenue.set(w.venueId, list);
  }

  const items: BareVenue[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    cityName: r.cityName,
    websiteUrl: r.websiteUrl,
    hhPageUrl: r.hhPageUrl,
    windows: winsByVenue.get(r.id) ?? [],
  }));

  return (
    <main className="mt-8">
      <h1 className="text-3xl text-text-primary" style={{ fontFamily: "var(--font-serif)" }}>
        Bare windows
      </h1>
      <p className="mt-2 text-text-muted">
        {items.length} venue(s) with a live happy-hour window but <strong>no deals</strong> — the
        window extracted but the offerings didn&apos;t (usually a menu image/PDF the extractor
        couldn&apos;t fully read). <strong>Re-extract</strong> from a menu URL you paste, or{" "}
        <strong>add the deals</strong> by hand.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-elevated text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Venue</th>
              <th className="px-3 py-2 font-medium">Live window(s), 0 deals</th>
              <th className="px-3 py-2 font-medium">Fix</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <BareWindowRow key={v.id} venue={v} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
