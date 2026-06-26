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
  // Discovery-channel attribution (cost instrumentation, 2026-06-26): which Google channel
  // surfaced this candidate. The Nearby sweep is the expensive channel (~$0.040/tile × hundreds
  // of tiles in a dense city); HH-recall Text Search is cheap (~30 calls). Tagging both lets us
  // measure live-HH yield per channel — specifically how many live HH are reachable ONLY via the
  // sweep — so we can cap the Nearby budget with evidence instead of guessing. OR-merged across
  // re-runs (a later --resume-recall pass adds the recall flag without clearing nearby).
  seenViaNearby: boolean("seen_via_nearby").notNull().default(false),
  seenViaHhRecall: boolean("seen_via_hh_recall").notNull().default(false),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  outcome: seedOutcome("outcome"),
  resultingVenueId: uuid("resulting_venue_id").references(() => venues.id),
  ...timestamps,
});

/**
 * data_audit — one row per venue scanned by the data-anomaly audit (audit:data).
 * Idempotency ledger: audit:data skips venues already here unless --recheck.
 * flags = AnomalyFlag[] from lib/audit/anomalyRules.ts; agent_verdict = the in-session
 * sniff-test note; resolution tracks the lifecycle (scanned → clean | fixed | reported).
 */
export const dataAudit = pgTable(
  "data_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .unique()
      .references(() => venues.id, { onDelete: "cascade" }),
    auditedAt: timestamp("audited_at", { withTimezone: true }).notNull().defaultNow(),
    flags: jsonb("flags").notNull().default([]),
    agentVerdict: text("agent_verdict"),
    resolution: text("resolution").notNull().default("scanned"),
    /** Operator's free-text note when parking a venue in the /admin/flags "Further
     *  review" lane; kept after resolution as the dig-in record. */
    operatorNote: text("operator_note"),
    fixApplied: boolean("fix_applied").notNull().default(false),
    /** The exact rule inputs ({websiteUrl, hoursJson, windows}) at scan time. Operator
     *  keep/hide verdicts label THESE inputs — a hide then mutates the live rows, so
     *  without the snapshot the labeled example evaporates (eval:flags corpus). */
    auditInput: jsonb("audit_input"),
  },
  (t) => [index("data_audit_resolution_idx").on(t.resolution)],
);
