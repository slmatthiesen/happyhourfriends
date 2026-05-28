import { db } from "@/db/client";
import { aiUsageLedger } from "@/db/schema";
import type { Usage } from "@/lib/ai/anthropic";
import { firstOfCurrentMonth } from "@/lib/ai/budget";

export type LedgerStage =
  | "classify"
  | "verify"
  | "reverify_cron"
  | "seed"
  | "interpret";

/**
 * Append one row to ai_usage_ledger (PRD §3.12, §4.7). Every paid call records its
 * token usage, cost, and the pinned prompt_hash so spend and behaviour are auditable
 * per month, per city, and per prompt version.
 */
export async function recordUsage(args: {
  stage: LedgerStage;
  model: string;
  usage: Usage;
  costCents: number;
  promptHash?: string;
  submissionId?: string;
  cityId?: string;
}): Promise<void> {
  await db.insert(aiUsageLedger).values({
    month: firstOfCurrentMonth(),
    model: args.model,
    inputTokens: args.usage.inputTokens,
    outputTokens: args.usage.outputTokens,
    costCents: args.costCents,
    stage: args.stage,
    submissionId: args.submissionId,
    cityId: args.cityId,
    promptHash: args.promptHash,
  });
}
