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
import type { OpenPeriod } from "@/lib/geo/timezone";
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
export const cities = pgTable(
  "cities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    state: text("state").notNull(),
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
  },
  (table) => [
    uniqueIndex("cities_state_slug_unique").on(table.state, table.slug),
  ],
);

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
    // Provenance flag: true when this polygon was imported as a coarse gap-filler layer
    // (e.g. council wards). Retained for metadata/audit purposes only — assignment ranking
    // is driven by `tier` + `recognizability`, not by this flag.
    isFallback: boolean("is_fallback").notNull().default(false),
    // Two-tier model for friendly listings. `tier` distinguishes a fine named
    // neighborhood (Arcadia, Sam Hughes) from a coarse rollup district (urban village,
    // Census place, or generated cardinal zone). `recognizability` is a non-hallucinated
    // 0–2 score derived at import from OSM signals (wikidata/wikipedia presence, place
    // tier) — high means "a name locals actually say". Assignment prefers a recognizable
    // fine neighborhood, else rolls a venue up to its coarse district. See
    // lib/geo/recognizability.ts and docs/superpowers/specs/2026-06-01-friendly-neighborhood-recognizability-design.md.
    tier: text("tier", { enum: ["fine", "coarse"] })
      .notNull()
      .default("fine"),
    recognizability: smallint("recognizability").notNull().default(0),
    // Metro-scope gate. An operator can mark a neighborhood out-of-scope (e.g. far
    // residential villages that aren't happy-hour destinations) — discovery skips
    // candidates inside it and listings hide its venues. Default true; flip to false to
    // drop an area WITHOUT deleting its polygon (reversible, collision-safe re-inclusion).
    inScope: boolean("in_scope").notNull().default(true),
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
    googleNeighborhood: text("google_neighborhood"),
    otherUrl: text("other_url"),
    googlePlaceId: text("google_place_id").unique(), // canonical dedup key
    phone: text("phone"),
    // Google Places general price tier 1–4 (INEXPENSIVE…VERY_EXPENSIVE). The venue's
    // overall expensiveness, NOT its happy-hour pricing — used only as a fallback for
    // the price column when we have no extracted HH offering price.
    priceLevel: smallint("price_level"),
    // Locally-stored hero image (downloaded from Google Place Photos so we don't re-hit
    // the API per render). Relative public path, e.g. /uploads/venues/<id>.jpg.
    heroImageUrl: text("hero_image_url"),
    // Venue operating hours (Google Place Details regularOpeningHours), normalized to
    // ISO weekdays. Drives close-time bounding for "happening now" on all-day / until-
    // close windows. Null when unknown → such windows can't be shown active. Typed with
    // .$type so VenueRow.hoursJson is OpenPeriod[]|null (not unknown) and flows cleanly
    // through the venue queries into isWindowActive.
    hoursJson: jsonb("hours_json").$type<OpenPeriod[]>(),
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
 * happy_hours — one row per WINDOW, applied to a cluster of ISO weekdays
 * (days_of_week, 1=Mon … 7=Sun). "Mon–Fri 3–6pm" is a single row with
 * days_of_week = {1,2,3,4,5}, not five rows (operator decision 2026-05 — per-day rows
 * were redundant + costly). Times are venue-local. crosses_midnight is a STORED
 * generated column. end_time is nullable for "until close". A CHECK enforces a
 * non-empty array whose values are all 1..7.
 */
export const happyHours = pgTable(
  "happy_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    daysOfWeek: smallint("days_of_week").array().notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"), // null = "until close"
    allDay: boolean("all_day").notNull().default(false),
    crossesMidnight: boolean("crosses_midnight").generatedAlwaysAs(
      sql`(end_time < start_time)`,
    ),
    locationWithinVenue: locationWithinVenue("location_within_venue")
      .notNull()
      .default("all"),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
    notes: text("notes"),
    // active=false → captured but HIDDEN pending review (the realness gate's lever).
    active: boolean("active").notNull().default(true),
    // Inputs the pure realness gate (lib/places/realnessGate) re-runs over stored rows.
    extractConfidence: numeric("extract_confidence"),
    // timeKnown=false → the deal was captured with NO usable time bound (coerced to
    // all-day so it could store); the gate hides these until reviewed.
    timeKnown: boolean("time_known").notNull().default(true),
    sourceUrl: text("source_url"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    // Unique among non-deleted rows (PRD §3.3). days_of_week is stored sorted so the
    // array compares as a stable natural key. NOTE: migration 0019 recreates this index
    // with NULLS NOT DISTINCT so all-day / open-until-close windows (null start/end) actually
    // collide and dedupe — drizzle 0.45's uniqueIndex DSL can't express NULLS NOT DISTINCT,
    // so it lives only in the migration, not here.
    uniqueIndex("happy_hours_natural_uq")
      .on(t.venueId, t.daysOfWeek, t.startTime, t.endTime, t.locationWithinVenue)
      .where(sql`deleted_at IS NULL`),
    index("happy_hours_venue_idx").on(t.venueId),
    check(
      "happy_hours_dow_iso",
      sql`array_length(days_of_week, 1) >= 1 AND 1 <= ALL(days_of_week) AND 7 >= ALL(days_of_week)`,
    ),
    check(
      // A non-all-day window needs at LEAST one time bound. This deliberately admits
      // "open until X" (start NULL, end set) — a common, legitimate window shape whose
      // start is the venue's open time. See the capture-everything design (2026-05-31).
      "happy_hours_all_day_shape",
      sql`
        (all_day = true  AND start_time IS NULL AND end_time IS NULL)
        OR
        (all_day = false AND (start_time IS NOT NULL OR end_time IS NOT NULL))
      `,
    ),
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
