/**
 * Stage 1 classifier for the AI moderation pipeline (PRD §4.2, §4.7).
 *
 * Given a submitted diff, calls the classifier model to produce a risk score,
 * risk level, plausibility score, and a routing verdict. This module is pure:
 * it does not write to the database — the caller persists results and records
 * the usage in ai_usage_ledger.
 */

import { anthropic, parseJsonResponse, type Usage } from "@/lib/ai/anthropic";
import { costCents as computeCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import type { SubmissionDiff, EditTargetType } from "@/lib/apply/types";

export interface ClassifyInput {
  diff: SubmissionDiff;
  targetType: EditTargetType;
  trustScore?: number;      // default 0
  submissionCount?: number; // default 0
  accuracyRate?: number;    // 0-100, default 0
}

export interface ClassifyResult {
  riskScore: number;         // 0-100
  riskLevel: "low" | "medium" | "high" | "critical";
  category: string;
  plausibilityScore: number; // 0-100
  reasoning: string;
  verdict: "auto_apply" | "verify" | "queue_admin" | "reject";
  usage: Usage;
  costCents: number;
  promptHash: string;
  model: string;
}

/** Raw JSON shape returned by the stage1-classifier prompt. */
interface RawClassification {
  risk_score: number;
  risk_level: string;
  category: string;
  plausibility_score: number;
  reasoning: string;
  verdict: string;
}

const VALID_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
const VALID_VERDICTS = ["auto_apply", "verify", "queue_admin", "reject"] as const;

/** Derive risk level from a numeric score when the model returns an invalid value. */
function riskLevelFromScore(score: number): ClassifyResult["riskLevel"] {
  if (score < 25) return "low";
  if (score < 50) return "medium";
  if (score < 75) return "high";
  return "critical";
}

/**
 * Default verdict per PRD §4.2 verdict mapping, used when the model returns
 * an unrecognised value.
 */
function defaultVerdict(level: ClassifyResult["riskLevel"]): ClassifyResult["verdict"] {
  if (level === "low") return "verify";
  if (level === "medium") return "verify";
  if (level === "high") return "verify";
  return "queue_admin";
}

/** Replace all occurrences of a {{placeholder}} in a template string. */
function fill(template: string, placeholder: string, value: string): string {
  return template.split(`{{${placeholder}}}`).join(value);
}

export async function classify(input: ClassifyInput): Promise<ClassifyResult> {
  const {
    diff,
    trustScore = 0,
    submissionCount = 0,
    accuracyRate = 0,
  } = input;

  // Load and split the versioned prompt template.
  const loaded = loadPrompt("stage1-classifier.md");
  const { system, user: userTemplate } = splitPrompt(loaded.content);

  // Fill placeholders.
  let userContent = userTemplate;
  userContent = fill(userContent, "current_jsonb", JSON.stringify(diff.before ?? {}));
  userContent = fill(userContent, "proposed_jsonb", JSON.stringify(diff.after));
  userContent = fill(userContent, "trust_score", String(trustScore));
  userContent = fill(userContent, "submission_count", String(submissionCount));
  userContent = fill(userContent, "accuracy_rate", String(accuracyRate));

  const model = MODELS.classifier;

  // Call the model.
  const response = await anthropic().messages.create({
    model,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: userContent }],
  });

  // Extract text blocks and parse JSON.
  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  const raw = parseJsonResponse<RawClassification>(text);

  // Validate and coerce riskScore.
  const riskScore = Math.min(100, Math.max(0, Math.round(Number(raw.risk_score) || 0)));

  // Validate riskLevel; fall back by score if invalid.
  const riskLevel: ClassifyResult["riskLevel"] = (
    VALID_RISK_LEVELS as readonly string[]
  ).includes(raw.risk_level)
    ? (raw.risk_level as ClassifyResult["riskLevel"])
    : riskLevelFromScore(riskScore);

  // Validate verdict; fall back by level if invalid.
  const verdict: ClassifyResult["verdict"] = (
    VALID_VERDICTS as readonly string[]
  ).includes(raw.verdict)
    ? (raw.verdict as ClassifyResult["verdict"])
    : defaultVerdict(riskLevel);

  // Coerce plausibilityScore.
  const plausibilityScore = Math.min(
    100,
    Math.max(0, Math.round(Number(raw.plausibility_score) || 0)),
  );

  // Build usage from the SDK response shape.
  const usage: Usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  return {
    riskScore,
    riskLevel,
    category: String(raw.category ?? "other"),
    plausibilityScore,
    reasoning: String(raw.reasoning ?? ""),
    verdict,
    usage,
    costCents: computeCostCents(model, usage),
    promptHash: loaded.hash,
    model,
  };
}
