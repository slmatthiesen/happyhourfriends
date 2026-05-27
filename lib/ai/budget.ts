import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiRiskLevel, aiUsageLedger } from "@/db/schema";

type RiskLevel = (typeof aiRiskLevel.enumValues)[number];

/** First day of the current month as a `YYYY-MM-01` string (ledger.month key). */
export function firstOfCurrentMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export const capCents = () =>
  parseInt(process.env.ANTHROPIC_MONTHLY_CAP_CENTS ?? "2000", 10);
export const warningCents = () =>
  parseInt(process.env.ANTHROPIC_WARNING_THRESHOLD_CENTS ?? "1500", 10);

/** Sum of paid spend this month (classify + verify + reverify_cron). PRD §4.5. */
export async function monthSpendCents(): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${aiUsageLedger.costCents}), 0)`,
    })
    .from(aiUsageLedger)
    .where(
      and(
        eq(aiUsageLedger.month, firstOfCurrentMonth()),
        sql`${aiUsageLedger.stage} in ('classify', 'verify', 'reverify_cron')`,
      ),
    );
  return Number(row?.total ?? 0);
}

export type BudgetTier = "normal" | "critical_only" | "stage1_only";

/** $0–warn: normal · warn–cap: Stage 2 only on critical · ≥cap: Stage 1 only. */
export function tierFor(spentCents: number): BudgetTier {
  if (spentCents >= capCents()) return "stage1_only";
  if (spentCents >= warningCents()) return "critical_only";
  return "normal";
}

export interface Stage2Decision {
  allowed: boolean;
  tier: BudgetTier;
  spentCents: number;
}

/**
 * Call before every paid Stage 2 verification. `projectedCallCost` is a
 * conservative per-call estimate in cents (PRD §4.5 uses 5).
 */
export async function canRunStage2(
  riskLevel: RiskLevel,
  projectedCallCost = 5,
): Promise<Stage2Decision> {
  const spentCents = await monthSpendCents();
  const tier = tierFor(spentCents);

  if (spentCents + projectedCallCost > capCents()) {
    return { allowed: false, tier: "stage1_only", spentCents };
  }
  if (tier === "critical_only" && riskLevel !== "critical") {
    return { allowed: false, tier, spentCents };
  }
  return { allowed: true, tier, spentCents };
}
