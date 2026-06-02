/**
 * Adversarial re-check of an existing all-day happy-hour claim. We fetch the claim's
 * source + the venue website OURSELVES (free, via lib/ai/siteContent) and feed them inline;
 * the model gets NO web tools and is forced to call `record_verdict` in one shot — so it
 * can't autonomously incur Anthropic web_search/web_fetch charges. Independent of the seed
 * extractor on purpose (a skeptical second opinion). Returns a typed Verdict plus usage for
 * the ledger. No DB writes.
 */
import type {
  ContentBlockParam,
  Message,
  ToolChoiceTool,
  ToolUnion,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { anthropic } from "@/lib/ai/anthropic";
import type { Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import { fetchPages, renderPagesAsBlocks } from "@/lib/ai/siteContent";
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

// Only the structured-output tool — no web_search / web_fetch (content is fetched by us).
const TOOLS: ToolUnion[] = [RECORD_VERDICT];

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
  // Guard: a misbehaving model may emit daysOfWeek as a scalar/string instead of an
  // array. new Set(non-iterable) would throw and drop the whole venue from the report,
  // so coerce to [] unless it's genuinely an array (mirrors extractHappyHours.ts).
  const rawDays = Array.isArray(raw.daysOfWeek) ? raw.daysOfWeek : [];
  const days = [...new Set(rawDays)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);

  // The quote-or-nothing rule: verdicts that assert a schedule must carry a verbatim quote.
  if (raw.kind === "real_window") {
    if (!quote || !sourceUrl || !raw.startTime) return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
    return { kind: "real_window", startTime: raw.startTime, endTime: raw.endTime ?? null, daysOfWeek: days, quote, sourceUrl, servesAlcohol, reasoning };
  }
  if (raw.kind === "legit_all_day") {
    // Needs a quote AND at least one valid day — an all-day claim with no days is unconfirmable.
    if (!quote || !sourceUrl || days.length === 0) return { kind: "unconfirmable", quote, sourceUrl, servesAlcohol, reasoning };
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
  const force: ToolChoiceTool = { type: "tool", name: "record_verdict" };

  // Fetch the claim's original source + the venue website ourselves (free, robots-aware).
  // The model gets no web tools and re-judges the claim against the provided content only.
  const pages = await fetchPages([input.sourceUrl, input.websiteUrl]);
  if (pages.length === 0) {
    // Nothing to re-check against → unconfirmable, without spending a token.
    return {
      verdict: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      costCents: 0,
      promptHash: loaded.hash,
      model,
    };
  }

  const content: ContentBlockParam[] = [
    { type: "text", text: fill(rawUser, input) },
    {
      type: "text",
      text:
        "The following content was fetched from this venue's pages. Judge the claim ONLY " +
        "from it; cite the exact 'Source: <url>' as sourceUrl and quote verbatim.",
    },
    ...renderPagesAsBlocks(pages),
  ];

  const res: Message = await anthropic().messages.create({
    model,
    max_tokens: 2048,
    system: fill(rawSys, input),
    tools: TOOLS,
    tool_choice: force,
    messages: [{ role: "user", content }],
  });

  const usage: Usage = {
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
  return {
    verdict: parseVerdict(res),
    usage,
    costCents: calcCostCents(model, usage),
    promptHash: loaded.hash,
    model,
  };
}
