import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions, verificationAttempts } from "@/db/schema";
import { recordUsage } from "@/lib/ai/ledger";
import { canRunStage2 } from "@/lib/ai/budget";
import { verify, type VerifyInput, type VerifyResult } from "@/lib/ai/verifier";
import { applySubmission } from "@/lib/apply/engine";
import type { SubmissionDiff } from "@/lib/apply/types";
import { readEvidenceForModel } from "@/lib/submit/evidenceStore";
import { recordOutcome } from "@/lib/trust/scoring";
import { sendEmail, adminRecipients } from "@/lib/email/client";
import {
  interpretedChangeEmail,
  type InterpretedVerdict,
} from "@/lib/email/templates";
import { routeContribution, isAutoApplyEnabled } from "@/lib/contribution/route";
import { isFirstPartyUrl } from "@/lib/contribution/firstParty";
import { queueForReview } from "@/lib/jobs/queueForReview";
import { venueContext } from "@/lib/jobs/venueContext";

interface SubmittedFileRef {
  submittedFile?: { url?: string; mime?: string };
}

type Submission = typeof editSubmissions.$inferSelect;
type RiskLevel = "low" | "medium" | "high" | "critical";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const TERMINAL = ["auto_applied", "applied", "rejected", "reverted"];

async function setStatus(
  id: string,
  fields: Partial<typeof editSubmissions.$inferInsert>,
): Promise<void> {
  await db.update(editSubmissions).set(fields).where(eq(editSubmissions.id, id));
}

async function autoApply(
  sub: Submission,
  diff: SubmissionDiff,
  supportingUrl: string | undefined,
  reason: string,
): Promise<void> {
  // Carry the verifier's supporting source onto happy-hour/offering rows so the
  // applied change satisfies the source_url non-negotiable (PRD §13).
  let override: Record<string, unknown> | undefined;
  if (
    supportingUrl &&
    (sub.targetType === "happy_hour" || sub.targetType === "offering") &&
    !diff.after?.sourceUrl
  ) {
    override = { ...diff.after, sourceUrl: supportingUrl };
  }
  await applySubmission(sub.id, { actor: "ai", reason }, override);
}

function verdictFor(confirmed: boolean | null): InterpretedVerdict {
  if (confirmed === true) return "confirmed";
  if (confirmed === false) return "contradicted";
  return "unconfirmed";
}

/**
 * Email the operator about an interpreted child that just landed in the admin queue:
 * what the visitor reported, the concrete change the AI derived, and its verdict.
 * Best-effort — failures (incl. no RESEND_API_KEY) are logged, never thrown.
 */
async function notifyOperator(
  sub: Submission,
  venueName: string,
  diff: SubmissionDiff,
  result: VerifyResult,
): Promise<void> {
  try {
    let note = "";
    if (sub.parentSubmissionId) {
      const [parent] = await db
        .select({ diffJsonb: editSubmissions.diffJsonb })
        .from(editSubmissions)
        .where(eq(editSubmissions.id, sub.parentSubmissionId))
        .limit(1);
      const pDiff = parent?.diffJsonb as SubmissionDiff | undefined;
      note = String(pDiff?.after?.note ?? "");
    }
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const fileRef = (sub.aiEvidenceJsonb as SubmittedFileRef | null)?.submittedFile;
    const evidenceUrl =
      result.evidence.find((e) => e.supportsChange && e.url && e.url !== "submitted-menu")
        ?.url ??
      diff.sourceUrl ??
      (fileRef?.url ? `${base}${fileRef.url}` : null);

    const { subject, html } = interpretedChangeEmail({
      venueName,
      note,
      changeSummary: diff.summary ?? "Suggested change",
      before: diff.before ?? null,
      after: diff.after ?? {},
      verdict: verdictFor(result.confirmed),
      confidence: result.confidence,
      evidenceUrl,
      adminUrl: `${base}/admin`,
    });
    await sendEmail({ to: adminRecipients(), subject, html });
  } catch (e) {
    console.error("Failed to send interpreted-change email", e);
  }
}

/**
 * Stage 2 verification job (PRD §4.3, §4.4). Budget-gated; runs the verifier, logs
 * spend + evidence, then routes by (risk level × verifier verdict):
 *   contradicted → reject + decrement trust
 *   confirmed    → auto-apply (low/medium/high)
 *   unconfirmed  → low: apply · medium: queue_outreach · high: queue_admin
 */
