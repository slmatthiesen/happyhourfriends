import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cities,
  happyHours,
  neighborhoods,
  offerings,
  tags,
  venues,
  venueTags,
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
    | "type"
    | "priceLevel"
    | "heroImageUrl"
    | "hoursJson"
  > {
  neighborhoodName: string | null;
  neighborhoodSlug: string | null;
  happyHours: HappyHourRow[];
  tags: string[];
  /** Up to a handful of representative deals for the table preview column. */
  offerings: { label: string; priceCents: number | null }[];
  /** Cheapest priced offering across this venue's hours (fallback price signal). */
  minPriceCents: number | null;
}

export interface CityListItem {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  /** City centroid, used to find the nearest city from a visitor's location. */
  centerLat: number | null;
  centerLng: number | null;
  status: CityRow["status"];
  /** Active venues (non-deleted) with at least one active happy hour. */
  venueCount: number;
  /** Active venues (non-deleted) with NO active happy hour — "stubs" awaiting data. */
  stubCount: number;
}

/**
 * All cities for the landing-page picker, with a live count of venues that have
 * happy hours so the list reflects which cities actually have data. Two small
 * round trips; the count is grouped in SQL.
 */
export async function listCities(): Promise<CityListItem[]> {
  const rows = await db
    .select({
      id: cities.id,
      slug: cities.slug,
      name: cities.name,
      state: cities.state,
      centerLat: cities.centerLat,
      centerLng: cities.centerLng,
      status: cities.status,
    })
    .from(cities)
    .orderBy(asc(cities.name));

  if (rows.length === 0) return [];

  // Per-city split: venues WITH an active happy hour ("data") vs WITHOUT ("stubs").
  // LEFT JOIN with the active-hh predicate in the ON clause — rows where
  // happy_hours.id is null are stubs; rows where it's not null are venues with data.
  // count(distinct venues.id) collapses multi-row venues back to one each.
  const counts = await db
    .select({
      cityId: venues.cityId,
      withHours:
        sql<number>`count(distinct ${venues.id}) filter (where ${happyHours.id} is not null)`.mapWith(
          Number,
        ),
      stubs:
        sql<number>`count(distinct ${venues.id}) filter (where ${happyHours.id} is null)`.mapWith(
          Number,
        ),
    })
    .from(venues)
    .leftJoin(
      happyHours,
      and(
        eq(happyHours.venueId, venues.id),
        eq(happyHours.active, true),
        isNull(happyHours.deletedAt),
      ),
    )
    .where(isNull(venues.deletedAt))
    .groupBy(venues.cityId);
  const countByCity = new Map(
    counts.map((c) => [c.cityId, { withHours: c.withHours, stubs: c.stubs }]),
  );

  return rows.map((r) => {
    const c = countByCity.get(r.id);
    return {
      ...r,
      centerLat: r.centerLat == null ? null : Number(r.centerLat),
      centerLng: r.centerLng == null ? null : Number(r.centerLng),
      venueCount: c?.withHours ?? 0,
      stubCount: c?.stubs ?? 0,
    };
  });
}

/**
 * A neighborhood is only surfaced once it has at least this many venues — a lone
 * venue in its own area reads as noise, not a useful filter. Tunable; the operator
 * is still feeling out the right rule (2026-05).
 */
export const MIN_VENUES_PER_NEIGHBORHOOD = 2;

export async function listNeighborhoods(cityId: string) {
  return db
    .select({
      id: neighborhoods.id,
      name: neighborhoods.name,
      slug: neighborhoods.slug,
    })
    .from(neighborhoods)
    .leftJoin(
      venues,
      and(eq(venues.neighborhoodId, neighborhoods.id), isNull(venues.deletedAt)),
    )
    .where(eq(neighborhoods.cityId, cityId))
    .groupBy(neighborhoods.id, neighborhoods.name, neighborhoods.slug)
    .having(sql`count(${venues.id}) >= ${MIN_VENUES_PER_NEIGHBORHOOD}`)
    .orderBy(asc(neighborhoods.name));
}

