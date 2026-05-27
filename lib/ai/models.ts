/**
 * Model IDs are env-overridable (PRD §2.1) so they can be swapped without a deploy.
 */
export const MODELS = {
  classifier: process.env.ANTHROPIC_MODEL_CLASSIFIER ?? "claude-haiku-4-5",
  verifier: process.env.ANTHROPIC_MODEL_VERIFIER ?? "claude-sonnet-4-6",
} as const;
