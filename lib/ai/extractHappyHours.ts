/**
 * extractHappyHours — Phase 6 seed enrichment: turns a venue's web content into
 * structured happy_hours + offerings rows (PRD §4.3, §13).
 *
 * Uses Claude's SERVER-SIDE web_fetch + web_search tools. Unlike a raw HTTP fetch,
 * web_fetch renders the page and reads PDFs natively, so JS-collapsed menus and PDF
 * menus (the common case) are actually visible to the model. The tools run
 * server-side; we just loop on `pause_turn` until the model returns its final JSON.
 *
 * Returns typed data only — no DB writes. The caller persists the rows.
 *
 * §13 enforcement in code (not just the prompt):
 *  - happyHours / offerings entries without a non-empty sourceUrl are dropped.
 *  - dayOfWeek values outside 1..7 are dropped.
 *  - confidence is clamped to 0..1.
 */

import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  ToolChoiceTool,
  ToolUnion,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

import { anthropic, parseJsonResponse } from "@/lib/ai/anthropic";
import type { Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExtractInput {
  venueName: string;
  websiteUrl?: string | null;
  otherUrl?: string | null;
}

export interface ExtractedOffering {
  kind: string;
  category: string;
  name: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  discountCents: number | null;
  description: string | null;
  conditions: string | null;
  /** URL actually fetched this run that mentions this item. Required by §13. */
  sourceUrl: string;
}

export interface ExtractedHappyHour {
  /** ISO days this window applies to: 1=Mon … 7=Sun (expanded to one row each on insert) */
  daysOfWeek: number[];
  /** True when the deal applies all open hours on the listed days (no time window). */
  allDay: boolean;
  /** 24-hour "HH:MM"; null when allDay is true */
  startTime: string | null;
  /** 24-hour "HH:MM" or null ("until close") */
  endTime: string | null;
  locationWithinVenue: string;
  notes: string | null;
  /** URL actually fetched this run that contains this schedule. Required by §13. */
  sourceUrl: string;
  offerings: ExtractedOffering[];
}

export interface ExtractResult {
  happyHours: ExtractedHappyHour[];
  /** Overall confidence 0..1 that the returned schedule is current and accurate. */
  confidence: number;
  summary: string;
  /** Token counts summed across all model turns. */
  usage: Usage;
  costCents: number;
  promptHash: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Internal — raw JSON shape the model emits
// ---------------------------------------------------------------------------

interface RawOffering {
  kind?: string;
  category?: string;
  name?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  discountCents?: number | null;
  description?: string | null;
  conditions?: string | null;
  sourceUrl?: string;
}

interface RawHappyHour {
  daysOfWeek?: number[];
  allDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  locationWithinVenue?: string;
  notes?: string | null;
  sourceUrl?: string;
  offerings?: RawOffering[];
}

interface RawExtract {
  happyHours?: RawHappyHour[];
  confidence?: number;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Server-side tools (Claude fetches/searches; renders JS + reads PDFs)
// ---------------------------------------------------------------------------

// COST-BOUNDED on purpose. web_fetch pulls rendered page text into context as input
// tokens, so loose caps blow up cost fast (~$1+/venue at max_uses 8 / 24k tokens).
// We hand the model the venue's real website (Place Details), so it should need only
// a page or two — the HH/menu page, maybe a linked PDF. No web_search: the site is known.
// Schema for the structured-output tool. Forcing the model to "call" this with its
// findings is far more reliable than asking it to free-hand JSON — Haiku in particular
// tends to narrate a prose summary otherwise (it reads the menu fine, just won't emit
// JSON). tool_choice forces this call, so we always get a parseable object.
const RECORD_TOOL: ToolUnion = {
  name: "record_happy_hours",
  description:
    "Record the happy-hour schedule you found for this venue. Call exactly once when done. " +
    "If there is no happy hour, call it with happyHours: [] and confidence: 0.",
  input_schema: {
    type: "object",
    properties: {
      happyHours: {
        type: "array",
        items: {
          type: "object",
          properties: {
            daysOfWeek: {
              type: "array",
              items: { type: "integer" },
              description: "ISO days this window applies to: 1=Mon … 7=Sun, e.g. [1,2,3,4,5]",
            },
            allDay: {
              type: "boolean",
              description:
                "True when the deal explicitly applies all open hours on the listed days (e.g. 'Monday all damn day'). When true, startTime and endTime MUST be null. Do NOT use as a fallback when times are unknown.",
            },
            startTime: {
              type: ["string", "null"],
              description: '24h "HH:MM", or null when allDay is true',
            },
            endTime: { type: ["string", "null"], description: '24h "HH:MM" or null for "until close"' },
            locationWithinVenue: { type: "string", enum: ["bar", "patio", "dining", "all"] },
            notes: { type: ["string", "null"] },
            sourceUrl: { type: "string", description: "Exact URL fetched that shows this schedule" },
            offerings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["food", "drink", "other"] },
                  category: { type: "string", enum: ["beer", "wine", "cocktail", "spirit", "appetizer", "entree", "dessert", "other"] },
                  name: { type: ["string", "null"] },
                  priceCents: { type: ["integer", "null"] },
                  originalPriceCents: { type: ["integer", "null"] },
                  discountCents: { type: ["integer", "null"], description: '"$3 off" → 300' },
                  description: { type: ["string", "null"] },
                  conditions: { type: ["string", "null"] },
                  sourceUrl: { type: "string" },
                },
                required: ["kind", "category", "sourceUrl"],
              },
            },
          },
          required: ["daysOfWeek", "sourceUrl", "offerings"],
        },
      },
      confidence: { type: "number", description: "0..1" },
      summary: { type: "string" },
    },
    required: ["happyHours", "confidence", "summary"],
  },
};

