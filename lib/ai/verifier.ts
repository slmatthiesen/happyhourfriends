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

import { anthropic, parseJsonResponse } from "@/lib/ai/anthropic";
import type { Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import { fetchUrl } from "@/lib/verification/fetchUrl";
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
// Main export
// ---------------------------------------------------------------------------

export async function verify(input: VerifyInput): Promise<VerifyResult> {
  const loaded = loadPrompt("stage2-verifier.md");
  const { system: rawSystem, user: rawUser } = splitPrompt(loaded.content);

  const system = fillPlaceholders(rawSystem, input);
  const userText = fillPlaceholders(rawUser, input);

  // When the submitter attached a menu photo or PDF, hand it to the model as primary
  // evidence (vision / native PDF). Otherwise the initial turn is plain text.
  let initialContent: string | ContentBlockParam[] = userText;
  if (input.evidenceMedia) {
    const note =
      userText +
      "\n\nThe submitter attached a " +
      (input.evidenceMedia.kind === "document" ? "PDF" : "photo") +
      " of the venue's happy-hour menu as primary evidence. Read it directly; if it " +
      'supports the change, treat it as a first-party source (cite it with source "other" ' +
      'and url "submitted-menu").';
    const mediaBlock: ContentBlockParam =
      input.evidenceMedia.kind === "document"
        ? {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: input.evidenceMedia.base64,
            },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: input.evidenceMedia.mediaType,
              data: input.evidenceMedia.base64,
            },
          };
    initialContent = [{ type: "text", text: note }, mediaBlock];
  }

  const messages: MessageParam[] = [{ role: "user", content: initialContent }];

  const summedUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  const model = MODELS.verifier;
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic().messages.create({
      model,
      max_tokens: 2048,
      system,
      tools: TOOLS,
      messages,
    });

    // Accumulate token usage
    summedUsage.inputTokens += response.usage.input_tokens;
    summedUsage.outputTokens += response.usage.output_tokens;

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

          // A PDF (common for menus): hand the bytes back as a native document
          // block so Claude reads it (text + OCR) instead of choking on raw bytes.
          if (result.ok && result.isPdf && result.pdfBase64) {
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: [
                {
                  type: "text" as const,
                  text: `Fetched a PDF from ${url}. Reading it as a document:`,
                },
                {
                  type: "document" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "application/pdf" as const,
                    data: result.pdfBase64,
                  },
                },
              ],
            };
          }

          const output = {
            ...result,
            pdfBase64: undefined,
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
    usage: summedUsage,
    costCents: calcCostCents(model, summedUsage),
    promptHash: loaded.hash,
    model,
  };
}
