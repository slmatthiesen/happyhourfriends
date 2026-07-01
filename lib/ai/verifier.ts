/**
 * verifier — Stage 2 AI verifier for proposed happy-hour data changes (PRD §4.3).
 *
 * Runs a tool-use loop against the verifier prompt: the model may call fetch_url
 * and web_search (executed locally) before returning a JSON verdict. Tokens are
 * summed across all turns to price the entire verification pass.
 */

import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";

import { clientForModel, parseJsonResponse } from "@/lib/ai/anthropic";
import type { Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import { fetchUrl, type FetchResult } from "@/lib/verification/fetchUrl";
import { webSearch } from "@/lib/verification/webSearch";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Uploaded evidence the model can read directly: a menu photo or a menu PDF. */
export type EvidenceMedia =
  | {
      kind: "image";
      base64: string;
      mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    }
  | { kind: "document"; base64: string }; // application/pdf

export interface VerifyInput {
  venueName: string;
  websiteUrl?: string | null;
  otherUrl?: string | null;
  diffSummary: string;
  /** A photo or PDF of the menu the submitter uploaded, for the model to read. */
  evidenceMedia?: EvidenceMedia | null;
}

export interface Evidence {
  source: "website" | "facebook" | "google" | "instagram" | "yelp" | "other";
  url: string;
  snippet: string;
  supportsChange: boolean;
}

export interface VerifyResult {
  confirmed: boolean | null;
  evidence: Evidence[];
  confidence: number; // 0..1
  summary: string;
  usage: Usage; // summed across all model turns
  costCents: number;
  promptHash: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Internal — raw JSON shape the model emits
// ---------------------------------------------------------------------------

interface RawEvidence {
  source?: string;
  url?: string;
  snippet?: string;
  supports_change?: boolean;
}

interface RawVerdict {
  confirmed?: boolean | null;
  evidence?: RawEvidence[];
  confidence?: number;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON-schema input_schema for the SDK)
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: "fetch_url",
    description:
      "Fetch the content of a URL. Respects robots.txt. Returns plain text (HTML stripped).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Fully-qualified URL to fetch." },
      },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web for a query. Returns up to 8 results with title, url, snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string." },
      },
      required: ["query"],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_TOOL_CONTENT = 6_000; // chars per tool result passed back to model
const MAX_TURNS = 6;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + " … [truncated]";
}

function fillPlaceholders(
  template: string,
  input: VerifyInput,
): string {
  return template
    .replace("{{venue_name}}", input.venueName)
    .replace("{{website_url}}", input.websiteUrl ?? "none")
    .replace("{{other_url}}", input.otherUrl ?? "none")
    .replace("{{diff_summary}}", input.diffSummary);
}

const VALID_SOURCES = new Set([
  "website",
  "facebook",
  "google",
  "instagram",
  "yelp",
  "other",
]);

function normaliseSource(raw?: string): Evidence["source"] {
  if (raw && VALID_SOURCES.has(raw)) return raw as Evidence["source"];
  return "other";
}

function normaliseEvidence(raw: RawEvidence[]): Evidence[] {
  return raw.map((r) => ({
    source: normaliseSource(r.source),
    url: r.url ?? "",
    snippet: r.snippet ?? "",
    supportsChange: r.supports_change ?? false,
  }));
}

// ---------------------------------------------------------------------------
// Vision sidecar + cost accounting
// ---------------------------------------------------------------------------

/**
 * Accumulates token usage per model across a verify() run so a mixed Haiku-loop +
 * Sonnet-vision pass is priced correctly (each model at its own rate) and the ledger
 * gets one combined row. `label()` names the model(s) actually used.
 */
class SpendAccount {
  private readonly byModel = new Map<string, Usage>();
  add(model: string, u: { input_tokens: number; output_tokens: number }): void {
    const cur = this.byModel.get(model) ?? { inputTokens: 0, outputTokens: 0 };
    cur.inputTokens += u.input_tokens;
    cur.outputTokens += u.output_tokens;
    this.byModel.set(model, cur);
  }
  usage(): Usage {
    const total: Usage = { inputTokens: 0, outputTokens: 0 };
    for (const u of this.byModel.values()) {
      total.inputTokens += u.inputTokens;
      total.outputTokens += u.outputTokens;
    }
    return total;
  }
  costCents(): number {
    let cents = 0;
    for (const [model, u] of this.byModel) cents += calcCostCents(model, u);
    return cents;
  }
  label(): string {
    return [...this.byModel.keys()].join("+");
  }
}

const VISION_PROMPT =
  "Transcribe this venue menu/flyer image. List verbatim any happy-hour, drink-special, " +
  "or food-special content: days, times, item names, prices, and any stated conditions " +
  '(e.g. "dine-in only"). Quote exact printed text; do not infer, summarise, or add anything ' +
  "not printed. If it contains no happy-hour or special-pricing content, reply with exactly " +
  "NO_HAPPY_HOUR_CONTENT.";

function mediaBlock(media: EvidenceMedia): ContentBlockParam {
  return media.kind === "document"
    ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: media.base64 },
      }
    : {
        type: "image",
        source: { type: "base64", media_type: media.mediaType, data: media.base64 },
      };
}

