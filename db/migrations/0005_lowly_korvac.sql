DROP INDEX "happy_hours_natural_uq";--> statement-breakpoint
ALTER TABLE "happy_hours" ADD COLUMN "days_of_week" smallint[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "happy_hours_natural_uq" ON "happy_hours" USING btree ("venue_id","days_of_week","start_time","end_time","location_within_venue") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "happy_hours" ADD CONSTRAINT "happy_hours_dow_iso" CHECK (array_length(days_of_week, 1) >= 1 AND 1 <= ALL(days_of_week) AND 7 >= ALL(days_of_week));