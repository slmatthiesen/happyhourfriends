ALTER TABLE "cities" DROP CONSTRAINT "cities_slug_unique";--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "state" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cities_state_slug_unique" ON "cities" USING btree ("state","slug");