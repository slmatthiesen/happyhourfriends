ALTER TABLE "venues" ADD COLUMN "site_health" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "site_health_detail" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "site_health_suggested_url" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "site_health_checked_at" timestamp with time zone;