// Cost-tuned 2026-05-28: was max_uses 6 / 12k tokens which cost ~10¢/venue. Dropped
// to 4 / 6k — input tokens (web_fetch payload) dominate cost, so halving the per-fetch
// payload roughly halves spend without hurting recall (most HH pages fit in 6k tokens).
// (allowed_callers: direct — Haiku doesn't do programmatic tool calling.)
const TOOLS: ToolUnion[] = [
  {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 2,
    allowed_callers: ["direct"],
  },
  {
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: 4,
    max_content_tokens: 6_000,
    allowed_callers: ["direct"],
  },
  RECORD_TOOL,
];

// Max times we resume after a `pause_turn` (server tools running). Higher now that the
// model may search + fetch several pages before recording.
const MAX_TURNS = 8;

const VALID_LOCATION = new Set(["bar", "patio", "dining", "all"]);
const VALID_KIND = new Set(["food", "drink", "other"]);
const VALID_CATEGORY = new Set([
  "beer",
  "wine",
  "cocktail",
  "spirit",
  "appetizer",
  "entree",
  "dessert",
  "other",
]);

function fillPlaceholders(template: string, input: ExtractInput): string {
  return template
    .replace("{{venue_name}}", input.venueName)
    .replace("{{website_url}}", input.websiteUrl ?? "none")
    .replace("{{other_url}}", input.otherUrl ?? "none");
}

// Only block COMPETITOR happy-hour listing sites whose business is exactly what we do
// (operator directive 2026-05-27). General listings like Yelp / OpenTable / TripAdvisor
// are fine as sources — the AI often parses better-structured HH offering data from
// them than from the venue's PDF menu, and dropping them silently costs us real data
// (2026-05-28 Blue Hound incident: 9 offerings dropped because Yelp was blocked).
const SOURCE_DENYLIST = [
  "ultimatehappyhours",
  "seattletravel",
  "happyhourdealfinder",
  "happyhour.com",
  "happyhours.com",
  "restaurantji",
  "sirved",
  "singleplatform",
];

function isDenylistedSource(url: string): boolean {
  let host = url.toLowerCase();
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* not a parseable URL — fall back to substring check below */
  }
  return SOURCE_DENYLIST.some((d) => host.includes(d));
}

