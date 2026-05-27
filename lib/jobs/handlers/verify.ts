import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  editSubmissions,
  happyHours,
  offerings,
  venues,
  verificationAttempts,
} from "@/db/schema";
import { recordUsage } from "@/lib/ai/ledger";
import { canRunStage2 } from "@/lib/ai/budget";
import { verify, type VerifyInput } from "@/lib/ai/verifier";
import { applySubmission } from "@/lib/apply/engine";
import type { SubmissionDiff } from "@/lib/apply/types";
import { readEvidenceForModel } from "@/lib/submit/evidenceStore";
import { recordOutcome } from "@/lib/trust/scoring";

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

interface VenueContext {
  name: string;
  websiteUrl: string | null;
  otherUrl: string | null;
  cityId?: string;
}

/** Resolve the venue behind a submission so the verifier knows where to look. */
async function venueContext(sub: Submission): Promise<VenueContext | null> {
  const diff = sub.diffJsonb as SubmissionDiff;
  if (sub.targetType === "new_venue") {
    return {
      name: String(diff.after?.name ?? "Unknown venue"),
      websiteUrl: (diff.after?.websiteUrl as string | undefined) ?? null,
      otherUrl: (diff.after?.otherUrl as string | undefined) ?? null,
      cityId: diff.after?.cityId as string | undefined,
    };
  }

  let venueId: string | null = null;
  if (sub.targetType === "venue") {
    venueId = sub.targetId;
  } else if (sub.targetType === "happy_hour" && sub.targetId) {
    const [h] = await db
      .select({ venueId: happyHours.venueId })
      .from(happyHours)
      .where(eq(happyHours.id, sub.targetId))
      .limit(1);
    venueId = h?.venueId ?? null;
  } else if (sub.targetType === "offering" && sub.targetId) {
    const [o] = await db
      .select({ happyHourId: offerings.happyHourId })
      .from(offerings)
      .where(eq(offerings.id, sub.targetId))
      .limit(1);
    if (o) {
      const [h] = await db
        .select({ venueId: happyHours.venueId })
        .from(happyHours)
        .where(eq(happyHours.id, o.happyHourId))
        .limit(1);
      venueId = h?.venueId ?? null;
    }
  }
  if (!venueId) return null;

  const [v] = await db
    .select({
      name: venues.name,
      websiteUrl: venues.websiteUrl,
      otherUrl: venues.otherUrl,
      cityId: venues.cityId,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  return v
    ? { name: v.name, websiteUrl: v.websiteUrl, otherUrl: v.otherUrl, cityId: v.cityId }
    : null;
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
    await setStatus(submissionId, { status: "queued_admin" });
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
    await setStatus(submissionId, {
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
      await setStatus(submissionId, {
        status: "queued_admin",
        aiClassifierReasoning: `${result.summary} (auto-apply blocked: ${errMsg(e)})`,
      });
    }
    return;
  }

  // Unconfirmed: medium → outreach, high → admin.
  await setStatus(submissionId, {
    status: riskLevel === "medium" ? "queued_outreach" : "queued_admin",
  });
}
