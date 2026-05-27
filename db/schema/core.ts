import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { multiPolygon4326, polygon4326, softDelete, timestamps } from "./columns";
import {
  cityStatus,
  dataCompleteness,
  hhExceptionType,
  locationWithinVenue,
  offeringCategory,
  offeringKind,
  promotionTier,
  tagCategory,
  venueStatus,
  venueType,
} from "./enums";

/**
 * cities — first-class entity enabling config-driven multi-city onboarding.
 * Tacoma is simply city #1. Carries currency + timezone + discovery bbox so a new
 * city is "insert one row, run the pipeline".
 */
export const cities = pgTable("cities", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  state: text("state"), // nullable for international cities
  country: char("country", { length: 2 }).notNull(), // ISO 3166-1 alpha-2
  defaultTimezone: text("default_timezone").notNull(), // IANA
  currencyCode: char("currency_code", { length: 3 }).notNull(), // ISO 4217
  centerLat: numeric("center_lat", { precision: 10, scale: 7 }),
  centerLng: numeric("center_lng", { precision: 10, scale: 7 }),
  bbox: polygon4326("bbox"), // discovery extent for Places search
  status: cityStatus("status").notNull().default("discovery"),
  seedConfig: jsonb("seed_config"), // per-city knobs: curated URLs, places params
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  ...timestamps,
});

export const chains = pgTable("chains", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  ...timestamps,
});

/**
 * neighborhoods — holds the PostGIS polygons. Venues are assigned to a neighborhood
 * by point-in-polygon (ST_Contains). parent_id nests vernacular areas under council
 * districts (most-specific match preferred).
 */
export const neighborhoods = pgTable(
  "neighborhoods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    polygon: multiPolygon4326("polygon"),
    source: text("source"),
    sourceUrl: text("source_url"),
    parentId: uuid("parent_id").references((): AnyPgColumn => neighborhoods.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("neighborhoods_city_slug_uq").on(t.cityId, t.slug),
    index("neighborhoods_polygon_gix").using("gist", t.polygon),
    index("neighborhoods_city_idx").on(t.cityId),
  ],
);

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(), // unique per city, not globally (see index below)
    address: text("address"),
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    timezone: text("timezone"), // IANA, venue-local; drives "happening now"
    neighborhoodId: uuid("neighborhood_id").references(() => neighborhoods.id),
    type: venueType("type"),
    chainId: uuid("chain_id").references(() => chains.id),
    websiteUrl: text("website_url"),
    otherUrl: text("other_url"),
    googlePlaceId: text("google_place_id").unique(), // canonical dedup key
    phone: text("phone"),
    status: venueStatus("status").notNull().default("active"),
    flaggedAt: timestamp("flagged_at", { withTimezone: true }),
    flagReason: text("flag_reason"),
    flagVoteCount: integer("flag_vote_count").notNull().default(0),
    promotionTier: promotionTier("promotion_tier").notNull().default("none"),
    promotionStartsAt: timestamp("promotion_starts_at", { withTimezone: true }),
    promotionEndsAt: timestamp("promotion_ends_at", { withTimezone: true }),
    dataCompleteness: dataCompleteness("data_completeness").notNull().default("stub"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    claimedByUserId: uuid("claimed_by_user_id"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("venues_city_slug_uq").on(t.cityId, t.slug),
    index("venues_city_idx").on(t.cityId),
    index("venues_neighborhood_idx").on(t.neighborhoodId),
    index("venues_status_idx").on(t.status),
  ],
);

/**
 * happy_hours — day_of_week is ISO 8601 (1=Mon … 7=Sun), enforced by a CHECK.
 * Times are venue-local. crosses_midnight is a STORED generated column so it can
 * never drift from the underlying times. end_time is nullable for "until close".
 */
export const happyHours = pgTable(
  "happy_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    dayOfWeek: smallint("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time"), // null = "until close"
    crossesMidnight: boolean("crosses_midnight").generatedAlwaysAs(
      sql`(end_time < start_time)`,
    ),
    locationWithinVenue: locationWithinVenue("location_within_venue")
      .notNull()
      .default("all"),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    sourceUrl: text("source_url"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    // Unique among non-deleted rows (PRD §3.3).
    uniqueIndex("happy_hours_natural_uq")
      .on(t.venueId, t.dayOfWeek, t.startTime, t.endTime, t.locationWithinVenue)
      .where(sql`deleted_at IS NULL`),
    index("happy_hours_venue_idx").on(t.venueId),
    check("happy_hours_dow_iso", sql`day_of_week BETWEEN 1 AND 7`),
  ],
);

export const happyHourExceptions = pgTable("happy_hour_exceptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  happyHourId: uuid("happy_hour_id")
    .notNull()
    .references(() => happyHours.id),
  exceptionDate: date("exception_date").notNull(),
  type: hhExceptionType("type").notNull(),
  overrideStartTime: time("override_start_time"),
  overrideEndTime: time("override_end_time"),
  reason: text("reason"),
  ...timestamps,
});

export const offerings = pgTable(
  "offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    happyHourId: uuid("happy_hour_id")
      .notNull()
      .references(() => happyHours.id),
    kind: offeringKind("kind").notNull(),
    category: offeringCategory("category").notNull(),
    name: text("name"),
    priceCents: integer("price_cents"),
    originalPriceCents: integer("original_price_cents"),
    discountCents: integer("discount_cents"),
    currencyCode: char("currency_code", { length: 3 }), // defaulted from city at insert
    description: text("description"),
    conditions: text("conditions"),
    locationRestriction: locationWithinVenue("location_restriction"),
    sourceUrl: text("source_url"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index("offerings_happy_hour_idx").on(t.happyHourId)],
);

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  category: tagCategory("category").notNull(),
  ...timestamps,
});

export const venueTags = pgTable(
  "venue_tags",
  {
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.venueId, t.tagId] })],
);
