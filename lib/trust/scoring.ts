/**
 * Submitter trust scoring (PRD §3.11).
 *
 * Delta values:
 *   accurate   → +5  (positive signal; easy to earn, hard to lose)
 *   inaccurate → -10 (2× penalty to discourage spam; matches PRD ban-at-−50 intent)
 *
 * trustScore is clamped to [-100, 100]. A score ≤ BAN_THRESHOLD (-50) triggers
 * an automatic ban — the row is kept for audit purposes (PRD §5.1 item 4).
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { submitterTrust } from "@/db/schema";

export const BAN_THRESHOLD = -50;

const DELTA: Record<"accurate" | "inaccurate", number> = {
  accurate: 5,
  inaccurate: -10,
};

/** Pure helper — returns the score delta for an outcome. */
export function trustDelta(outcome: "accurate" | "inaccurate"): number {
  return DELTA[outcome];
}

/**
 * Persist an outcome for a fingerprint. Upserts the trust row, increments the
 * appropriate counter, clamps trustScore to [-100, 100], and auto-bans when
 * trustScore <= BAN_THRESHOLD. Single UPDATE/INSERT via Drizzle.
 */
export async function recordOutcome(
  fingerprint: string,
  outcome: "accurate" | "inaccurate",
): Promise<void> {
  const delta = trustDelta(outcome);
  const accuracyInc = outcome === "accurate" ? 1 : 0;
  const inaccuracyInc = outcome === "inaccurate" ? 1 : 0;

  await db
    .insert(submitterTrust)
    .values({
      fingerprint,
      submissionCount: 0,
      accuracyCount: accuracyInc,
      inaccuracyCount: inaccuracyInc,
      trustScore: Math.max(-100, Math.min(100, delta)),
      firstSeen: new Date(),
      lastSeen: new Date(),
      banned: delta <= BAN_THRESHOLD,
    })
    .onConflictDoUpdate({
      target: submitterTrust.fingerprint,
      set: {
        accuracyCount: sql`${submitterTrust.accuracyCount} + ${accuracyInc}`,
        inaccuracyCount: sql`${submitterTrust.inaccuracyCount} + ${inaccuracyInc}`,
        trustScore: sql`GREATEST(-100, LEAST(100, ${submitterTrust.trustScore} + ${delta}))`,
        banned: sql`(GREATEST(-100, LEAST(100, ${submitterTrust.trustScore} + ${delta})) <= ${BAN_THRESHOLD})`,
        lastSeen: sql`now()`,
      },
    });
}
