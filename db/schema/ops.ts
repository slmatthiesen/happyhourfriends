import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./columns";
import { aiStage, seedOutcome } from "./enums";
import { cities, venues } from "./core";
import { editSubmissions } from "./moderation";

/**
 * ai_usage_ledger — append-only spend log. Budget enforcement (lib/ai/budget.ts)
 * sums cost_cents for the current month before each paid call. city_id enables
 * per-city accounting at scale; prompt_hash pins which prompt version produced the
 * call (PRD §4.7 — required for debuggability).
 */
export const aiUsageLedger = pgTable(
  "ai_usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: date("month").notNull(), // first of month
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    stage: aiStage("stage").notNull(),
    submissionId: uuid("submission_id").references(() => editSubmissions.id), // nullable
    cityId: uuid("city_id").references(() => cities.id), // nullable; per-city spend
    promptHash: text("prompt_hash"), // content hash of the prompt template used
    ...timestamps,
  },
  (t) => [
    index("ai_usage_ledger_month_stage_idx").on(t.month, t.stage),
    index("ai_usage_ledger_city_month_idx").on(t.cityId, t.month),
  ],
);

/**
 * audit_log — every write to venues/happy_hours/offerings records here for revert.
 * actor is 'ai' | 'admin:<email>' | 'fingerprint:<hash>'.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id").notNull(),
    beforeJsonb: jsonb("before_jsonb"),
    afterJsonb: jsonb("after_jsonb"),
    actor: text("actor").notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [index("audit_log_row_idx").on(t.tableName, t.rowId)],
);

/**
 * seed_candidates — operational, not public. google_place_id is the unique key;
 * re-running discovery for a city is idempotent on it (no aggressive name dedup).
 */
export const seedCandidates = pgTable("seed_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  cityId: uuid("city_id")
    .notNull()
    .references(() => cities.id),
  name: text("name").notNull(),
  googlePlaceId: text("google_place_id").unique(),
  address: text("address"),
  lat: numeric("lat", { precision: 10, scale: 7 }),
  lng: numeric("lng", { precision: 10, scale: 7 }),
  sourceUrl: text("source_url"),
  // Google Places discovery metadata (captured by seed:discover, used for triage +
  // pre-enrich filtering). All nullable — curated-page candidates have none of it.
  primaryType: text("primary_type"),
  types: text("types").array(),
  websiteUrl: text("website_url"),
  googleNeighborhood: text("google_neighborhood"),
  rating: numeric("rating", { precision: 2, scale: 1 }),
  userRatingCount: integer("user_rating_count"),
  priceLevel: integer("price_level"),
  /** Google businessStatus: OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY. */
  businessStatus: text("business_status"),
  // Captured at discovery (Atmosphere mask) so enrich never needs a per-candidate
  // Place Details call — Google bills searchNearby per TILE but Place Details per
  // CANDIDATE, so moving these here is the big cost lever (see seed-discover mask).
  /** Boolean(servesBeer || servesWine || servesCocktails) — the pre-enrich alcohol gate. */
  servesAlcohol: boolean("serves_alcohol"),
  /** Venue operating hours as ISO-weekday OpenPeriod[] (parseRegularOpeningHours), or null. */
  hoursJson: jsonb("hours_json"),
  /** Google nationalPhoneNumber. */
  phone: text("phone"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  outcome: seedOutcome("outcome"),
  resultingVenueId: uuid("resulting_venue_id").references(() => venues.id),
  ...timestamps,
});
