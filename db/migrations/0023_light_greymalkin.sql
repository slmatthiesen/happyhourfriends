CREATE TYPE "public"."hh_probe_status" AS ENUM('readable', 'blocked', 'none');--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "hh_page_url" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "hh_probe_status" "hh_probe_status";