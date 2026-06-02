ALTER TABLE "neighborhoods" ADD COLUMN "tier" text DEFAULT 'fine' NOT NULL;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD COLUMN "recognizability" smallint DEFAULT 0 NOT NULL;