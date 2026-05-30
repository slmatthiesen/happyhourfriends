ALTER TABLE "seed_candidates" ADD COLUMN "primary_type" text;--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD COLUMN "types" text[];--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD COLUMN "rating" numeric(2, 1);--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD COLUMN "user_rating_count" integer;--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD COLUMN "price_level" integer;--> statement-breakpoint
ALTER TABLE "seed_candidates" ADD COLUMN "business_status" text;