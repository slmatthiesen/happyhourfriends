import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { MIN_VENUES_PER_NEIGHBORHOOD } from "@/lib/geo/assignNeighborhoods";
import {
  cities,
  happyHours,
  neighborhoods,
  offerings,
  tags,
  venues,
  venueSignals,
  venueTags,
} from "@/db/schema";

type CityRow = typeof cities.$inferSelect;
type VenueRow = typeof venues.$inferSelect;

/**
 * Public-listing visibility predicate (Build A — dead-end stub suppression). Hides venues a
 * script/operator marked status='no_happy_hour': no alcohol, or a zero-HH cuisine, and no active
 * happy hour — they pad the list and make the product read as empty. Applied to PUBLIC queries
 * (city/neighborhood lists + landing counts) ONLY; admin queries omit it so operators still see
 * and can recover them. The persist/apply path flips status back to 'active' the instant an
 * active HH lands, so suppression never traps data. See lib/places/stubGate.
 */
const PUBLIC_VISIBLE = ne(venues.status, "no_happy_hour");
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
  /** Venue coordinates (WGS84). Drives the client-side "Closest to me" sort. */
  lat: number | null;
  lng: number | null;
}

export interface CityListItem {
  id: string;
  slug: string;
  name: string;
  state: string;
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
 *
 * Wrapped in `unstable_cache` (see `listCities` below): the landing page is
 * `force-dynamic` (it can't prerender at build without a reachable DB), so without
 * this the grouped aggregate would run on *every* visit. These counts change only a
 * handful of times a day (seed/enrich/admin apply), so we cache the result in Next's
 * shared server-side data cache for a day and serve it to every visitor. Tagged
 * `cities-summary` so it can be invalidated on demand via `revalidateTag` later.
 */
async function listCitiesUncached(): Promise<CityListItem[]> {
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
    .where(eq(cities.status, "live"))
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
    .where(and(isNull(venues.deletedAt), PUBLIC_VISIBLE))
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
 * Cached entry point used by the landing page. The result is shared across all
 * visitors and refreshed at most once a day (or on demand via
 * `revalidateTag("cities-summary")`). `listCities` takes no arguments, so a static
 * key part is enough.
 */
export const listCities = unstable_cache(listCitiesUncached, ["cities-summary"], {
  tags: ["cities-summary"],
  revalidate: 86_400, // 1 day
});

/**
 * A neighborhood is only surfaced once it has at least this many venues — a lone
 * venue in its own area reads as noise, not a useful filter. Canonical definition
 * lives with the assignment logic (lib/geo/assignNeighborhoods), which uses the same
 * threshold to gate Google-name-primary assignment so DB state matches what we show.
 */
export { MIN_VENUES_PER_NEIGHBORHOOD };

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
      and(eq(venues.neighborhoodId, neighborhoods.id), isNull(venues.deletedAt), PUBLIC_VISIBLE),
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

/**
 * Resolve a city by its URL path parts. State is matched case-insensitively because
 * the URL slug is lowercased ("wa") while the column stores the canonical code ("WA").
 * Does NOT filter on status — callers gate visibility explicitly (public pages require
 * status === "live"; internal callers may want non-live rows).
 */
export async function getCityByPath(
  stateSlug: string,
  citySlug: string,
): Promise<CityRow | null> {
  const [city] = await db
    .select()
    .from(cities)
    .where(
      and(
        sql`lower(${cities.state}) = ${stateSlug.toLowerCase()}`,
        eq(cities.slug, citySlug),
      ),
    )
    .limit(1);
  return city ?? null;
}

/**
 * Most recent `updated_at` across a city's non-deleted venues — the "data freshness"
 * signal shown beside the city clock and emitted as the city's sitemap `lastmod`.
 * Optionally scoped to a single neighborhood. Returns null when the city has no venues.
 */
export async function getCityLastUpdatedAt(
  cityId: string,
  neighborhoodId?: string,
): Promise<Date | null> {
  const [row] = await db
    // postgres.js doesn't apply the column's timestamp parser to a raw aggregate, so
    // `max()` arrives as a string — type it honestly and coerce to a Date below.
    .select({ max: sql<string | null>`max(${venues.updatedAt})` })
    .from(venues)
    .where(
      and(
        eq(venues.cityId, cityId),
        isNull(venues.deletedAt),
        ...(neighborhoodId ? [eq(venues.neighborhoodId, neighborhoodId)] : []),
      ),
    );
  return row?.max ? new Date(row.max) : null;
}

/** Resolve a city by bare slug alone (no state). Used by the submit flow where only a
 *  ?city= slug is in scope. Ambiguous across states in theory, but the submit link only
 *  needs a display name + back-path. */
export async function getCityBySlugAny(slug: string): Promise<CityRow | null> {
  const [city] = await db.select().from(cities).where(eq(cities.slug, slug)).limit(1);
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
      lat: venues.lat,
      lng: venues.lng,
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
        PUBLIC_VISIBLE,
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
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
    };
  });
}

export interface VenueDetail extends VenueRow {
  neighborhoodName: string | null;
  happyHours: (HappyHourRow & { offerings: OfferingRow[] })[];
  signalCount: number;
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

  const [signalRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(venueSignals)
    .where(and(eq(venueSignals.venueId, venue.id), eq(venueSignals.kind, "good")));

  return {
    ...venue,
    neighborhoodName: hood?.name ?? null,
    happyHours: hours.map((h) => ({ ...h, offerings: offersByHour.get(h.id) ?? [] })),
    signalCount: Number(signalRow?.n ?? 0),
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
