CREATE TABLE "venue_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"kind" text DEFAULT 'good' NOT NULL,
	"submitter_fingerprint" text NOT NULL,
	"submitter_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_signals" ADD CONSTRAINT "venue_signals_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_signals_dedup_idx" ON "venue_signals" USING btree ("venue_id","kind","submitter_fingerprint");--> statement-breakpoint
CREATE INDEX "venue_signals_count_idx" ON "venue_signals" USING btree ("venue_id","kind");