/** §13: drop offerings with no non-empty sourceUrl, or a competitor-aggregator source. */
function normaliseOffering(raw: RawOffering): ExtractedOffering | null {
  const sourceUrl = raw.sourceUrl?.trim() ?? "";
  if (!sourceUrl || isDenylistedSource(sourceUrl)) return null;

  return {
    kind: VALID_KIND.has(raw.kind ?? "") ? (raw.kind as string) : "other",
    category: VALID_CATEGORY.has(raw.category ?? "")
      ? (raw.category as string)
      : "other",
    name: raw.name ?? null,
    priceCents: typeof raw.priceCents === "number" ? Math.round(raw.priceCents) : null,
    originalPriceCents:
      typeof raw.originalPriceCents === "number"
        ? Math.round(raw.originalPriceCents)
        : null,
    discountCents:
      typeof raw.discountCents === "number" ? Math.round(raw.discountCents) : null,
    description: raw.description ?? null,
    conditions: raw.conditions ?? null,
    sourceUrl,
  };
}

/** §13: drop HH entries with no/denylisted sourceUrl, invalid dayOfWeek, or malformed time shape. */
function normaliseHappyHour(raw: RawHappyHour): ExtractedHappyHour | null {
  const sourceUrl = raw.sourceUrl?.trim() ?? "";
  if (!sourceUrl || isDenylistedSource(sourceUrl)) return null;

  const daysOfWeek = [...new Set(raw.daysOfWeek ?? [])].filter(
    (d) => Number.isInteger(d) && d >= 1 && d <= 7,
  );
  if (daysOfWeek.length === 0) return null;

  const allDay = raw.allDay === true;
  const rawStart = raw.startTime ?? null;
  const rawEnd = raw.endTime ?? null;

  // Enforce the same shape as the DB CHECK so the engine never sees an illegal row:
  //   - allDay=true  → startTime AND endTime must be null
  //   - allDay=false → startTime is required (endTime may be null = "until close")
  // Reject everything else — these are malformed model outputs, not data we can save.
  let startTime: string | null;
  let endTime: string | null;
  if (allDay) {
    if (rawStart !== null || rawEnd !== null) return null;
    startTime = null;
    endTime = null;
  } else {
    if (rawStart === null) return null;
    startTime = rawStart;
    endTime = rawEnd;
  }

  const offerings: ExtractedOffering[] = (raw.offerings ?? [])
    .map(normaliseOffering)
    .filter((o): o is ExtractedOffering => o !== null);

  return {
    allDay,
    daysOfWeek,
    startTime,
    endTime,
    locationWithinVenue: VALID_LOCATION.has(raw.locationWithinVenue ?? "")
      ? (raw.locationWithinVenue as string)
      : "all",
    notes: raw.notes ?? null,
    sourceUrl,
    offerings,
  };
}

// ---------------------------------------------------------------------------
// Reusable pieces (shared by the on-demand loop and the Batch API path)
// ---------------------------------------------------------------------------

/** The single one-shot request params, plus metadata callers need to price + attribute it. */
export interface ExtractRequest {
  params: MessageCreateParamsNonStreaming;
  promptHash: string;
  model: string;
}

/** Build the one-shot request used by both the on-demand loop and the Batch API. */
export function buildExtractRequest(input: ExtractInput): ExtractRequest {
  const loaded = loadPrompt("seed-extract-hh.md");
  const { system: rawSystem, user: rawUser } = splitPrompt(loaded.content);
  const system = fillPlaceholders(rawSystem, input);
  const userText = fillPlaceholders(rawUser, input);
  return {
    params: {
      model: MODELS.extractor,
      // Generous: a full menu's structured record_happy_hours call can be large, and
      // running out mid-tool-call truncates the JSON to nothing (the 0-rows bug).
      max_tokens: 8192,
      system,
      tools: TOOLS,
      messages: [{ role: "user", content: userText }],
    },
    promptHash: loaded.hash,
    model: MODELS.extractor,
  };
}

