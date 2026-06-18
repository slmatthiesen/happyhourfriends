/**
 * Chain happy-hour FLOOR — fills the curated CHAIN_HAPPY_HOURS entry for a venue ONLY where
 * extraction fell short, then funnels it through the ONE persist path. A location that
 * already pulled a live window WITH offerings for the same days/time is left untouched
 * (Daly City Super Duper keeps its 8); a bare or missing window gets filled (Berkeley Super
 * Duper 0 → drinks+fries). Idempotent: persist's onConflictDoUpdate enriches the existing
 * window in place and dedupes offerings, so re-running never multiplies rows.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { happyHours } from "@/db/schema";
import { persistExtractedWindows } from "@/lib/recover/resolveVenue";
import {
  buildChainExtractResult,
  chainHappyHourFor,
  type ChainHappyHour,
} from "@/lib/places/chainHappyHours";

export interface ApplyChainResult {
  matched: ChainHappyHour | null;
  /** true = applied (or, in dryRun, WOULD apply). */
  applied: boolean;
  skippedReason?: string;
  windowsLive: number;
}

export async function applyChainHappyHourIfMissing(opts: {
  venueId: string;
  cityId: string;
  venueName: string;
  actor?: string;
  dryRun?: boolean;
}): Promise<ApplyChainResult> {
  const matched = chainHappyHourFor(opts.venueName);
  if (!matched) return { matched: null, applied: false, windowsLive: 0 };

  // Gap-fill guard: skip when a live window for these exact days+time already carries
  // offerings — that location extracted its own (richer) data; don't add a generic copy.
  const covered = await db
    .select({ id: happyHours.id })
    .from(happyHours)
    .where(
      and(
        eq(happyHours.venueId, opts.venueId),
        eq(happyHours.active, true),
        sql`${happyHours.deletedAt} IS NULL`,
        eq(happyHours.daysOfWeek, matched.daysOfWeek),
        sql`${happyHours.startTime} IS NOT DISTINCT FROM ${matched.startTime}::time`,
        sql`${happyHours.endTime} IS NOT DISTINCT FROM ${matched.endTime}::time`,
        sql`EXISTS (SELECT 1 FROM offerings o WHERE o.happy_hour_id = ${happyHours.id}
              AND o.active = true AND o.deleted_at IS NULL)`,
      ),
    )
    .limit(1);
  if (covered.length > 0) {
    return {
      matched,
      applied: false,
      skippedReason: "already has offerings for this window",
      windowsLive: 0,
    };
  }

  if (opts.dryRun) return { matched, applied: true, windowsLive: 0 };

  const { windowsLive } = await persistExtractedWindows({
    venueId: opts.venueId,
    cityId: opts.cityId,
    extracted: buildChainExtractResult(matched),
    actor: opts.actor ?? "chain-hh-registry",
  });
  return { matched, applied: true, windowsLive };
}