/**
 * Read one image/PDF with the vision model and return its transcribed HH-relevant text,
 * so the (cheap, text-only) loop model never has to process pixels. Resilient: a vision
 * failure yields a sentinel the loop can reason about rather than aborting the whole run.
 */
async function describeMedia(
  media: EvidenceMedia,
  spend: SpendAccount,
): Promise<string> {
  const visionModel = MODELS.verifierVision;
  try {
    const res = await clientForModel(visionModel).messages.create({
      model: visionModel,
      max_tokens: 1024,
      messages: [
        { role: "user", content: [{ type: "text", text: VISION_PROMPT }, mediaBlock(media)] },
      ],
    });
    spend.add(visionModel, res.usage);
    for (const b of res.content) if (b.type === "text") return b.text.trim();
    return "[vision returned no text]";
  } catch {
    return "[vision extraction failed — could not read the attached media]";
  }
}

/** Build an EvidenceMedia from a fetch_url result that returned a PDF or image, else null. */
function mediaFromFetch(result: FetchResult): EvidenceMedia | null {
  if (result.isPdf && result.pdfBase64) {
    return { kind: "document", base64: result.pdfBase64 };
  }
  if (result.isImage && result.imageBase64 && result.imageMediaType) {
    return {
      kind: "image",
      base64: result.imageBase64,
      mediaType: result.imageMediaType,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function verify(input: VerifyInput): Promise<VerifyResult> {
  const loaded = loadPrompt("stage2-verifier.md");
  const { system: rawSystem, user: rawUser } = splitPrompt(loaded.content);

  const system = fillPlaceholders(rawSystem, input);
  const userText = fillPlaceholders(rawUser, input);

  const spend = new SpendAccount();
  const model = MODELS.verifier;

  // Every image/PDF is transcribed to text by the vision sidecar so the loop model stays
  // text-only. When the submitter attached a menu photo/PDF, read it up front and fold the
  // transcription into the opening turn as first-party evidence.
  let initialContent: string | ContentBlockParam[] = userText;
  if (input.evidenceMedia) {
    const transcript = await describeMedia(input.evidenceMedia, spend);
    const kind = input.evidenceMedia.kind === "document" ? "PDF" : "photo";
    initialContent =
      userText +
      `\n\nThe submitter attached a ${kind} of the venue's happy-hour menu as primary ` +
      "evidence. A vision model transcribed it verbatim as:\n\n" +
      transcript +
      '\n\nIf this supports the change, treat it as a first-party source (cite it with ' +
      'source "other" and url "submitted-menu").';
  }

  const messages: MessageParam[] = [{ role: "user", content: initialContent }];

  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await clientForModel(model).messages.create({
      model,
      max_tokens: 2048,
      system,
      tools: TOOLS,
      messages,
    });

    spend.add(model, response.usage);

    if (response.stop_reason !== "tool_use") {
      // Final text response
      for (const block of response.content) {
        if (block.type === "text") {
          finalText = block.text;
          break;
        }
      }
      break;
    }

    // Collect all tool_use blocks from this response turn
    const toolUseBlocks = response.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    // Build tool results
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        if (block.name === "fetch_url") {
          const { url } = block.input as { url: string };
          const result = await fetchUrl(url);

          // A PDF or image (common for menus): transcribe it via the vision sidecar and
          // hand the loop model plain text, so it never has to process pixels itself.
          const media = result.ok ? mediaFromFetch(result) : null;
          if (media) {
            const kind = media.kind === "document" ? "PDF" : "image";
            const transcript = await describeMedia(media, spend);
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: `Fetched a ${kind} from ${url}. Vision transcription:\n\n${transcript}`,
            };
          }

          const output = {
            ...result,
            pdfBase64: undefined,
            imageBase64: undefined,
            contentText: result.contentText
              ? truncate(result.contentText, MAX_TOOL_CONTENT)
              : undefined,
          };
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: truncate(JSON.stringify(output), MAX_TOOL_CONTENT),
          };
        }

        if (block.name === "web_search") {
          const { query } = block.input as { query: string };
          const results = await webSearch(query);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: truncate(JSON.stringify(results), MAX_TOOL_CONTENT),
          };
        }

        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: truncate(
            JSON.stringify({ error: `Unknown tool: ${block.name}` }),
            MAX_TOOL_CONTENT,
          ),
        };
      }),
    );

    // Append assistant turn + tool results as next user message
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  // Parse the final JSON verdict
  let raw: RawVerdict = {};
  try {
    raw = parseJsonResponse<RawVerdict>(finalText);
  } catch {
    // If parsing fails, return an inconclusive result
    raw = { confirmed: null, evidence: [], confidence: 0, summary: finalText.slice(0, 500) };
  }

  const confidence = Math.min(1, Math.max(0, raw.confidence ?? 0));
  const evidence = normaliseEvidence(raw.evidence ?? []);

  return {
    confirmed: raw.confirmed ?? null,
    evidence,
    confidence,
    summary: raw.summary ?? "",
    usage: spend.usage(),
    costCents: spend.costCents(),
    promptHash: loaded.hash,
    model: spend.label() || model,
  };
}
