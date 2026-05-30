import type { Usage } from "./anthropic";

/**
 * Per-model token prices in USD per million tokens (PRD §2.1). Keyed by a
 * substring of the model id so env overrides that pin a dated snapshot
 * (e.g. claude-haiku-4-5-20250101) still match.
 */
const PRICES: { match: string; inputPerM: number; outputPerM: number }[] = [
  { match: "haiku", inputPerM: 1, outputPerM: 5 },
  { match: "sonnet", inputPerM: 3, outputPerM: 15 },
  { match: "opus", inputPerM: 15, outputPerM: 75 },
];

function priceFor(model: string) {
  return (
    PRICES.find((p) => model.toLowerCase().includes(p.match)) ?? {
      inputPerM: 3,
      outputPerM: 15,
    }
  );
}

/**
 * Cost of a call in whole cents, rounded up (conservative for budget capping).
 * Pass { batch: true } for Message Batches API calls — billed at 50% of standard.
 */
export function costCents(
  model: string,
  usage: Usage,
  opts?: { batch?: boolean },
): number {
  const { inputPerM, outputPerM } = priceFor(model);
  const dollars =
    (usage.inputTokens / 1_000_000) * inputPerM +
    (usage.outputTokens / 1_000_000) * outputPerM;
  const discounted = opts?.batch ? dollars * 0.5 : dollars;
  return Math.ceil(discounted * 100);
}
