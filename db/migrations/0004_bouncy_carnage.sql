ALTER TABLE "happy_hours" DROP CONSTRAINT "happy_hours_dow_iso";--> statement-breakpoint
DROP INDEX "happy_hours_natural_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "happy_hours_natural_uq" ON "happy_hours" USING btree ("venue_id","start_time","end_time","location_within_venue") WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "happy_hours" DROP COLUMN "day_of_week";