/** Normalised, §13-clean extraction plus how many raw windows the model proposed before filtering. */
export interface NormalisedExtract {
  happyHours: ExtractedHappyHour[];
  confidence: number;
  summary: string;
  /** Count of windows the model proposed before §13/denylist filtering — lets callers tell "model found nothing" from "all dropped". */
  rawWindowCount: number;
}

/** §13 normalisation shared by the loop and the batch path. */
export function normaliseRawExtract(raw: RawExtract): NormalisedExtract {
  const happyHours: ExtractedHappyHour[] = (raw.happyHours ?? [])
    .map(normaliseHappyHour)
    .filter((hh): hh is ExtractedHappyHour => hh !== null);
  return {
    happyHours,
    confidence: Math.min(1, Math.max(0, raw.confidence ?? 0)),
    summary: raw.summary ?? "",
    rawWindowCount: (raw.happyHours ?? []).length,
  };
}

/** Parse a single returned Message: pull the record_happy_hours tool call (or salvage JSON text). */
export function parseRecordedExtract(
  message: Message,
): NormalisedExtract & { recorded: boolean } {
  const recordCall = message.content.find(
    (b): b is ToolUseBlock =>
      b.type === "tool_use" && b.name === "record_happy_hours",
  );
  if (recordCall) {
    return { ...normaliseRawExtract(recordCall.input as RawExtract), recorded: true };
  }
  // No clean tool call — try to salvage JSON the model left as text.
  let fallbackText = "";
  for (const block of message.content) {
    if (block.type === "text") fallbackText = block.text;
  }
  if (fallbackText) {
    try {
      return {
        ...normaliseRawExtract(parseJsonResponse<RawExtract>(fallbackText)),
        recorded: false,
      };
    } catch {
      /* fall through to empty */
    }
  }
  return { happyHours: [], confidence: 0, summary: "", rawWindowCount: 0, recorded: false };
}

// ---------------------------------------------------------------------------
// Main export — on-demand agentic loop (also the Batch API fallback path)
// ---------------------------------------------------------------------------

export async function extractHappyHours(
  input: ExtractInput,
): Promise<ExtractResult> {
  const { params, promptHash, model } = buildExtractRequest(input);
  const messages: MessageParam[] = [...params.messages];

  const summedUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  const forceRecord: ToolChoiceTool = { type: "tool", name: "record_happy_hours" };

  let lastMessage: Message | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastTurn = turn === MAX_TURNS - 1;
    const response = await anthropic().messages.create({
      ...params,
      messages,
      // On the final turn, force the structured-output tool so we never end with prose.
      ...(lastTurn ? { tool_choice: forceRecord } : {}),
    });
    lastMessage = response;

    summedUsage.inputTokens += response.usage.input_tokens;
    summedUsage.outputTokens += response.usage.output_tokens;

    if (process.env.EXTRACT_DEBUG) {
      console.error(
        `[extract] turn ${turn} stop=${response.stop_reason} blocks=[${response.content
          .map((b) => (b.type === "tool_use" ? `tool_use:${b.name}` : b.type))
          .join(", ")}]`,
      );
    }

    const recorded = response.content.some(
      (b) => b.type === "tool_use" && b.name === "record_happy_hours",
    );
    if (recorded) break;

    // web_fetch runs server-side → pause_turn; resume by echoing content back.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    // Model ended without recording — nudge it to call the tool on the next turn.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content:
        "Call record_happy_hours now with everything you found (happyHours: [] and confidence 0 if none).",
    });
  }

  const parsed = lastMessage
    ? parseRecordedExtract(lastMessage)
    : { happyHours: [], confidence: 0, summary: "", rawWindowCount: 0, recorded: false };

  return {
    happyHours: parsed.happyHours,
    confidence: parsed.confidence,
    summary: parsed.summary,
    usage: summedUsage,
    costCents: calcCostCents(model, summedUsage),
    promptHash,
    model,
  };
}
