CREATE TYPE "public"."ai_risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ai_stage" AS ENUM('classify', 'verify', 'reverify_cron', 'seed');--> statement-breakpoint
CREATE TYPE "public"."ai_verdict" AS ENUM('auto_apply', 'verify', 'queue_outreach', 'queue_admin', 'reject');--> statement-breakpoint
CREATE TYPE "public"."city_status" AS ENUM('discovery', 'enriching', 'live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."data_completeness" AS ENUM('stub', 'partial', 'complete', 'verified');--> statement-breakpoint
CREATE TYPE "public"."edit_target_type" AS ENUM('venue', 'happy_hour', 'offering', 'new_venue');--> statement-breakpoint
CREATE TYPE "public"."flag_resolution" AS ENUM('confirmed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."flag_target_type" AS ENUM('venue', 'happy_hour');--> statement-breakpoint
CREATE TYPE "public"."flag_type" AS ENUM('discontinued', 'price_increase', 'hours_changed', 'closed', 'other');--> statement-breakpoint
CREATE TYPE "public"."hh_exception_type" AS ENUM('closed', 'modified');--> statement-breakpoint
CREATE TYPE "public"."location_within_venue" AS ENUM('bar', 'patio', 'dining', 'all');--> statement-breakpoint
CREATE TYPE "public"."offering_category" AS ENUM('beer', 'wine', 'cocktail', 'spirit', 'appetizer', 'entree', 'dessert', 'other');--> statement-breakpoint
CREATE TYPE "public"."offering_kind" AS ENUM('food', 'drink', 'other');--> statement-breakpoint
CREATE TYPE "public"."promotion_tier" AS ENUM('none', 'highlight', 'pin', 'banner');--> statement-breakpoint
CREATE TYPE "public"."seed_outcome" AS ENUM('confirmed_hh', 'no_hh_found', 'no_hh_explicit', 'error');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'classifying', 'verifying', 'auto_applied', 'queued_outreach', 'queued_admin', 'applied', 'rejected', 'reverted', 'budget_exhausted');--> statement-breakpoint
CREATE TYPE "public"."tag_category" AS ENUM('vibe', 'amenity', 'cuisine', 'other');--> statement-breakpoint
CREATE TYPE "public"."venue_status" AS ENUM('active', 'closed', 'paused', 'no_happy_hour');--> statement-breakpoint
CREATE TYPE "public"."venue_type" AS ENUM('restaurant', 'bar', 'sports_bar', 'pub', 'dive_bar', 'wine_bar', 'brewery', 'tasting_room', 'cocktail_lounge', 'gastropub', 'club', 'cafe', 'hotel_bar', 'pizzeria', 'other');--> statement-breakpoint
CREATE TYPE "public"."verification_source" AS ENUM('website', 'facebook', 'instagram', 'google', 'yelp', 'other');--> statement-breakpoint
CREATE TYPE "public"."vote_value" AS ENUM('confirm', 'deny');--> statement-breakpoint
CREATE TABLE "chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"state" text,
	"country" char(2) NOT NULL,
	"default_timezone" text NOT NULL,
	"currency_code" char(3) NOT NULL,
	"center_lat" numeric(10, 7),
	"center_lng" numeric(10, 7),
	"bbox" geometry(Polygon,4326),
	"status" "city_status" DEFAULT 'discovery' NOT NULL,
	"seed_config" jsonb,
	"launched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "happy_hour_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"happy_hour_id" uuid NOT NULL,
	"exception_date" date NOT NULL,
	"type" "hh_exception_type" NOT NULL,
	"override_start_time" time,
	"override_end_time" time,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "happy_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time,
	"crosses_midnight" boolean GENERATED ALWAYS AS ((end_time < start_time)) STORED,
	"location_within_venue" "location_within_venue" DEFAULT 'all' NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "happy_hours_dow_iso" CHECK (day_of_week BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"polygon" geometry(MultiPolygon,4326),
	"source" text,
	"source_url" text,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"happy_hour_id" uuid NOT NULL,
	"kind" "offering_kind" NOT NULL,
	"category" "offering_category" NOT NULL,
	"name" text,
	"price_cents" integer,
	"original_price_cents" integer,
	"discount_cents" integer,
	"currency_code" char(3),
	"description" text,
	"conditions" text,
	"location_restriction" "location_within_venue",
	"source_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"category" "tag_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "venue_tags" (
	"venue_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_tags_venue_id_tag_id_pk" PRIMARY KEY("venue_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"timezone" text,
	"neighborhood_id" uuid,
	"type" "venue_type",
	"chain_id" uuid,
	"website_url" text,
	"other_url" text,
	"google_place_id" text,
	"phone" text,
	"status" "venue_status" DEFAULT 'active' NOT NULL,
	"flagged_at" timestamp with time zone,
	"flag_reason" text,
	"flag_vote_count" integer DEFAULT 0 NOT NULL,
	"promotion_tier" "promotion_tier" DEFAULT 'none' NOT NULL,
	"promotion_starts_at" timestamp with time zone,
	"promotion_ends_at" timestamp with time zone,
	"data_completeness" "data_completeness" DEFAULT 'stub' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"claimed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "venues_google_place_id_unique" UNIQUE("google_place_id")
);
--> statement-breakpoint
CREATE TABLE "community_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "flag_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"flag_type" "flag_type" NOT NULL,
	"vote_value" "vote_value" NOT NULL,
	"submitter_fingerprint" text,
	"submitter_ip" "inet",
	"reason" text,
	"resolved_at" timestamp with time zone,
	"resolution" "flag_resolution",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edit_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "edit_target_type" NOT NULL,
	"target_id" uuid,
	"diff_jsonb" jsonb NOT NULL,
	"submitter_fingerprint" text,
	"submitter_ip" "inet",
	"submitter_email" text,
	"ai_risk_score" smallint,
	"ai_risk_level" "ai_risk_level",
	"ai_verdict" "ai_verdict",
	"ai_classifier_reasoning" text,
	"ai_evidence_jsonb" jsonb,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"applied_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submitter_trust" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"ip_hashes" text[],
	"submission_count" integer DEFAULT 0 NOT NULL,
	"accuracy_count" integer DEFAULT 0 NOT NULL,
	"inaccuracy_count" integer DEFAULT 0 NOT NULL,
	"trust_score" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"source" "verification_source" NOT NULL,
	"url" text,
	"fetched_at" timestamp with time zone,
	"ai_summary" text,
	"supports_change" boolean,
	"confidence" numeric(3, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"stage" "ai_stage" NOT NULL,
	"submission_id" uuid,
	"city_id" uuid,
	"prompt_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"before_jsonb" jsonb,
	"after_jsonb" jsonb,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"google_place_id" text,
	"address" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"source_url" text,
	"processed_at" timestamp with time zone,
	"outcome" "seed_outcome",
	"resulting_venue_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seed_candidates_google_place_id_unique" UNIQUE("google_place_id")
);
--> statement-breakpoint
ALTER TABLE "happy_hour_exceptions" ADD CONSTRAINT "happy_hour_exceptions_happy_hour_id_happy_hours_id_fk" FOREIGN KEY ("happy_hour_id") REFERENCES "public"."happy_hours"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "happy_hours" ADD CONSTRAINT "happy_hours_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_parent_id_neighborhoods_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."neighborhoods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_happy_hour_id_happy_hours_id_fk" FOREIGN KEY ("happy_hour_id") REFERENCES "public"."happy_hours"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_tags" ADD CONSTRAINT "venue_tags_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_tags" ADD CONSTRAINT "venue_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_submission_id_edit_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."edit_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_submission_id_edit_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."edit_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD CONSTRAINT "seed_candidates_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD CONSTRAINT "seed_candidates_resulting_venue_id_venues_id_fk" FOREIGN KEY ("resulting_venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "happy_hours_natural_uq" ON "happy_hours" USING btree ("venue_id","day_of_week","start_time","end_time","location_within_venue") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "happy_hours_venue_idx" ON "happy_hours" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "neighborhoods_city_slug_uq" ON "neighborhoods" USING btree ("city_id","slug");--> statement-breakpoint
CREATE INDEX "neighborhoods_polygon_gix" ON "neighborhoods" USING gist ("polygon");--> statement-breakpoint
CREATE INDEX "neighborhoods_city_idx" ON "neighborhoods" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "offerings_happy_hour_idx" ON "offerings" USING btree ("happy_hour_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_city_slug_uq" ON "venues" USING btree ("city_id","slug");--> statement-breakpoint
CREATE INDEX "venues_city_idx" ON "venues" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "venues_neighborhood_idx" ON "venues" USING btree ("neighborhood_id");--> statement-breakpoint
CREATE INDEX "venues_status_idx" ON "venues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "community_flags_target_idx" ON "community_flags" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "edit_submissions_status_idx" ON "edit_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "edit_submissions_target_idx" ON "edit_submissions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "edit_submissions_fingerprint_idx" ON "edit_submissions" USING btree ("submitter_fingerprint");--> statement-breakpoint
CREATE INDEX "ai_usage_ledger_month_stage_idx" ON "ai_usage_ledger" USING btree ("month","stage");--> statement-breakpoint
CREATE INDEX "ai_usage_ledger_city_month_idx" ON "ai_usage_ledger" USING btree ("city_id","month");--> statement-breakpoint
CREATE INDEX "audit_log_row_idx" ON "audit_log" USING btree ("table_name","row_id");