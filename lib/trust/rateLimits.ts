/**
 * Submission rate limits (PRD §5.1 item 1).
 *
 * IP-limit note: edit_submissions stores the raw inet value in submitter_ip.
 * The ipHash param is accepted for API ergonomics but IP-based limits key on
 * submitterIp directly (exact match). If you later switch to hashed IPs, update
 * the where-clause below.
 *
 * Critical submissions are rows where ai_risk_level = 'critical'. The critical
 * rate limit (2/day per fingerprint) applies regardless of AI classification
 * status — a submission is "critical" once the field is set.
 */

import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions } from "@/db/schema";

// ── Limit constants ──────────────────────────────────────────────────────────

export const RATE_LIMITS = {
  /** Per browser fingerprint */
  fingerprintDay: 10,
  fingerprintWeek: 30,
  /** Per IP address */
  ipDay: 20,
  ipWeek: 60,
  /** Per submitter email (if provided) */
  emailDay: 10,
  /** Critical-risk submissions per fingerprint per day */
  criticalFingerprintDay: 2,
} as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dayAgo(now: Date = new Date()): Date {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

function weekAgo(now: Date = new Date()): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

// Simple inline counter to keep the code readable. Children fanned out from an `intent`
// report are server-created (not user-initiated), so they never count toward a
// submitter's limits — only the parent report does.
async function countSubmissions(conditions: ReturnType<typeof and>): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(editSubmissions)
    .where(and(conditions, isNull(editSubmissions.parentSubmissionId)));
  return Number(row?.n ?? 0);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Check every applicable rate limit for a submission attempt.
 * Returns on the FIRST violated limit (most restrictive check first).
 * Pass `critical: true` when the submission's risk level is already known to be critical.
 */
export async function checkSubmissionRateLimit(args: {
  fingerprint?: string;
  ipHash?: string; // treated as raw IP value for submitter_ip matching (see module note)
  email?: string;
  critical?: boolean;
}): Promise<RateLimitResult> {
  const now = new Date();
  const day = dayAgo(now);
  const week = weekAgo(now);

  // 1. Fingerprint day
  if (args.fingerprint) {
    const n = await countSubmissions(
      and(
        eq(editSubmissions.submitterFingerprint, args.fingerprint),
        gte(editSubmissions.createdAt, day),
      ),
    );
    if (n >= RATE_LIMITS.fingerprintDay) {
      return {
        allowed: false,
        reason: `Fingerprint daily limit of ${RATE_LIMITS.fingerprintDay} submissions reached.`,
      };
    }
  }

  // 2. Fingerprint week
  if (args.fingerprint) {
    const n = await countSubmissions(
      and(
        eq(editSubmissions.submitterFingerprint, args.fingerprint),
        gte(editSubmissions.createdAt, week),
      ),
    );
    if (n >= RATE_LIMITS.fingerprintWeek) {
      return {
        allowed: false,
        reason: `Fingerprint weekly limit of ${RATE_LIMITS.fingerprintWeek} submissions reached.`,
      };
    }
  }

  // 3. IP day (match on raw submitter_ip; ipHash param used as the value)
  if (args.ipHash) {
    const n = await countSubmissions(
      and(
        // Cast the text param to inet for the comparison
        sql`${editSubmissions.submitterIp} = ${args.ipHash}::inet`,
        gte(editSubmissions.createdAt, day),
      ),
    );
    if (n >= RATE_LIMITS.ipDay) {
      return {
        allowed: false,
        reason: `IP daily limit of ${RATE_LIMITS.ipDay} submissions reached.`,
      };
    }
  }

  // 4. IP week
  if (args.ipHash) {
    const n = await countSubmissions(
      and(
        sql`${editSubmissions.submitterIp} = ${args.ipHash}::inet`,
        gte(editSubmissions.createdAt, week),
      ),
    );
    if (n >= RATE_LIMITS.ipWeek) {
      return {
        allowed: false,
        reason: `IP weekly limit of ${RATE_LIMITS.ipWeek} submissions reached.`,
      };
    }
  }

  // 5. Email day
  if (args.email) {
    const n = await countSubmissions(
      and(
        eq(editSubmissions.submitterEmail, args.email),
        gte(editSubmissions.createdAt, day),
      ),
    );
    if (n >= RATE_LIMITS.emailDay) {
      return {
        allowed: false,
        reason: `Email daily limit of ${RATE_LIMITS.emailDay} submissions reached.`,
      };
    }
  }

  // 6. Critical-risk per fingerprint day (PRD §5.1 item 1 last bullet)
  if (args.critical && args.fingerprint) {
    const n = await countSubmissions(
      and(
        eq(editSubmissions.submitterFingerprint, args.fingerprint),
        eq(editSubmissions.aiRiskLevel, "critical"),
        gte(editSubmissions.createdAt, day),
      ),
    );
    if (n >= RATE_LIMITS.criticalFingerprintDay) {
      return {
        allowed: false,
        reason: `Critical-change daily limit of ${RATE_LIMITS.criticalFingerprintDay} per fingerprint reached.`,
      };
    }
  }

  return { allowed: true };
}
