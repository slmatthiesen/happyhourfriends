/**
 * AI relevance pass on uploaded evidence images — the second gate behind Google
 * SafeSearch. SafeSearch (lib/moderation/safeSearch.ts, fail-CLOSED) screens unsafe
 * content; this Haiku vision check screens IRRELEVANT content (memes, selfies, blank
 * frames) that is safe but isn't venue evidence.
 *
 * Fail-OPEN by design: safety is already covered by SafeSearch, so an Anthropic
 * hiccup or missing key must never block a legitimate submitter. Rejections need an
 * explicit `is_venue_evidence: false` from the model.
 */
import type {
  Message,
  MessageCreateParamsNonStreaming,
  Tool,
  ToolChoiceTool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { anthropic, type Usage } from "@/lib/ai/anthropic";
import { MODELS } from "@/lib/ai/models";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import { recordUsage } from "@/lib/ai/ledger";

/** Image media types Claude vision accepts; anything else skips the check (fail open). */
const VISION_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
type VisionMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const RECORD_VERDICT: Tool = {
  name: "record_evidence_verdict",
  description: "Record whether the uploaded image is plausibly venue evidence.",
  input_schema: {
    type: "object",
    properties: {
      is_venue_evidence: {
        type: "boolean",
        description: "true when the image could document a venue, its menu, deals, or premises",
      },
      reason: { type: "string", description: "One short sentence explaining the verdict." },
    },
    required: ["is_venue_evidence", "reason"],
  },
};
const FORCE_VERDICT: ToolChoiceTool = { type: "tool", name: "record_evidence_verdict" };

/** Minimal structural Anthropic client (injectable for tests). */
export type AnthropicLike = {
  messages: { create: (p: MessageCreateParamsNonStreaming) => Promise<Message> };
};

export interface EvidenceCheckInput {
  base64: string;
  mime: string;
  venueName: string;
}

export interface EvidenceCheckResult {
  allowed: boolean;
  reason: string;
  /** False when no model call was made (unsupported mime / no key). */
  checked: boolean;
}

export function buildEvidenceCheckRequest(
  input: EvidenceCheckInput,
): { params: MessageCreateParamsNonStreaming; promptHash: string; model: string } | null {
  const mime = input.mime.toLowerCase();
  if (!VISION_MIME.has(mime)) return null;
  const loaded = loadPrompt("evidence-image-check.md");
  const { system, user } = splitPrompt(loaded.content);
  return {
    params: {
      model: MODELS.relevance,
      max_tokens: 256,
      system,
      tools: [RECORD_VERDICT],
      tool_choice: FORCE_VERDICT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mime as VisionMime, data: input.base64 },
            },
            { type: "text", text: user.replace("{{venue_name}}", input.venueName || "(unknown venue)") },
          ],
        },
      ],
    },
    promptHash: loaded.hash,
    model: MODELS.relevance,
  };
}

/** Read the forced tool call. Fail OPEN (allowed) on anything unexpected. */
export function parseEvidenceVerdict(message: Message): { allowed: boolean; reason: string } {
  const call = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_evidence_verdict",
  );
  if (!call) return { allowed: true, reason: "no tool call — fail open" };
  const input = call.input as { is_venue_evidence?: unknown; reason?: unknown };
  // Only an explicit boolean false rejects; anything else fails open.
  const allowed = input.is_venue_evidence !== false;
  const reason = typeof input.reason === "string" ? input.reason : "";
  return { allowed, reason };
}

/**
 * Run the relevance check on an uploaded image. Skips (allowed) when the mime isn't
 * vision-readable or no ANTHROPIC_API_KEY is set; fails open on model errors. Spend
 * is recorded to ai_usage_ledger (stage `evidence_check`) — best-effort, never throws.
 */
export async function checkEvidenceRelevance(
  input: EvidenceCheckInput,
  client?: AnthropicLike,
): Promise<EvidenceCheckResult> {
  const req = buildEvidenceCheckRequest(input);
  if (!req) return { allowed: true, reason: "unsupported image type — skipped", checked: false };
  if (!client && !process.env.ANTHROPIC_API_KEY) {
    return { allowed: true, reason: "no ANTHROPIC_API_KEY — skipped", checked: false };
  }
  const c = client ?? (anthropic() as unknown as AnthropicLike);
  try {
    const message = await c.messages.create(req.params);
    const usage: Usage = {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    };
    try {
      await recordUsage({
        stage: "evidence_check",
        model: req.model,
        usage,
        costCents: calcCostCents(req.model, usage),
        promptHash: req.promptHash,
      });
    } catch {
      // Ledger failure must not block a submission.
    }
    const { allowed, reason } = parseEvidenceVerdict(message);
    return {
      allowed,
      reason: allowed
        ? reason
        : "That image doesn't look like venue evidence (menu, sign, storefront…). Please upload a photo of the menu or deal.",
      checked: true,
    };
  } catch {
    return { allowed: true, reason: "relevance call failed — fail open", checked: false };
  }
}
