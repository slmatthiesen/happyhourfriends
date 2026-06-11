import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions, submitterTrust, venues } from "@/db/schema";
import { classify } from "@/lib/ai/classifier";
import { recordUsage } from "@/lib/ai/ledger";
import { applySubmission } from "@/lib/apply/engine";
import type { SubmissionDiff } from "@/lib/apply/types";
import { enqueueVerify } from "@/lib/jobs/queue";
import { queueForReview } from "@/lib/jobs/queueForReview";

type Submission = typeof editSubmissions.$inferSelect;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Best-effort city resolution for per-city ledger accounting. */
async function resolveCityId(sub: Submission): Promise<string | undefined> {
  const diff = sub.diffJsonb as SubmissionDiff;
  if (sub.targetType === "new_venue") {
    return (diff.after?.cityId as string | undefined) ?? undefined;
  }
  if (sub.targetType === "venue" && sub.targetId) {
    const [v] = await db
      .select({ cityId: venues.cityId })
      .from(venues)
      .where(eq(venues.id, sub.targetId))
      .limit(1);
    return v?.cityId;
  }
  return undefined; // happy_hour / offering — would require a join; left null
}

async function setStatus(
  id: string,
  fields: Partial<typeof editSubmissions.$inferInsert>,
): Promise<void> {
  await db.update(editSubmissions).set(fields).where(eq(editSubmissions.id, id));
}

/**
 * Stage 1 classification job (PRD §4.2, Phase 3). Classifies a pending submission,
 * records the spend, writes risk/verdict back, and routes:
 *   - low risk (not banned, verdict ≠ reject) → auto-apply via the engine
 *   - verdict reject → rejected
 *   - everything else → queued_admin (Stage 2 verification arrives in Phase 4,
 *     which will route low+neutral-trust and medium/high through the verifier
 *     instead of straight to the admin queue)
 */
export async function handleClassify(submissionId: string): Promise<void> {
  const [sub] = await db
    .select()
    .from(editSubmissions)
    .where(eq(editSubmissions.id, submissionId))
    .limit(1);
  if (!sub || sub.status !== "pending") return; // gone or already handled

  await setStatus(submissionId, { status: "classifying" });

  // Submitter trust shapes the verdict + whether we may auto-apply (PRD §5.1.4:
  // banned fingerprints' submissions are stored but never applied).
  let trustScore = 0;
  let submissionCount = 0;
  let accuracyRate = 0;
  let banned = false;
  if (sub.submitterFingerprint) {
    const [t] = await db
      .select()
      .from(submitterTrust)
      .where(eq(submitterTrust.fingerprint, sub.submitterFingerprint))
      .limit(1);
    if (t) {
      trustScore = t.trustScore;
      submissionCount = t.submissionCount;
      banned = t.banned;
      const total = t.accuracyCount + t.inaccuracyCount;
      accuracyRate = total > 0 ? Math.round((t.accuracyCount / total) * 100) : 0;
    }
  }

  const diff = sub.diffJsonb as SubmissionDiff;

  let result;
  try {
    result = await classify({
      diff,
      targetType: sub.targetType,
      trustScore,
      submissionCount,
      accuracyRate,
    });
  } catch (e) {
    // No API key, parse failure, etc. — fail safe to the admin queue.
    await queueForReview(sub, {
      status: "queued_admin",
      aiClassifierReasoning: `Classifier unavailable: ${errMsg(e)}`,
    });
    return;
  }

  const cityId = await resolveCityId(sub);
  await recordUsage({
    stage: "classify",
    model: result.model,
    usage: result.usage,
    costCents: result.costCents,
    promptHash: result.promptHash,
    submissionId,
    cityId,
  });

  await setStatus(submissionId, {
    aiRiskScore: result.riskScore,
    aiRiskLevel: result.riskLevel,
    aiVerdict: result.verdict,
    aiClassifierReasoning: result.reasoning,
  });

  // Auto-apply decision is deferred to the verify stage (see routeContribution there).
  // Interpreted children (fanned out from a free-text `intent` report) always run Stage 2
  // so the operator gets the AI's approve/don't-approve opinion AND an email (including
  // for closures, which benefit most from verification). Only a banned submitter
  // short-circuits to the queue with no AI spend.
  if (sub.parentSubmissionId != null) {
    if (banned) {
      await queueForReview(
        sub,
        { status: "queued_admin" },
        { reason: "Submitter is banned — stored, never applied (PRD §5.1.4)." },
      );
      return;
    }
    await setStatus(submissionId, { status: "verifying" });
    try {
      await enqueueVerify(submissionId);
    } catch (e) {
      await queueForReview(sub, {
        status: "queued_admin",
        aiClassifierReasoning: `${result.reasoning} (verify enqueue failed: ${errMsg(e)})`,
      });
    }
    return;
  }

  if (result.verdict === "reject") {
    await setStatus(submissionId, {
      status: "rejected",
      appliedBy: "ai",
      decidedAt: new Date(),
    });
    return;
  }

  // Banned submitters: stored, never applied (PRD §5.1.4). Critical: always a human
  // (PRD §4.2/§4.4) — no Stage 2 spend.
  if (banned || result.riskLevel === "critical") {
    await queueForReview(
      sub,
      { status: "queued_admin" },
      {
        reason: banned
          ? "Submitter is banned — stored, never applied (PRD §5.1.4)."
          : `Critical-risk change — always a human call. ${result.reasoning}`,
      },
    );
    return;
  }

  // Low risk + positive trust → auto-apply straight away (PRD §4.2).
  if (result.riskLevel === "low" && trustScore > 0) {
    try {
      await applySubmission(submissionId, { actor: "ai", reason: result.reasoning });
    } catch (e) {
      // e.g. missing source_url on a happy-hour change → human decides.
      await queueForReview(sub, {
        status: "queued_admin",
        aiClassifierReasoning: `${result.reasoning} (auto-apply blocked: ${errMsg(e)})`,
      });
    }
    return;
  }

  // low+neutral / medium / high → Stage 2 verification (PRD §4.2, §4.4).
  await setStatus(submissionId, { status: "verifying" });
  try {
    await enqueueVerify(submissionId);
  } catch (e) {
    await queueForReview(sub, {
      status: "queued_admin",
      aiClassifierReasoning: `${result.reasoning} (verify enqueue failed: ${errMsg(e)})`,
    });
  }
}
