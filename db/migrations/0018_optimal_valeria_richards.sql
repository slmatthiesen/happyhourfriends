CREATE TABLE "data_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"audited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_verdict" text,
	"resolution" text DEFAULT 'scanned' NOT NULL,
	"fix_applied" boolean DEFAULT false NOT NULL,
	CONSTRAINT "data_audit_venue_id_unique" UNIQUE("venue_id")
);
--> statement-breakpoint
ALTER TABLE "data_audit" ADD CONSTRAINT "data_audit_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_audit_resolution_idx" ON "data_audit" USING btree ("resolution");