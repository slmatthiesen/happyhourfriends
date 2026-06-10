import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cities, dataAudit, happyHours, offerings, venues } from "@/db/schema";
import type { AnomalyFlag } from "@/lib/audit/anomalyRules";
import {
  FlagReviewRow,
  type FlaggedOffering,
  type FlaggedVenue,
  type FlaggedWindow,
} from "@/components/admin/flag-review-row";

export const dynamic = "force-dynamic";

export default async function FlagsPage() {
  const rows = await db
    .select({
      venueId: venues.id,
      name: venues.name,
      websiteUrl: venues.websiteUrl,
      cityName: cities.name,
      flags: dataAudit.flags,
    })
    .from(dataAudit)
    .innerJoin(venues, eq(dataAudit.venueId, venues.id))
    .leftJoin(cities, eq(venues.cityId, cities.id))
    .where(
      and(
        sql`jsonb_array_length(${dataAudit.flags}) > 0`,
        notInArray(dataAudit.resolution, ["operator_kept", "operator_hidden", "clean"]),
        eq(venues.status, "active"),
        isNull(venues.deletedAt),
      ),
    )
    .limit(500);

  const venueIds = rows.map((r) => r.venueId);
  const windowRows =
    venueIds.length === 0
      ? []
      : await db
          .select({
            id: happyHours.id,
            venueId: happyHours.venueId,
            daysOfWeek: happyHours.daysOfWeek,
            startTime: happyHours.startTime,
            endTime: happyHours.endTime,
            allDay: happyHours.allDay,
            sourceUrl: happyHours.sourceUrl,
            offerings: sql<FlaggedOffering[]>`coalesce(
              json_agg(json_build_object(
                'kind', ${offerings.kind},
                'category', ${offerings.category},
                'name', ${offerings.name},
                'priceCents', ${offerings.priceCents},
                'originalPriceCents', ${offerings.originalPriceCents},
                'currencyCode', ${offerings.currencyCode},
                'description', ${offerings.description},
                'conditions', ${offerings.conditions}
              ) ORDER BY ${offerings.kind}, ${offerings.name})
              FILTER (WHERE ${offerings.id} IS NOT NULL),
              '[]'
            )`,
          })
          .from(happyHours)
          .leftJoin(
            offerings,
            and(eq(offerings.happyHourId, happyHours.id), eq(offerings.active, true), isNull(offerings.deletedAt)),
          )
          .where(and(inArray(happyHours.venueId, venueIds), eq(happyHours.active, true), isNull(happyHours.deletedAt)))
          .groupBy(happyHours.id);

  const windowsByVenue = new Map<string, FlaggedWindow[]>();
  for (const w of windowRows) {
    const list = windowsByVenue.get(w.venueId) ?? [];
    list.push(w);
    windowsByVenue.set(w.venueId, list);
  }

  const items: FlaggedVenue[] = rows.map((r) => ({
    venueId: r.venueId,
    name: r.name,
    cityName: r.cityName,
    websiteUrl: r.websiteUrl,
    flags: (r.flags ?? []) as AnomalyFlag[],
    windows: windowsByVenue.get(r.venueId) ?? [],
  }));
  // Most-actionable first: auto-fixable flags, then flag count.
  items.sort((a, b) => {
    const aAuto = a.flags.some((f) => f.severity === "auto_fixable") ? 1 : 0;
    const bAuto = b.flags.some((f) => f.severity === "auto_fixable") ? 1 : 0;
    return bAuto - aAuto || b.flags.length - a.flags.length || a.name.localeCompare(b.name);
  });

  return (
    <main className="mt-8">
      <h1 className="text-3xl text-text-primary" style={{ fontFamily: "var(--font-serif)" }}>
        Flag review
      </h1>
      <p className="mt-2 text-text-muted">
        {items.length} venue(s) carrying unresolved <code>data_audit</code> flags. <strong>Keep</strong> marks
        the venue&apos;s data correct (the flags stop resurfacing); <strong>Hide</strong> flips one wrong window
        inactive (reversible from <code>/admin/audit</code>). Every verdict is audit-logged with its flag codes —
        codes that keep predicting &ldquo;hide&rdquo; become future auto-gate rules.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {items.map((v) => (
          <FlagReviewRow key={v.venueId} venue={v} />
        ))}
      </div>
    </main>
  );
}