export async function getNeighborhoodBySlug(cityId: string, slug: string) {
  const [n] = await db
    .select()
    .from(neighborhoods)
    .where(and(eq(neighborhoods.cityId, cityId), eq(neighborhoods.slug, slug)))
    .limit(1);
  return n ?? null;
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
      // Fall back to the city's tz so a venue with a null timezone still powers
      // "happening now" — never let a missing venue tz silently disable the feature.
      timezone: sql<string>`coalesce(${venues.timezone}, ${cities.defaultTimezone})`,
      type: venues.type,
      priceLevel: venues.priceLevel,
      heroImageUrl: venues.heroImageUrl,
      hoursJson: venues.hoursJson,
      neighborhoodName: neighborhoods.name,
      neighborhoodSlug: neighborhoods.slug,
    })
    .from(venues)
    .innerJoin(cities, eq(venues.cityId, cities.id))
    .leftJoin(neighborhoods, eq(venues.neighborhoodId, neighborhoods.id))
    .where(
      and(
        eq(venues.cityId, cityId),
        isNull(venues.deletedAt),
        // Hide venues in out-of-scope neighborhoods (operator metro-scope gate). Keep
        // unassigned venues (null neighborhood) and those in in_scope neighborhoods.
        or(isNull(venues.neighborhoodId), eq(neighborhoods.inScope, true)),
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
    .orderBy(asc(happyHours.allDay), asc(happyHours.startTime));

  const byVenue = new Map<string, HappyHourRow[]>();
  for (const h of hours) {
    const list = byVenue.get(h.venueId);
    if (list) list.push(h);
    else byVenue.set(h.venueId, [h]);
  }

  const tagRows = await db
    .select({ venueId: venueTags.venueId, label: tags.label })
    .from(venueTags)
    .innerJoin(tags, eq(venueTags.tagId, tags.id))
    .where(inArray(venueTags.venueId, venueIds));
  const tagsByVenue = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByVenue.get(t.venueId);
    if (list) list.push(t.label);
    else tagsByVenue.set(t.venueId, [t.label]);
  }

  // Offerings → per-venue deal previews + min price. Mapped back to the venue via
  // each offering's happy_hour. One round trip; fine at city scale.
  const hourToVenue = new Map<string, string>();
  for (const h of hours) hourToVenue.set(h.id, h.venueId);
  const hourIds = hours.map((h) => h.id);
  const offerRows = hourIds.length
    ? await db
        .select({
          happyHourId: offerings.happyHourId,
          name: offerings.name,
          category: offerings.category,
          priceCents: offerings.priceCents,
        })
        .from(offerings)
        .where(
          and(
            inArray(offerings.happyHourId, hourIds),
            eq(offerings.active, true),
            isNull(offerings.deletedAt),
          ),
        )
    : [];
  const offersByVenue = new Map<string, VenueListItem["offerings"]>();
  const minPriceByVenue = new Map<string, number>();
  const seenLabel = new Map<string, Set<string>>();
  for (const o of offerRows) {
    const venueId = hourToVenue.get(o.happyHourId);
    if (!venueId) continue;
    const label = (o.name ?? o.category).replace(/_/g, " ");
    const seen = seenLabel.get(venueId) ?? new Set<string>();
    if (!seen.has(label)) {
      seen.add(label);
      seenLabel.set(venueId, seen);
      const list = offersByVenue.get(venueId) ?? [];
      list.push({ label, priceCents: o.priceCents });
      offersByVenue.set(venueId, list);
    }
    if (o.priceCents != null) {
      const cur = minPriceByVenue.get(venueId);
      if (cur == null || o.priceCents < cur) minPriceByVenue.set(venueId, o.priceCents);
    }
  }

  // Suppress neighborhoods with fewer than MIN_VENUES_PER_NEIGHBORHOOD venues — a
  // single-venue neighborhood isn't a useful label or filter (operator rule 2026-05).
  const hoodCount = new Map<string, number>();
  for (const r of rows) {
    if (r.neighborhoodSlug) {
      hoodCount.set(r.neighborhoodSlug, (hoodCount.get(r.neighborhoodSlug) ?? 0) + 1);
    }
  }

  return rows.map((r) => {
    const showHood =
      r.neighborhoodSlug != null &&
      (hoodCount.get(r.neighborhoodSlug) ?? 0) >= MIN_VENUES_PER_NEIGHBORHOOD;
    return {
      ...r,
      neighborhoodName: showHood ? r.neighborhoodName : null,
      neighborhoodSlug: showHood ? r.neighborhoodSlug : null,
      happyHours: byVenue.get(r.id) ?? [],
      tags: tagsByVenue.get(r.id) ?? [],
      offerings: offersByVenue.get(r.id) ?? [],
      minPriceCents: minPriceByVenue.get(r.id) ?? null,
    };
  });
}

export interface VenueDetail extends VenueRow {
  neighborhoodName: string | null;
  happyHours: (HappyHourRow & { offerings: OfferingRow[] })[];
}

/** Assemble a VenueDetail (neighborhood name + active-or-not hours + offerings) from
 *  a venue row. Shared by the slug and id lookups so both return identical shapes. */
async function assembleVenueDetail(venue: VenueRow): Promise<VenueDetail> {
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
    .orderBy(asc(happyHours.allDay), asc(happyHours.startTime));

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
  return assembleVenueDetail(venue);
}

/** Like getVenueBySlug but keyed on the venue id — used by the interpret stage, which
 *  only has the target venue's id (not its city + slug). */
export async function getVenueDetailById(
  venueId: string,
): Promise<VenueDetail | null> {
  const [venue] = await db
    .select()
    .from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt)))
    .limit(1);
  if (!venue) return null;
  return assembleVenueDetail(venue);
}
