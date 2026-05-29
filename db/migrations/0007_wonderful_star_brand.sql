ALTER TABLE "happy_hours" ALTER COLUMN "start_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "happy_hours" ADD COLUMN "all_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "happy_hours" ADD CONSTRAINT "happy_hours_all_day_shape" CHECK (
        (all_day = true  AND start_time IS NULL AND end_time IS NULL)
        OR
        (all_day = false AND start_time IS NOT NULL)
      );