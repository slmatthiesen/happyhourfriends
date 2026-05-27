/**
 * Cross-venue anomaly detection (PRD §5.6 / §5.1 item 6).
 *
 * Finds /24 IP blocks that submitted >3 critical-risk changes to DISTINCT
 * target_ids in the trailing 7 days. The operator reviews these manually
 * (e.g. via the /admin dashboard or a daily email digest) — this module only
 * surfaces them, it does not auto-ban.
 *
 * Uses a raw sql`` query against edit_submissions because PostGIS/inet network
 * functions (set_masklen, network) are not available as Drizzle column helpers.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export interface CrossVenueAnomaly {
  /** e.g. "192.168.1.0/24" */
  ipBlock: string;
  /** Number of distinct target_ids with critical submissions from this block */
  venueCount: number;
  /** Total critical submissions from this block in the window */
  submissionCount: number;
}

/**
 * Returns /24 blocks that hit >3 distinct targets with critical changes in 7 days.
 * Operator reviews these manually — no automated action is taken.
 *
 * @param now - Override "now" for testing; defaults to current time.
 */
export async function detectCrossVenueAnomalies(
  now: Date = new Date(),
): Promise<CrossVenueAnomaly[]> {
  // network(set_masklen(submitter_ip, 24)) collapses any address into its /24 block.
  // We exclude rows where submitter_ip IS NULL (fingerprint-only submissions).
  const rows = await db.execute<{
    ip_block: string;
    venue_count: string;
    submission_count: string;
  }>(sql`
    SELECT
      network(set_masklen(submitter_ip, 24))::text AS ip_block,
      COUNT(DISTINCT target_id)                    AS venue_count,
      COUNT(*)                                     AS submission_count
    FROM edit_submissions
    WHERE
      ai_risk_level = 'critical'
      AND submitter_ip IS NOT NULL
      AND created_at > ${now}::timestamptz - INTERVAL '7 days'
    GROUP BY network(set_masklen(submitter_ip, 24))
    HAVING COUNT(DISTINCT target_id) > 3
    ORDER BY venue_count DESC, submission_count DESC
  `);

  return rows.map((r) => ({
    ipBlock: r.ip_block,
    venueCount: Number(r.venue_count),
    submissionCount: Number(r.submission_count),
  }));
}
