import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { editSubmissions, submitterTrust } from "@/db/schema";

/**
 * Phase 2 submitter bookkeeping (PRD §3.11, §5.1). Kept deliberately minimal and
 * self-contained so the submission API has no cross-phase dependency: it records the
 * submitter and enforces a coarse per-fingerprint / per-IP daily rate limit.
 *
 * The full §5.1 limit matrix and trust scoring live in lib/trust/rateLimits.ts and
 * lib/trust/scoring.ts (Phase 5); the API is swapped over to those when Phase 5 is
 * wired. Until then this guards the open endpoint from trivial flooding.
 */

const FP_PER_DAY = 10; // PRD §5.1
const IP_PER_DAY = 20;

/** Stable, salted hash of an IP for the submitter_trust.ip_hashes history. */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.IP_HASH_SALT ?? "hhf"}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

export interface SubmitterRecord {
  fingerprint: string;
  trustScore: number;
  banned: boolean;
}

/**
 * Upsert the submitter row, bumping submission_count + last_seen and unioning in the
 * IP hash. Returns the trust score + banned flag so the caller can record (but never
 * auto-apply) submissions from banned fingerprints (PRD §5.1.4).
 */
export async function ensureSubmitter(
  fingerprint: string,
  ipHash?: string,
): Promise<SubmitterRecord> {
  const initialHashes = ipHash ? [ipHash] : [];
  const [row] = await db
    .insert(submitterTrust)
    .values({ fingerprint, ipHashes: initialHashes, submissionCount: 1 })
    .onConflictDoUpdate({
      target: submitterTrust.fingerprint,
      set: {
        submissionCount: sql`${submitterTrust.submissionCount} + 1`,
        lastSeen: new Date(),
        ipHashes: ipHash
          ? sql`(
              select array(
                select distinct unnest(
                  array_append(coalesce(${submitterTrust.ipHashes}, '{}'), ${ipHash}::text)
                )
              )
            )`
          : sql`${submitterTrust.ipHashes}`,
      },
    })
    .returning({
      fingerprint: submitterTrust.fingerprint,
      trustScore: submitterTrust.trustScore,
      banned: submitterTrust.banned,
    });
  return row;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

async function countSince(
  column: typeof editSubmissions.submitterFingerprint | typeof editSubmissions.submitterIp,
  value: string,
  interval: string,
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(editSubmissions)
    .where(
      and(
        eq(column, value),
        sql`${editSubmissions.createdAt} > now() - ${sql.raw(`interval '${interval}'`)}`,
      ),
    );
  return Number(r?.n ?? 0);
}

/**
 * Coarse Phase-2 rate limit: per-fingerprint and per-IP daily caps. Returns the
 * first limit exceeded.
 */
export async function checkBasicRateLimit(args: {
  fingerprint?: string | null;
  ip?: string | null;
}): Promise<RateLimitResult> {
  if (args.fingerprint) {
    const n = await countSince(
      editSubmissions.submitterFingerprint,
      args.fingerprint,
      "1 day",
    );
    if (n >= FP_PER_DAY) {
      return { allowed: false, reason: "Daily submission limit reached for this device." };
    }
  }
  if (args.ip) {
    const n = await countSince(editSubmissions.submitterIp, args.ip, "1 day");
    if (n >= IP_PER_DAY) {
      return { allowed: false, reason: "Daily submission limit reached for this network." };
    }
  }
  return { allowed: true };
}
