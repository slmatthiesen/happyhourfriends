import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions } from "@/db/schema";

export const metadata: Metadata = {
  title: "Submission status · Happy Hour Friends",
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_COPY: Record<string, { label: string; detail: string }> = {
  pending: { label: "Under review", detail: "Our AI will review this shortly." },
  interpreting: {
    label: "Under review",
    detail: "We're reading your report and matching it to this venue.",
  },
  interpreted: {
    label: "Under review",
    detail:
      "We turned your report into specific changes — our team is finalizing them.",
  },
  classifying: { label: "Under review", detail: "We're assessing this change." },
  verifying: {
    label: "Verifying",
    detail: "We're checking this against the venue's own channels.",
  },
  auto_applied: { label: "Applied", detail: "This change is now live. Thank you!" },
  applied: { label: "Applied", detail: "This change is now live. Thank you!" },
  queued_outreach: {
    label: "Awaiting confirmation",
    detail: "We couldn't auto-confirm it yet — we may reach out to the venue.",
  },
  queued_admin: {
    label: "Awaiting review",
    detail: "A human is reviewing this change.",
  },
  rejected: {
    label: "Not applied",
    detail: "We couldn't verify this change, so it wasn't applied.",
  },
  reverted: { label: "Reverted", detail: "This change was rolled back." },
  budget_exhausted: {
    label: "Queued for review",
    detail: "Queued for manual review. Thanks for your patience.",
  },
};

export default async function SubmissionStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [sub] = await db
    .select({
      id: editSubmissions.id,
      status: editSubmissions.status,
      targetType: editSubmissions.targetType,
      createdAt: editSubmissions.createdAt,
      decidedAt: editSubmissions.decidedAt,
    })
    .from(editSubmissions)
    .where(eq(editSubmissions.id, id))
    .limit(1);

  if (!sub) notFound();

  const copy = STATUS_COPY[sub.status] ?? {
    label: sub.status,
    detail: "",
  };

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-16">
      <h1
        className="text-3xl font-semibold text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Submission status
      </h1>

      <div className="mt-6 rounded-lg border border-border bg-bg-surface p-6">
        <p className="text-sm text-text-muted">Status</p>
        <p className="mt-1 text-2xl text-accent-warm">{copy.label}</p>
        {copy.detail && <p className="mt-2 text-text-primary">{copy.detail}</p>}
        <dl className="mt-6 space-y-1 text-sm text-text-muted">
          <div className="flex justify-between">
            <dt>Type</dt>
            <dd>{sub.targetType.replace(/_/g, " ")}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Submitted</dt>
            <dd>{new Date(sub.createdAt).toLocaleDateString()}</dd>
          </div>
          {sub.decidedAt && (
            <div className="flex justify-between">
              <dt>Decided</dt>
              <dd>{new Date(sub.decidedAt).toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
      </div>

      <Link
        href="/tacoma"
        className="mt-6 inline-block text-sm text-accent-cool hover:underline"
      >
        ← Back to happy hours
      </Link>
    </main>
  );
}
