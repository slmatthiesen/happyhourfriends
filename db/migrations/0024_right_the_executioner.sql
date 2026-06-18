-- Clean up the invalid state before constraining it: soft-deleted windows that were
-- left active=true (older review/reverify scripts set deleted_at without clearing
-- active). They were already excluded from every read by the deleted_at guard.
UPDATE "happy_hours" SET active = false, updated_at = now() WHERE deleted_at IS NOT NULL AND active = true;
--> statement-breakpoint
ALTER TABLE "happy_hours" ADD CONSTRAINT "happy_hours_deleted_inactive" CHECK (deleted_at IS NULL OR active = false);