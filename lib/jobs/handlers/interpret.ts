import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions } from "@/db/schema";
import { recordUsage } from "@/lib/ai/ledger";
import { interpret, type InterpretedOp } from "@/lib/ai/interpreter";
import { getVenueDetailById, type VenueDetail } from "@/lib/queries/venues";
import { readEvidenceForModel } from "@/lib/submit/evidenceStore";
import { enqueueClassify } from "@/lib/jobs/queue";
import type { EditTargetType, SubmissionDiff } from "@/lib/apply/types";

interface SubmittedFileRef {
  submittedFile?: { url?: string; mime?: string };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function setStatus(
  id: string,
  fields: Partial<typeof editSubmissions.$inferInsert>,
): Promise<void> {
  await db.update(editSubmissions).set(fields).where(eq(editSubmissions.id, id));
}

function pickKeys(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = k in obj ? obj[k] : null;
  return out;
}

/**
 * Resolve a model-proposed op against the venue's REAL current data. Returns the child
 * submission's {targetType, targetId, before, after} or null if the op references an id
 * that doesn't belong to this venue (hallucination guard) or is otherwise unusable.
 * `before` is always built from the live row — never from the model.
 */
function resolveOp(
  op: InterpretedOp,
  venue: VenueDetail,
): {
  targetType: EditTargetType;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
} | null {
  const afterKeys = Object.keys(op.after);
  if (afterKeys.length === 0) return null;

  if (op.action === "update_venue") {
    if (op.targetId && op.targetId !== venue.id) return null;
    return {
      targetType: "venue",
      targetId: venue.id,
      before: pickKeys(venue as unknown as Record<string, unknown>, afterKeys),
      after: op.after,
    };
  }

  if (op.action === "update_happy_hour") {
    const hh = venue.happyHours.find((h) => h.id === op.targetId);
    if (!hh) return null;
    return {
      targetType: "happy_hour",
      targetId: hh.id,
      before: pickKeys(hh as unknown as Record<string, unknown>, afterKeys),
      after: op.after,
    };
  }

  if (op.action === "update_offering") {
    const off = venue.happyHours
      .flatMap((h) => h.offerings)
      .find((o) => o.id === op.targetId);
    if (!off) return null;
    return {
      targetType: "offering",
      targetId: off.id,
      before: pickKeys(off as unknown as Record<string, unknown>, afterKeys),
      after: op.after,
    };
  }

  // new_offering — must attach to an existing happy hour of this venue.
  const hh = venue.happyHours.find((h) => h.id === op.happyHourId);
  if (!hh) return null;
  return {
    targetType: "new_offering",
    targetId: null,
    before: null,
    // The engine reads happyHourId out of `after` for the insert.
    after: { ...op.after, happyHourId: hh.id },
  };
}

/**
 * Interpret stage. Turns a free-text `intent` parent into concrete child submissions:
 * loads the venue's current data + any attached photo, asks the model to map the report
 * onto existing records, validates every proposed id against the venue, and fans out one
 * ordinary child submission per change (which then flows through classify → verify →
 * admin). Children never auto-apply (see classify/verify handlers). If nothing actionable
 * comes back, the parent itself goes to the admin queue so the raw note + photo isn't lost.
 */
export async function handleInterpret(submissionId: string): Promise<void> {
  const [parent] = await db
    .select()
    .from(editSubmissions)
    .where(eq(editSubmissions.id, submissionId))
    .limit(1);
  if (!parent || parent.status !== "pending") return;

  if (!parent.targetId) {
    await setStatus(submissionId, {
      status: "queued_admin",
      aiClassifierReasoning: "Intent report had no target venue.",
    });
    return;
  }

  await setStatus(submissionId, { status: "interpreting" });

  const venue = await getVenueDetailById(parent.targetId);
  if (!venue) {
    await setStatus(submissionId, {
      status: "queued_admin",
      aiClassifierReasoning: "Target venue not found.",
    });
    return;
  }

  const diff = parent.diffJsonb as SubmissionDiff;
  const note = String(diff.after?.note ?? "").trim();
  const parentSourceUrl = diff.sourceUrl ?? null;

  // Re-read the attached photo/PDF (if any) so the model can ground the change.
  const fileRef = (parent.aiEvidenceJsonb as SubmittedFileRef | null)?.submittedFile;
  const evidenceMedia =
    fileRef?.url && fileRef.mime
      ? await readEvidenceForModel(fileRef.url, fileRef.mime)
      : null;

  let result;
  try {
    result = await interpret({ note, venue, evidenceMedia });
  } catch (e) {
    // No API key / parse failure → fail safe to the admin queue with the raw note.
    await setStatus(submissionId, {
      status: "queued_admin",
      aiClassifierReasoning: `Interpreter unavailable: ${errMsg(e)}`,
    });
    return;
  }

  await recordUsage({
    stage: "interpret",
    model: result.model,
    usage: result.usage,
    costCents: result.costCents,
    promptHash: result.promptHash,
    submissionId,
    cityId: venue.cityId,
  });

  // Validate each op against the venue and fan out a child submission per valid change.
  const resolved = result.ops
    .map((op) => ({ op, r: resolveOp(op, venue) }))
    .filter((x): x is { op: InterpretedOp; r: NonNullable<ReturnType<typeof resolveOp>> } => x.r !== null);

  let created = 0;
  for (const { op, r } of resolved) {
    const [child] = await db
      .insert(editSubmissions)
      .values({
        targetType: r.targetType,
        targetId: r.targetId,
        parentSubmissionId: parent.id,
        diffJsonb: {
          before: r.before,
          after: r.after,
          sourceUrl: parentSourceUrl,
          summary: op.summary || result.summary,
        },
        // Carry the parent's uploaded photo so Stage-2 verify can re-read it.
        aiEvidenceJsonb: parent.aiEvidenceJsonb ?? undefined,
        submitterFingerprint: parent.submitterFingerprint,
        submitterIp: parent.submitterIp,
        submitterEmail: parent.submitterEmail,
        status: "pending",
      })
      .returning({ id: editSubmissions.id });
    created++;
    try {
      await enqueueClassify(child.id);
    } catch (e) {
      await setStatus(child.id, {
        status: "queued_admin",
        aiClassifierReasoning: `Classify enqueue failed: ${errMsg(e)}`,
      });
    }
  }

  if (created === 0) {
    // Nothing concrete (gibberish, too large, or no confident match) — keep the human
    // in the loop with the original note + photo.
    const reason = result.tooLarge
      ? "Reported change is too large to apply automatically — review the attached menu."
      : `Could not map the report to a specific change: ${result.summary || note}`;
    await setStatus(submissionId, {
      status: "queued_admin",
      aiClassifierReasoning: reason,
    });
    return;
  }

  await setStatus(submissionId, {
    status: "interpreted",
    aiClassifierReasoning: `Interpreted into ${created} change(s): ${result.summary}`,
    decidedAt: new Date(),
  });
}
