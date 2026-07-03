import { inArray, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions, venues } from "@/db/schema";
import { SubmissionCard, type QueueItem } from "@/components/admin/submission-card";

// Submissions awaiting a human decision (everything not yet terminal).
const OPEN_STATUSES = [
  "pending",
  "classifying",
  "verifying",
  "queued_admin",
  "queued_outreach",
  "budget_exhausted",
] as const;

interface DiffShape {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  sourceUrl?: string | null;
  summary?: string;
}

export default async function AdminQueue() {
  const rows = await db
    .select()
    .from(editSubmissions)
    .where(inArray(editSubmissions.status, [...OPEN_STATUSES]))
    .orderBy(asc(editSubmissions.createdAt));

  // Resolve a venue name for each row. Direct venue/intent rows carry the venue id in
  // targetId; interpreted children (happy_hour/offering/new_offering) carry it on their
  // parent (parentSubmissionId → parent.targetId).
  const parentIds = rows
    .filter((r) => r.parentSubmissionId)
    .map((r) => r.parentSubmissionId as string);
  const parentVenueById = new Map<string, string>();
  if (parentIds.length) {
    const parents = await db
      .select({ id: editSubmissions.id, targetId: editSubmissions.targetId })
      .from(editSubmissions)
      .where(inArray(editSubmissions.id, parentIds));
    for (const p of parents) if (p.targetId) parentVenueById.set(p.id, p.targetId);
  }

  const directVenueIds = rows
    .filter(
      (r) => (r.targetType === "venue" || r.targetType === "intent") && r.targetId,
    )
    .map((r) => r.targetId as string);
  const venueIds = [
    ...new Set([...directVenueIds, ...parentVenueById.values()]),
  ];
  const nameById = new Map<string, string>();
  if (venueIds.length) {
    const vs = await db
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(inArray(venues.id, venueIds));
    for (const v of vs) nameById.set(v.id, v.name);
  }

  const items: QueueItem[] = rows.map((r) => {
    const diff = (r.diffJsonb as DiffShape) ?? { before: null, after: {} };
    const venueId =
      (r.targetType === "venue" || r.targetType === "intent") && r.targetId
        ? r.targetId
        : r.parentSubmissionId
          ? (parentVenueById.get(r.parentSubmissionId) ?? null)
          : null;
    const targetName =
      r.targetType === "new_venue"
        ? ((diff.after?.name as string) ?? "New venue")
        : venueId
          ? (nameById.get(venueId) ?? null)
          : null;
    return {
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      diff: { before: diff.before ?? null, after: diff.after ?? {}, sourceUrl: diff.sourceUrl, summary: diff.summary },
      aiRiskLevel: r.aiRiskLevel,
      aiVerdict: r.aiVerdict,
      aiReasoning: r.aiClassifierReasoning,
      confirmed:
        r.aiEvidenceJsonb && typeof r.aiEvidenceJsonb === "object"
          ? ((r.aiEvidenceJsonb as { confirmed?: boolean }).confirmed ?? null)
          : null,
      status: r.status,
      submitterEmail: r.submitterEmail,
      createdAt: r.createdAt.toISOString(),
      targetName,
    };
  });

  return (
    <main className="mt-8">
      <h1
        className="text-3xl text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Submission queue
      </h1>
      <p className="mt-2 text-text-muted">
        {items.length === 0
          ? "Nothing waiting. New submissions appear here for review."
          : `${items.length} submission${items.length === 1 ? "" : "s"} awaiting review.`}
      </p>

      <div className="mt-6 space-y-4">
        {items.map((item) => (
          <SubmissionCard key={item.id} item={item} />
        ))}
      </div>
    </main>
  );
}
