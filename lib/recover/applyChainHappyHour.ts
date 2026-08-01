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
  chainHappyHoursFor,
  type ChainHappyHour,
} from "@/lib/places/chainHappyHours";

export interface ApplyChainResult {
  matched: ChainHappyHour | null;
  /** true = applied (or, in dryRun, WOULD apply) at least one window. */
  applied: boolean;
  skippedReason?: string;
  windowsLive: number;
}

/** Is this exact days+time window already live WITH offerings at this venue? Then that
 *  location extracted its own (richer) data — don't overwrite it with a generic copy. */
async function windowAlreadyCovered(venueId: string, c: ChainHappyHour): Promise<boolean> {
  const covered = await db
    .select({ id: happyHours.id })
    .from(happyHours)
    .where(
      and(
        eq(happyHours.venueId, venueId),
        eq(happyHours.active, true),
        sql`${happyHours.deletedAt} IS NULL`,
        eq(happyHours.daysOfWeek, c.daysOfWeek),
        sql`${happyHours.startTime} IS NOT DISTINCT FROM ${c.startTime}::time`,
        sql`${happyHours.endTime} IS NOT DISTINCT FROM ${c.endTime}::time`,
        sql`EXISTS (SELECT 1 FROM offerings o WHERE o.happy_hour_id = ${happyHours.id}
              AND o.active = true AND o.deleted_at IS NULL)`,
      ),
    )
    .limit(1);
  return covered.length > 0;
}

export async function applyChainHappyHourIfMissing(opts: {
  venueId: string;
  cityId: string;
  venueName: string;
  actor?: string;
  dryRun?: boolean;
}): Promise<ApplyChainResult> {
  // A chain may publish several windows (Pacific Catch: weekday 3–6, weekend 3–5). Each is
  // gap-filled independently, so a location that extracted its own weekday window still gets
  // the weekend one it missed.
  const matches = chainHappyHoursFor(opts.venueName);
  if (matches.length === 0) return { matched: null, applied: false, windowsLive: 0 };

  const missing: ChainHappyHour[] = [];
  for (const c of matches) {
    if (!(await windowAlreadyCovered(opts.venueId, c))) missing.push(c);
  }
  if (missing.length === 0) {
    return {
      matched: matches[0],
      applied: false,
      skippedReason: "already has offerings for every curated window",
      windowsLive: 0,
    };
  }

  if (opts.dryRun) return { matched: missing[0], applied: true, windowsLive: 0 };

  let windowsLive = 0;
  for (const c of missing) {
    const r = await persistExtractedWindows({
      venueId: opts.venueId,
      cityId: opts.cityId,
      extracted: buildChainExtractResult(c),
      actor: opts.actor ?? "chain-hh-registry",
    });
    windowsLive += r.windowsLive;
  }
  return { matched: missing[0], applied: true, windowsLive };
}
