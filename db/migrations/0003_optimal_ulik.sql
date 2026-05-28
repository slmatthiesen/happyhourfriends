ALTER TYPE "public"."ai_stage" ADD VALUE 'interpret';--> statement-breakpoint
ALTER TYPE "public"."edit_target_type" ADD VALUE 'intent';--> statement-breakpoint
ALTER TYPE "public"."edit_target_type" ADD VALUE 'new_offering';--> statement-breakpoint
ALTER TYPE "public"."submission_status" ADD VALUE 'interpreting';--> statement-breakpoint
ALTER TYPE "public"."submission_status" ADD VALUE 'interpreted';--> statement-breakpoint
ALTER TABLE "edit_submissions" ADD COLUMN "parent_submission_id" uuid;--> statement-breakpoint
ALTER TABLE "edit_submissions" ADD CONSTRAINT "edit_submissions_parent_submission_id_edit_submissions_id_fk" FOREIGN KEY ("parent_submission_id") REFERENCES "public"."edit_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edit_submissions_parent_idx" ON "edit_submissions" USING btree ("parent_submission_id");