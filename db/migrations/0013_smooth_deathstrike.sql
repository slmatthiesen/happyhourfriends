ALTER TABLE "happy_hours" DROP CONSTRAINT "happy_hours_all_day_shape";--> statement-breakpoint
ALTER TABLE "happy_hours" ADD COLUMN "extract_confidence" numeric;--> statement-breakpoint
ALTER TABLE "happy_hours" ADD COLUMN "time_known" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "happy_hours" ADD CONSTRAINT "happy_hours_all_day_shape" CHECK (
        (all_day = true  AND start_time IS NULL AND end_time IS NULL)
        OR
        (all_day = false AND (start_time IS NOT NULL OR end_time IS NOT NULL))
      );