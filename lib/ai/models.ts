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
  // HH-relevance gate. A cheap content read — "is this a recurring happy hour?" — that
  // gates the (more expensive) extractor: kills wasted extractions of soft-404 catch-alls,
  // covid notices, operating hours, and hotel-package pages. Haiku by default.
  relevance: process.env.ANTHROPIC_MODEL_RELEVANCE ?? "claude-haiku-4-5",
} as const;
