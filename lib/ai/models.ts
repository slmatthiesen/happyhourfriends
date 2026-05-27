/**
 * Model IDs are env-overridable (PRD §2.1) so they can be swapped without a deploy.
 */
export const MODELS = {
  classifier: process.env.ANTHROPIC_MODEL_CLASSIFIER ?? "claude-haiku-4-5",
  verifier: process.env.ANTHROPIC_MODEL_VERIFIER ?? "claude-sonnet-4-6",
  // Seed happy-hour extraction. Haiku by default — "read a menu, emit JSON" is well
  // within its range, and it's ~3× cheaper than Sonnet (matters since web_fetch pulls
  // page text in as input tokens). Override with ANTHROPIC_MODEL_EXTRACTOR if needed.
  extractor: process.env.ANTHROPIC_MODEL_EXTRACTOR ?? "claude-haiku-4-5",
} as const;