export async function handleVerify(submissionId: string): Promise<void> {
  const [sub] = await db
    .select()
    .from(editSubmissions)
    .where(eq(editSubmissions.id, submissionId))
    .limit(1);
  if (!sub || TERMINAL.includes(sub.status)) return;

  const riskLevel: RiskLevel = (sub.aiRiskLevel as RiskLevel | null) ?? "medium";

  // Budget cap (PRD §4.5): when exhausted, hand to admin with the flag status.
  const budget = await canRunStage2(riskLevel);
  if (!budget.allowed) {
    await setStatus(submissionId, { status: "budget_exhausted" });
    return;
  }

  const ctx = await venueContext(sub);
  if (!ctx) {
    await queueForReview(
      sub,
      { status: "queued_admin" },
      { reason: "Could not resolve the venue behind this submission." },
    );
    return;
  }

  await setStatus(submissionId, { status: "verifying" });

  const diff = sub.diffJsonb as SubmissionDiff;

  // If the submitter uploaded a menu photo or PDF, load it for the verifier to read.
  const fileRef = (sub.aiEvidenceJsonb as SubmittedFileRef | null)?.submittedFile;
  const evidenceMedia =
    fileRef?.url && fileRef.mime
      ? await readEvidenceForModel(fileRef.url, fileRef.mime)
      : null;

  const input: VerifyInput = {
    venueName: ctx.name,
    websiteUrl: ctx.websiteUrl,
    otherUrl: ctx.otherUrl,
    diffSummary: diff.summary ?? JSON.stringify(diff.after ?? {}),
    evidenceMedia,
  };

  let result;
  try {
    result = await verify(input);
  } catch (e) {
    await queueForReview(sub, {
      status: "queued_admin",
      aiClassifierReasoning: `Verifier unavailable: ${errMsg(e)}`,
    });
    return;
  }

  await recordUsage({
    stage: "verify",
    model: result.model,
    usage: result.usage,
    costCents: result.costCents,
    promptHash: result.promptHash,
    submissionId,
    cityId: ctx.cityId,
  });

  // Persist evidence: the structured blob on the submission + one row per source.
  await setStatus(submissionId, {
    aiEvidenceJsonb: {
      ...(fileRef ? { submittedFile: fileRef } : {}),
      confirmed: result.confirmed,
      confidence: result.confidence,
      summary: result.summary,
      evidence: result.evidence,
    },
  });
  for (const ev of result.evidence) {
    await db.insert(verificationAttempts).values({
      submissionId,
      source: ev.source,
      url: ev.url,
      fetchedAt: new Date(),
      aiSummary: ev.snippet,
      supportsChange: ev.supportsChange,
      confidence: String(result.confidence),
    });
  }

  // Interpreted children (fanned out from a free-text report): route via the trust-matrix
  // decision. With CONTRIBUTION_AUTOAPPLY flag OFF (default), routeContribution always
  // returns "queue" — behavior is identical to the original hard gate. When the flag is
  // enabled, a first-party + high-confidence + non-critical child may auto-apply.
  // We do NOT touch submitter trust here: a child is server-created, so scoring it would
  // asymmetrically penalise the reporter (children never reach the "accurate" path).
  if (sub.parentSubmissionId != null) {
    const verdict = verdictFor(result.confirmed);
    const supportingUrl = result.evidence.find((e) => e.supportsChange)?.url;
    const firstParty = isFirstPartyUrl(diff.sourceUrl, ctx.websiteUrl);
    const afterStatus = (diff.after as Record<string, unknown> | undefined)?.status;
    const critical =
      sub.targetType === "venue" &&
      typeof afterStatus === "string" &&
      (afterStatus === "closed" || afterStatus === "no_happy_hour");
    const decision = routeContribution({
      firstParty,
      confidence: result.confidence,
      submitterBanned: false,
      submitterTrustScore: 0,
      critical,
      autoApplyEnabled: isAutoApplyEnabled(),
    });
    if (decision === "auto_apply" && result.confirmed !== false) {
      try {
        await autoApply(sub, diff, supportingUrl, result.summary);
        return;
      } catch {
        /* fall through to queue + notify */
      }
    }
    await setStatus(submissionId, {
      status: "queued_admin",
      aiClassifierReasoning: `AI ${verdict} (confidence ${result.confidence.toFixed(2)}): ${result.summary}`,
    });
    await notifyOperator(sub, ctx.name, diff, result);
    return;
  }

  // Route (PRD §4.4).
  if (result.confirmed === false) {
    await setStatus(submissionId, {
      status: "rejected",
      appliedBy: "ai",
      decidedAt: new Date(),
    });
    if (sub.submitterFingerprint) {
      await recordOutcome(sub.submitterFingerprint, "inaccurate");
    }
    return;
  }

  const supportingUrl = result.evidence.find((e) => e.supportsChange)?.url;

  const shouldApply =
    result.confirmed === true || (result.confirmed === null && riskLevel === "low");
  if (shouldApply) {
    try {
      await autoApply(sub, diff, supportingUrl, result.summary);
    } catch (e) {
      await queueForReview(sub, {
        status: "queued_admin",
        aiClassifierReasoning: `${result.summary} (auto-apply blocked: ${errMsg(e)})`,
      });
    }
    return;
  }

  // Unconfirmed: medium → outreach, high → admin.
  await queueForReview(
    sub,
    { status: riskLevel === "medium" ? "queued_outreach" : "queued_admin" },
    {
      reason: `AI could not confirm (confidence ${result.confidence.toFixed(2)}): ${result.summary}`,
    },
  );
}
