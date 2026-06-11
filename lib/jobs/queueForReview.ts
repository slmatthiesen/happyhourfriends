import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions } from "@/db/schema";
import type { SubmissionDiff } from "@/lib/apply/types";
import { sendEmail, adminRecipients } from "@/lib/email/client";
import { queuedForReviewEmail } from "@/lib/email/templates";
import { venueContext, type SubmissionLike } from "@/lib/jobs/venueContext";

export type QueueStatus = "queued_admin" | "queued_outreach";

type QueueableSubmission = SubmissionLike & { id: string };

/**
 * Email the operator that a submission landed in a human queue. Best-effort —
 * failures (incl. no RESEND_API_KEY) are logged, never thrown. Paths that already
 * send a richer email (interpreted-child verdicts, first-party extraction summaries)
 * should NOT also call this.
 */
export async function notifyQueuedForReview(
  sub: QueueableSubmission,
  args: { reason: string; status?: QueueStatus },
  send: typeof sendEmail = sendEmail,
): Promise<void> {
  try {
    const ctx = await venueContext(sub).catch(() => null);
    const diff = sub.diffJsonb as SubmissionDiff | null;
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const { subject, html } = queuedForReviewEmail({
      venueName: ctx?.name ?? "Unknown venue",
      targetType: sub.targetType,
      summary: diff?.summary ?? null,
      reason: args.reason,
      queue: args.status ?? "queued_admin",
      adminUrl: `${base}/admin`,
    });
    await send({ to: adminRecipients(), subject, html });
  } catch (e) {
    console.error("Failed to send queued-for-review email", e);
  }
}

/**
 * The one chokepoint for parking a submission in a human queue: writes the status
 * (plus any extra fields) and emails the operator. `reason` defaults to the
 * aiClassifierReasoning being stored, so most call sites pass fields only.
 */
export async function queueForReview(
  sub: QueueableSubmission,
  fields: Partial<typeof editSubmissions.$inferInsert> & { status: QueueStatus },
  opts?: { reason?: string },
): Promise<void> {
  await db.update(editSubmissions).set(fields).where(eq(editSubmissions.id, sub.id));
  await notifyQueuedForReview(sub, {
    reason: opts?.reason ?? String(fields.aiClassifierReasoning ?? "Queued for review"),
    status: fields.status,
  });
}
