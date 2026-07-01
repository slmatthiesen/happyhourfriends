/**
 * Model IDs are env-overridable (PRD §2.1) so they can be swapped without a deploy.
 */
export const MODELS = {
  classifier: process.env.ANTHROPIC_MODEL_CLASSIFIER ?? "claude-haiku-4-5",
  // Stage-2 verifier LOOP + verdict model. Drives fetch_url/web_search and emits the
  // confirm/contradict JSON over *text only* — every image/PDF is transcribed first by
  // `verifierVision` (below), so this stays on cheap Haiku. Verdict-on-text is a
  // classification task well within Haiku's range; gated by `eval:verifier`.
  verifier: process.env.ANTHROPIC_MODEL_VERIFIER ?? "claude-haiku-4-5",
  // Vision sidecar for the verifier: reads uploaded menu photos/PDFs and any image/PDF
  // the loop fetches, transcribing HH-relevant content to text for the loop model. Sonnet
  // because menu-image reading is where model quality actually pays off.
  verifierVision:
    process.env.ANTHROPIC_MODEL_VERIFIER_VISION ?? "claude-sonnet-4-6",
  // Seed happy-hour extraction. Haiku by default — "read a menu, emit JSON" is well
  // within its range, and it's ~3× cheaper than Sonnet (matters since web_fetch pulls
  // page text in as input tokens). Override with ANTHROPIC_MODEL_EXTRACTOR if needed.
  extractor: process.env.ANTHROPIC_MODEL_EXTRACTOR ?? "claude-haiku-4-5",
  // HH-relevance gate. A cheap content read — "is this a recurring happy hour?" — that
  // gates the (more expensive) extractor: kills wasted extractions of soft-404 catch-alls,
  // covid notices, operating hours, and hotel-package pages. Haiku by default.
  relevance: process.env.ANTHROPIC_MODEL_RELEVANCE ?? "claude-haiku-4-5",
  // When `extractor` is a text-only GLM model, an extraction that includes an image/PDF
  // can't be read by it — those calls fall back to this (vision-capable) Anthropic model
  // instead of dropping the doc. Ignored when the extractor is already Anthropic.
  visionFallback: process.env.ANTHROPIC_MODEL_VISION_FALLBACK ?? "claude-haiku-4-5",
} as const;
