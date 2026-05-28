/**
 * Client-safe submission types (no server/db imports), shared by the submission
 * form and the /api/submissions route. Mirrors edit_submissions (PRD §3.8).
 */
// `intent` is the unified free-text "report a change" path: the user describes a
// correction in prose (+ optional photo/URL) and the AI interprets it into concrete
// changes. `new_offering` exists in the DB enum but is server-created only (born from
// interpretation) — it is intentionally NOT in the client-postable list below.
export type SubmissionTargetType =
  | "venue"
  | "happy_hour"
  | "offering"
  | "new_venue"
  | "intent";

export const SUBMISSION_TARGET_TYPES: SubmissionTargetType[] = [
  "venue",
  "happy_hour",
  "offering",
  "new_venue",
  "intent",
];

export interface SubmissionDiffPayload {
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  sourceUrl?: string | null;
  summary?: string;
}

export interface SubmissionPayload {
  targetType: SubmissionTargetType;
  targetId?: string | null;
  diff: SubmissionDiffPayload;
  fingerprint: string;
  email?: string | null;
  captchaToken?: string | null;
  /**
   * Optional photo of the menu/sign as evidence, as a `data:image/...;base64,` URL.
   * When present and no source URL was given, the stored photo becomes the change's
   * source_url, and the AI verifier reads the image directly (vision).
   */
  evidenceImage?: string | null;
  /** Honeypot — must be empty; bots that fill it are silently dropped (§5.1.3). */
  website?: string;
}

/** Server cap on an uploaded evidence photo (decoded bytes). */
export const MAX_EVIDENCE_IMAGE_BYTES = 6 * 1024 * 1024;
