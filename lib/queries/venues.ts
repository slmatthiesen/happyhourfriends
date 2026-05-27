import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cities,
  happyHours,
  neighborhoods,
  offerings,
  venues,
} from "@/db/schema";

type CityRow = typeof cities.$inferSelect;
type VenueRow = typeof venues.$inferSelect;
export type HappyHourRow = typeof happyHours.$inferSelect;
export type OfferingRow = typeof offerings.$inferSelect;

export interface VenueListItem
  extends Pick<
    VenueRow,
    | "id"
    | "name"
    | "slug"
    | "address"
    | "status"
    | "dataCompleteness"
    | "promotionTier"
    | "timezone"
  > {
  neighborhoodName: string | null;
  neighborhoodSlug: string | null;
  happyHours: HappyHourRow[];
}

export async function listNeighborhoods(cityId: string) {
  return db
    .select({
      id: neighborhoods.id,
      name: neighborhoods.name,
      slug: neighborhoods.slug,
    })
    .from(neighborhoods)
    .where(eq(neighborhoods.cityId, cityId))
    .orderBy(asc(neighborhoods.name));
}

export async function getCityBySlug(slug: string): Promise<CityRow | null> {
  const [city] = await db
    .select()
    .from(cities)
    .where(eq(cities.slug, slug))
    .limit(1);
  return city ?? null;
}

/**
 * Venues for a city with their neighborhood name and active happy-hour windows.
 * Two round trips (venues, then their hours) — fine at city scale, avoids N+1.
 */
export async function listVenuesForCity(
  cityId: string,
  neighborhoodSlug?: string,
): Promise<VenueListItem[]> {
  const rows = await db
    .select({
      id: venues.id,
      name: venues.name,
      slug: venues.slug,
      address: venues.address,
      status: venues.status,
      dataCompleteness: venues.dataCompleteness,
      promotionTier: venues.promotionTier,
      timezone: venues.timezone,
      neighborhoodName: neighborhoods.name,
      neighborhoodSlug: neighborhoods.slug,
    })
    .from(venues)
    .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id))
    .where(
      and(
        eq(venues.cityId, cityId),
        isNull(venues.deletedAt),
        neighborhoodSlug ? eq(neighborhoods.slug, neighborhoodSlug) : undefined,
      ),
    )
    .orderBy(asc(venues.name));

  if (rows.length === 0) return [];

  const venueIds = rows.map((r) => r.id);
  const hours = await db
    .select()
    .from(happyHours)
    .where(
      and(
        inArray(happyHours.venueId, venueIds),
        eq(happyHours.active, true),
        isNull(happyHours.deletedAt),
      ),
    )
    .orderBy(asc(happyHours.dayOfWeek), asc(happyHours.startTime));

  const byVenue = new Map<string, HappyHourRow[]>();
  for (const h of hours) {
    const list = byVenue.get(h.venueId);
    if (list) list.push(h);
    else byVenue.set(h.venueId, [h]);
  }

  return rows.map((r) => ({ ...r, happyHours: byVenue.get(r.id) ?? [] }));
}

export interface VenueDetail extends VenueRow {
  neighborhoodName: string | null;
  happyHours: (HappyHourRow & { offerings: OfferingRow[] })[];
}

export async function getVenueBySlug(
  cityId: string,
  slug: string,
): Promise<VenueDetail | null> {
  const [venue] = await db
    .select()
    .from(venues)
    .where(
      and(eq(venues.cityId, cityId), eq(venues.slug, slug), isNull(venues.deletedAt)),
    )
    .limit(1);
  if (!venue) return null;

  const [hood] = venue.neighborhoodId
    ? await db
        .select({ name: neighborhoods.name })
        .from(neighborhoods)
        .where(eq(neighborhoods.id, venue.neighborhoodId))
        .limit(1)
    : [];

  const hours = await db
    .select()
    .from(happyHours)
    .where(and(eq(happyHours.venueId, venue.id), isNull(happyHours.deletedAt)))
    .orderBy(asc(happyHours.dayOfWeek), asc(happyHours.startTime));

  const hourIds = hours.map((h) => h.id);
  const offers = hourIds.length
    ? await db
        .select()
        .from(offerings)
        .where(
          and(inArray(offerings.happyHourId, hourIds), isNull(offerings.deletedAt)),
        )
    : [];

  const offersByHour = new Map<string, OfferingRow[]>();
  for (const o of offers) {
    const list = offersByHour.get(o.happyHourId);
    if (list) list.push(o);
    else offersByHour.set(o.happyHourId, [o]);
  }

  return {
    ...venue,
    neighborhoodName: hood?.name ?? null,
    happyHours: hours.map((h) => ({ ...h, offerings: offersByHour.get(h.id) ?? [] })),
  };
}
