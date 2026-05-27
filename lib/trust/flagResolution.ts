/**
 * Community flag resolution logic (PRD §3.10, §5.3).
 *
 * decideFlag is a pure function; resolveOpenFlags does the DB round-trip and
 * stamps resolved rows. Grouping is done in JS after a single SELECT so that
 * there are no dynamic GROUP BY expressions that might confuse the ORM.
 */

import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { communityFlags } from "@/db/schema";
import { thresholdFor } from "@/lib/trust/flagThresholds";

export interface VoteTally {
  confirm: number;
  deny: number;
}

export type FlagDecision = "confirmed" | "rejected" | "expired" | "pending";

/**
 * Pure decision function. Rule order (deny outweighs per PRD §3.10):
 *   1. deny votes >= threshold.deny  → "rejected"
 *   2. confirm votes >= threshold.confirm → "confirmed"
 *   3. past expiryDays with no resolution → "expired"
 *   4. otherwise → "pending"
 */
export function decideFlag(
  flagType: string,
  tally: VoteTally,
  openedAt: Date,
  now: Date = new Date(),
): FlagDecision {
  const threshold = thresholdFor(flagType);

  if (tally.deny >= threshold.deny) return "rejected";
  if (tally.confirm >= threshold.confirm) return "confirmed";

  const ageMs = now.getTime() - openedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays >= threshold.expiryDays) return "expired";

  return "pending";
}

type DecidedGroup = {
  targetType: string;
  targetId: string;
  flagType: string;
  decision: FlagDecision;
};

/**
 * Load all unresolved community_flags, group them in JS, run decideFlag on each
 * group, and stamp the resolved ones. Returns every non-"pending" decision made.
 */
export async function resolveOpenFlags(
  now: Date = new Date(),
): Promise<DecidedGroup[]> {
  // Fetch all unresolved flags in one query
  const rows = await db
    .select({
      id: communityFlags.id,
      targetType: communityFlags.targetType,
      targetId: communityFlags.targetId,
      flagType: communityFlags.flagType,
      voteValue: communityFlags.voteValue,
      submitterFingerprint: communityFlags.submitterFingerprint,
      createdAt: communityFlags.createdAt,
    })
    .from(communityFlags)
    .where(isNull(communityFlags.resolvedAt));

  if (rows.length === 0) return [];

  // Group by (targetType, targetId, flagType)
  type GroupKey = string;
  type GroupData = {
    targetType: string;
    targetId: string;
    flagType: string;
    earliestCreatedAt: Date;
    confirmFingerprints: Set<string>;
    denyFingerprints: Set<string>;
    ids: string[];
  };

  const groups = new Map<GroupKey, GroupData>();

  for (const row of rows) {
    const key = `${row.targetType}|${row.targetId}|${row.flagType}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        targetType: row.targetType,
        targetId: row.targetId,
        flagType: row.flagType,
        earliestCreatedAt: row.createdAt ?? now,
        confirmFingerprints: new Set(),
        denyFingerprints: new Set(),
        ids: [],
      };
      groups.set(key, g);
    }

    // Track earliest opened_at
    if (row.createdAt && row.createdAt < g.earliestCreatedAt) {
      g.earliestCreatedAt = row.createdAt;
    }

    g.ids.push(row.id);

    // Count DISTINCT fingerprints per vote value (null fingerprint = anonymous, count once per row)
    const fp = row.submitterFingerprint ?? row.id; // fallback to row id so nulls don't collapse
    if (row.voteValue === "confirm") {
      g.confirmFingerprints.add(fp);
    } else {
      g.denyFingerprints.add(fp);
    }
  }

  const decided: DecidedGroup[] = [];

  for (const g of groups.values()) {
    const tally: VoteTally = {
      confirm: g.confirmFingerprints.size,
      deny: g.denyFingerprints.size,
    };
    const decision = decideFlag(g.flagType, tally, g.earliestCreatedAt, now);

    if (decision === "pending") continue;

    // Stamp the rows
    await db
      .update(communityFlags)
      .set({
        resolvedAt: now,
        resolution: decision as "confirmed" | "rejected" | "expired",
      })
      .where(
        and(
          sql`${communityFlags.id} = ANY(ARRAY[${sql.raw(g.ids.map((id) => `'${id}'::uuid`).join(","))}])`,
          isNull(communityFlags.resolvedAt),
        ),
      );

    decided.push({
      targetType: g.targetType,
      targetId: g.targetId,
      flagType: g.flagType,
      decision,
    });
  }

  return decided;
}
