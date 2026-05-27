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

  // Resolve venue names for venue-target rows in one round trip.
  const venueIds = rows
    .filter((r) => r.targetType === "venue" && r.targetId)
    .map((r) => r.targetId as string);
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
    const targetName =
      r.targetType === "venue" && r.targetId
        ? (nameById.get(r.targetId) ?? null)
        : r.targetType === "new_venue"
          ? ((diff.after?.name as string) ?? "New venue")
          : null;
    return {
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      diff: { before: diff.before ?? null, after: diff.after ?? {}, sourceUrl: diff.sourceUrl, summary: diff.summary },
      aiRiskLevel: r.aiRiskLevel,
      aiVerdict: r.aiVerdict,
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
