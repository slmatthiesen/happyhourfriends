import type { editTargetType } from "@/db/schema";

export type EditTargetType = (typeof editTargetType.enumValues)[number];

/**
 * The shape stored in `edit_submissions.diff_jsonb`. `before` is the current
 * persisted state (null for `new_venue`); `after` is the proposed state. Only the
 * keys present in `after` are changed on apply — everything else is left intact.
 *
 * `sourceUrl` is the backing source for the change. Per PRD §13 every *applied*
 * change must carry a source; the apply engine enforces this for happy-hour and
 * offering edits and stores it on the row.
 *
 * `summary` is a short human/AI-readable description of the change, surfaced in the
 * admin queue and fed to the Stage 1 classifier.
 */
export interface SubmissionDiff {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  sourceUrl?: string | null;
  summary?: string;
}

/** Actor string recorded in audit_log: who made the change. */
export type Actor =
  | "ai"
  | `admin:${string}`
  | `fingerprint:${string}`
  | "system";

export function fingerprintActor(fingerprint: string): Actor {
  return `fingerprint:${fingerprint}`;
}

export function adminActor(email: string): Actor {
  return `admin:${email}`;
}
