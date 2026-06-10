/**
 * Pure retention policy for uploaded evidence files (photos/PDFs under
 * /uploads/evidence). Decides keep vs delete from a file's references — no I/O here;
 * scripts/cleanup-evidence.ts gathers the facts and acts on the verdicts.
 *
 * Retention model:
 *   • Cited by a live row's source_url (happy_hours/offerings) → KEEP forever.
 *     The file IS the public citation behind the venue page's "Source ↗" pill.
 *   • Referenced by any submission in a non-dead status (pending, queued_*, applied,
 *     auto_applied, …) → KEEP. Applied submissions keep their evidence for the audit
 *     trail; in-flight ones still need it for AI verification + admin review.
 *   • Referenced ONLY by dead submissions (rejected/reverted) → DELETE once the newest
 *     reference is older than the grace period (default 30d — long enough to re-review
 *     a contested rejection).
 *   • Orphan (no reference anywhere) → DELETE once the file itself is older than the
 *     orphan grace (default 7d — covers a submission POST racing the scan).
 */

/** Submission statuses whose evidence is no longer needed. */
const DEAD_STATUSES = new Set(["rejected", "reverted"]);

export const DEFAULT_GRACE_DAYS = 30;
export const DEFAULT_ORPHAN_DAYS = 7;

export interface EvidenceFileFacts {
  /** Filename only, e.g. "ab12.jpg". */
  name: string;
  /** True when a live happy_hours/offerings row cites this file as its source_url. */
  citedByLiveRow: boolean;
  /** Status of every submission referencing this file (diff.sourceUrl or submittedFile). */
  submissionStatuses: string[];
  /** Most recent updated_at across referencing submissions (null when none). */
  newestReferenceAt: Date | null;
  /** Filesystem mtime — the orphan-age clock. */
  fileModifiedAt: Date;
}

export interface CleanupVerdict {
  name: string;
  action: "keep" | "delete";
  reason: string;
}

export function decideEvidenceFile(
  facts: EvidenceFileFacts,
  now: Date,
  graceDays: number = DEFAULT_GRACE_DAYS,
  orphanDays: number = DEFAULT_ORPHAN_DAYS,
): CleanupVerdict {
  const { name } = facts;
  if (facts.citedByLiveRow) {
    return { name, action: "keep", reason: "cited as source_url by a live row" };
  }

  const statuses = facts.submissionStatuses;
  if (statuses.length === 0) {
    const ageDays = (now.getTime() - facts.fileModifiedAt.getTime()) / 86_400_000;
    return ageDays >= orphanDays
      ? { name, action: "delete", reason: `orphan, ${Math.floor(ageDays)}d old (no submission references it)` }
      : { name, action: "keep", reason: "orphan but within the grace window" };
  }

  const alive = statuses.filter((s) => !DEAD_STATUSES.has(s));
  if (alive.length > 0) {
    return { name, action: "keep", reason: `referenced by ${alive.length} non-dead submission(s) (${[...new Set(alive)].join(", ")})` };
  }

  const newest = facts.newestReferenceAt ?? facts.fileModifiedAt;
  const ageDays = (now.getTime() - newest.getTime()) / 86_400_000;
  return ageDays >= graceDays
    ? { name, action: "delete", reason: `only dead submissions reference it (${[...new Set(statuses)].join(", ")}), newest ${Math.floor(ageDays)}d ago` }
    : { name, action: "keep", reason: `dead references only, but within the ${graceDays}d grace period` };
}
