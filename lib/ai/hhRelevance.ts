/**
 * hhRelevance — the Haiku gate that decides whether a page is worth the (more expensive)
 * happy-hour extractor. It reads page CONTENT and answers one question: "does this describe
 * a recurring happy hour?" — replacing the brittle URL/keyword heuristics that paid to read
 * soft-404 catch-alls, covid notices, operating hours, and hotel-package pages.
 *
 * Pure pieces (snippet/request/parse/fold) are unit-tested; classifyHhRelevance is the only
 * I/O and takes an injectable client so tests run with no API key. The gate is a COST
 * optimizer, not a correctness gate: every failure path fails OPEN (relevant=true) so a real
 * happy hour is never dropped because the cheap classifier erred.
 */
import type {
  Message,
  MessageCreateParamsNonStreaming,
  ToolUnion,
  ToolChoiceTool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { anthropic, type Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import { HH_RE, DEAL_RE } from "@/lib/places/hhText";
import type { FetchedPage } from "@/lib/ai/siteContent";

/** Per-page and total caps on the text we feed Haiku — relevance needs a sample, not the
 *  whole site. Keeps the input cheap (this is the point of gating). */
const PER_PAGE_CHARS = 2_500;
const TOTAL_CHARS = 8_000;

/** Window an excerpt around the FIRST happy-hour/deal signal so a long page can't hide the
 *  HH below the cap (the free hasSignal gate already confirmed a signal exists somewhere —
 *  taking only the page head would let Haiku miss it and skip a real happy hour). Falls back
 *  to the head when there's no keyword match or the page already fits. */
function windowAroundSignal(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const m = text.match(HH_RE) ?? text.match(DEAL_RE);
  if (!m || m.index === undefined) return text.slice(0, cap);
  const start = Math.max(0, m.index - Math.floor(cap / 2));
  return text.slice(start, start + cap);
}

export interface HhRelevanceVerdict {
  relevant: boolean;
  reason: string;
  usage: Usage;
  costCents: number;
  model: string;
  promptHash: string;
}

const RECORD_RELEVANCE: ToolUnion = {
  name: "record_relevance",
  description: "Record whether the provided page content describes a recurring happy hour.",
  input_schema: {
    type: "object",
    properties: {
      is_recurring_happy_hour: {
        type: "boolean",
        description: "True only for a recurring, time-bounded food/drink discount.",
      },
      reason: { type: "string", description: "One sentence justifying the verdict." },
    },
    required: ["is_recurring_happy_hour", "reason"],
  },
};

const FORCE_RELEVANCE: ToolChoiceTool = { type: "tool", name: "record_relevance" };

/** Build the labelled, capped text snippet from the HTML pages. null when there is no HTML
 *  text to judge (doc-only / empty) — the caller then fails open without a model call. */
export function buildRelevanceSnippet(pages: FetchedPage[]): string | null {
  const parts: string[] = [];
  let total = 0;
  for (const p of pages) {
    if (typeof p.text !== "string" || p.text.trim().length === 0) continue;
    if (total >= TOTAL_CHARS) break;
    const room = Math.min(PER_PAGE_CHARS, TOTAL_CHARS - total);
    const body = windowAroundSignal(p.text.trim(), room);
    parts.push(`Source: ${p.url}\n${body}`);
    total += body.length;
  }
  return parts.length ? parts.join("\n\n---\n\n") : null;
}

export interface RelevanceRequest {
  params: MessageCreateParamsNonStreaming;
  promptHash: string;
  model: string;
}

/** Build the one-shot forced-tool request. null when there's no HTML text to judge. */
export function buildRelevanceRequest(
  pages: FetchedPage[],
  venueName: string,
): RelevanceRequest | null {
  const snippet = buildRelevanceSnippet(pages);
  if (snippet === null) return null;
  const loaded = loadPrompt("hh-relevance.md");
  const { system, user } = splitPrompt(loaded.content);
  const userText = user.replace("{{venue_name}}", venueName).replace("{{pages}}", snippet);
  return {
    params: {
      model: MODELS.relevance,
      max_tokens: 256,
      system,
      tools: [RECORD_RELEVANCE],
      tool_choice: FORCE_RELEVANCE,
      messages: [{ role: "user", content: userText }],
    },
    promptHash: loaded.hash,
    model: MODELS.relevance,
  };
}

/** Read the record_relevance tool call. Fail OPEN (relevant=true) on anything unexpected. */
export function parseRelevanceVerdict(message: Message): { relevant: boolean; reason: string } {
  const call = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_relevance",
  );
  if (!call) return { relevant: true, reason: "no tool call — fail open" };
  const input = call.input as { is_recurring_happy_hour?: unknown; reason?: unknown };
  // Only an explicit boolean false skips; anything else fails open.
  const relevant = input.is_recurring_happy_hour !== false;
  const reason = typeof input.reason === "string" ? input.reason : "";
  return { relevant, reason };
}

/** Add a relevance call's usage + cents onto a base extraction result's cost fields. */
export function foldRelevanceCost<T extends { usage: Usage; costCents: number }>(
  base: T,
  rel: { usage: Usage; costCents: number },
): T {
  return {
    ...base,
    usage: {
      inputTokens: base.usage.inputTokens + rel.usage.inputTokens,
      outputTokens: base.usage.outputTokens + rel.usage.outputTokens,
    },
    costCents: base.costCents + rel.costCents,
  };
}

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

/** A minimal structural type for the Anthropic client (injectable for tests). */
export type AnthropicLike = { messages: { create: (p: MessageCreateParamsNonStreaming) => Promise<Message> } };

export interface ClassifyRelevanceOpts {
  client?: AnthropicLike;
}

export interface ClassifyRelevanceInput {
  pages: FetchedPage[];
  venueName: string;
}

/**
 * The gate. Returns relevant=true at $0 (no model call) when there is no HTML to judge, and
 * fails open (relevant=true) on any model/parse error — never drop a real HH on a hiccup.
 */
export async function classifyHhRelevance(
  input: ClassifyRelevanceInput,
  opts: ClassifyRelevanceOpts = {},
): Promise<HhRelevanceVerdict> {
  const req = buildRelevanceRequest(input.pages, input.venueName);
  if (req === null) {
    return { relevant: true, reason: "no HTML text to judge", usage: ZERO_USAGE, costCents: 0, model: MODELS.relevance, promptHash: "" };
  }
  const client = opts.client ?? (anthropic() as unknown as AnthropicLike);
  try {
    const message = await client.messages.create(req.params);
    const usage: Usage = {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    };
    const { relevant, reason } = parseRelevanceVerdict(message);
    return { relevant, reason, usage, costCents: calcCostCents(req.model, usage), model: req.model, promptHash: req.promptHash };
  } catch (e) {
    if (process.env.EXTRACT_DEBUG) console.error(`[relevance] fail-open: ${(e as Error).message}`);
    return { relevant: true, reason: "relevance call failed — fail open", usage: ZERO_USAGE, costCents: 0, model: req.model, promptHash: req.promptHash };
  }
}
