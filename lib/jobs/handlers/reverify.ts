import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { venues } from "@/db/schema";
import { canRunStage2 } from "@/lib/ai/budget";
import { recordUsage } from "@/lib/ai/ledger";
import { verify } from "@/lib/ai/verifier";

const REVERIFY_PER_RUN = 10; // PRD §4.6 (drop to 5 if steady-state runs over budget)
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Daily re-verification cron (PRD §3.1, §4.6, §7). Two steps:
 *   1. Downgrade `verified` venues whose verification has aged past 60 days back to
 *      `complete`.
 *   2. Re-verify the oldest-verified active venues that hold real data; refresh
 *      `last_verified_at` and re-promote to `verified` when the verifier confirms.
 * Budget-gated — stops early when the monthly cap blocks Stage 2 spend.
 */
export async function handleReverify(): Promise<void> {
  // 1. Stale-downgrade.
  await db
    .update(venues)
    .set({ dataCompleteness: "complete" })
    .where(
      and(
        eq(venues.dataCompleteness, "verified"),
        sql`${venues.lastVerifiedAt} < now() - interval '60 days'`,
      ),
    );

  // 2. Re-verify oldest first (nulls first), skipping stubs (nothing to verify).
  const candidates = await db
    .select({
      id: venues.id,
      name: venues.name,
      websiteUrl: venues.websiteUrl,
      otherUrl: venues.otherUrl,
      cityId: venues.cityId,
    })
    .from(venues)
    .where(
      and(
        eq(venues.status, "active"),
        isNull(venues.deletedAt),
        inArray(venues.dataCompleteness, ["partial", "complete", "verified"]),
      ),
    )
    .orderBy(sql`${venues.lastVerifiedAt} asc nulls first`)
    .limit(REVERIFY_PER_RUN);

  for (const v of candidates) {
    const budget = await canRunStage2("low");
    if (!budget.allowed) break;
    try {
      const result = await verify({
        venueName: v.name,
        websiteUrl: v.websiteUrl,
        otherUrl: v.otherUrl,
        diffSummary: "Confirm this venue's current happy hour schedule is still accurate.",
      });
      await recordUsage({
        stage: "reverify_cron",
        model: result.model,
        usage: result.usage,
        costCents: result.costCents,
        promptHash: result.promptHash,
        cityId: v.cityId ?? undefined,
      });
      await db
        .update(venues)
        .set({
          lastVerifiedAt: new Date(),
          ...(result.confirmed === true ? { dataCompleteness: "verified" } : {}),
        })
        .where(eq(venues.id, v.id));
    } catch (e) {
      console.error(`[cron] reverify ${v.id} failed`, errMsg(e));
    }
  }
}
