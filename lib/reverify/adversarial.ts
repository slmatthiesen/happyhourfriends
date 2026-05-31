/**
 * Adversarial re-check of an existing all-day happy-hour claim. Uses server-side
 * web_fetch + web_search and forces a structured `record_verdict` tool call. Independent
 * of the seed extractor on purpose (a skeptical second opinion). Returns a typed Verdict
 * plus usage for the ledger. No DB writes.
 */
import type {
  Message,
  MessageParam,
  ToolChoiceTool,
  ToolUnion,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { anthropic } from "@/lib/ai/anthropic";
import type { Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import type { Verdict } from "@/lib/reverify/policy";

export interface ReverifyInput {
  venueName: string;
  address: string | null;
  websiteUrl: string | null;
  currentDays: number[];
  sourceUrl: string | null;
}

const RECORD_VERDICT: ToolUnion = {
  name: "record_verdict",
  description: "Record your single verdict about this all-day happy-hour claim. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["real_window", "legit_all_day", "not_happy_hour", "unconfirmable"] },
      startTime: { type: ["string", "null"], description: '24h "HH:MM" — real_window only' },
      endTime: { type: ["string", "null"], description: '24h "HH:MM" or null ("until close") — real_window only' },
      daysOfWeek: { type: "array", items: { type: "integer" }, description: "ISO 1=Mon..7=Sun" },
      quote: { type: "string", description: "VERBATIM source text backing the verdict (required for real_window / legit_all_day)" },
      sourceUrl: { type: "string", description: "URL the quote came from" },
      servesAlcohol: { type: "boolean" },
      reasoning: { type: "string" },
    },
    required: ["kind", "servesAlcohol", "reasoning"],
  },
};

const TOOLS: ToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_callers: ["direct"] },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 8_000, allowed_callers: ["direct"] },
  RECORD_VERDICT,
];
const MAX_TURNS = 8;

interface RawVerdict {
  kind?: string;
  startTime?: string | null;
  endTime?: string | null;
  daysOfWeek?: number[];
  quote?: string;
  sourceUrl?: string;
  servesAlcohol?: boolean;
  reasoning?: string;
}

/** Parse the forced record_verdict tool call into a typed Verdict, enforcing the quote rule. */
export function parseVerdict(message: Message): Verdict | null {
  const call = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_verdict",
  );
  if (!call) return null;
  const raw = call.input as RawVerdict;
  const quote = (raw.quote ?? "").trim();
  const sourceUrl = (raw.sourceUrl ?? "").trim();
  const servesAlcohol = raw.servesAlcohol === true;
  const reasoning = raw.reasoning ?? "";
  const days = [...new Set(raw.daysOfWeek ?? [])].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);

  // The quote-or-nothing rule: verdicts that assert a schedule must carry a verbatim quote.
  if (raw.kind === "real_window") {
    if (!quote || !sourceUrl || !raw.startTime) return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
    return { kind: "real_window", startTime: raw.startTime, endTime: raw.endTime ?? null, daysOfWeek: days, quote, sourceUrl, servesAlcohol, reasoning };
  }
  if (raw.kind === "legit_all_day") {
    if (!quote || !sourceUrl) return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
    return { kind: "legit_all_day", daysOfWeek: days, quote, sourceUrl, servesAlcohol, reasoning };
  }
  if (raw.kind === "not_happy_hour") return { kind: "not_happy_hour", quote, sourceUrl, servesAlcohol, reasoning };
  return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
}

export interface ReverifyResult {
  verdict: Verdict | null;
  usage: Usage;
  costCents: number;
  promptHash: string;
  model: string;
}

function fill(t: string, i: ReverifyInput): string {
  return t
    .replace("{{venue_name}}", i.venueName)
    .replace("{{address}}", i.address ?? "unknown")
    .replace("{{website_url}}", i.websiteUrl ?? "none")
    .replace("{{current_days}}", JSON.stringify(i.currentDays))
    .replace("{{source_url}}", i.sourceUrl ?? "none");
}

export async function reverifyAllDay(input: ReverifyInput): Promise<ReverifyResult> {
  const loaded = loadPrompt("reverify-all-day.md");
  const { system: rawSys, user: rawUser } = splitPrompt(loaded.content);
  const model = MODELS.verifier;
  const base = {
    model,
    max_tokens: 2048,
    system: fill(rawSys, input),
    tools: TOOLS,
  };
  const messages: MessageParam[] = [{ role: "user", content: fill(rawUser, input) }];
  const summed: Usage = { inputTokens: 0, outputTokens: 0 };
  const force: ToolChoiceTool = { type: "tool", name: "record_verdict" };
  let last: Message | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastTurn = turn === MAX_TURNS - 1;
    const res = await anthropic().messages.create({
      ...base, messages, ...(lastTurn ? { tool_choice: force } : {}),
    });
    last = res;
    summed.inputTokens += res.usage.input_tokens;
    summed.outputTokens += res.usage.output_tokens;
    if (res.content.some((b) => b.type === "tool_use" && b.name === "record_verdict")) break;
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: "Call record_verdict now with your single verdict." });
  }

  return {
    verdict: last ? parseVerdict(last) : null,
    usage: summed,
    costCents: calcCostCents(model, summed),
    promptHash: loaded.hash,
    model,
  };
}
