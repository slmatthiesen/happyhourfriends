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
  /** ISO day-of-week: 1=Mon … 7=Sun */
  dayOfWeek: number;
  /** 24-hour "HH:MM" */
  startTime: string;
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
  dayOfWeek?: number;
  startTime?: string;
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
            dayOfWeek: { type: "integer", description: "ISO 1=Mon … 7=Sun" },
            startTime: { type: "string", description: '24h "HH:MM"' },
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
          required: ["dayOfWeek", "startTime", "sourceUrl", "offerings"],
        },
      },
      confidence: { type: "number", description: "0..1" },
      summary: { type: "string" },
    },
    required: ["happyHours", "confidence", "summary"],
  },
};

const TOOLS: ToolUnion[] = [
  {
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: 3,
    max_content_tokens: 6_000,
    // Haiku doesn't support "programmatic" tool calling (the default for web_fetch);
    // pin it to direct calling so cheaper models can use it.
    allowed_callers: ["direct"],
  },
  RECORD_TOOL,
];

// Max times we resume after a `pause_turn` (server tools running).
const MAX_TURNS = 4;

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

/** §13: drop offerings that have no non-empty sourceUrl. */
function normaliseOffering(raw: RawOffering): ExtractedOffering | null {
  const sourceUrl = raw.sourceUrl?.trim() ?? "";
  if (!sourceUrl) return null;

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

/** §13: drop happyHours entries that have no non-empty sourceUrl or invalid dayOfWeek. */
function normaliseHappyHour(raw: RawHappyHour): ExtractedHappyHour | null {
  const sourceUrl = raw.sourceUrl?.trim() ?? "";
  if (!sourceUrl) return null;

  const dayOfWeek = raw.dayOfWeek ?? 0;
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) return null;

  const offerings: ExtractedOffering[] = (raw.offerings ?? [])
    .map(normaliseOffering)
    .filter((o): o is ExtractedOffering => o !== null);

  return {
    dayOfWeek,
    startTime: raw.startTime ?? "00:00",
    endTime: raw.endTime ?? null,
    locationWithinVenue: VALID_LOCATION.has(raw.locationWithinVenue ?? "")
      ? (raw.locationWithinVenue as string)
      : "all",
    notes: raw.notes ?? null,
    sourceUrl,
    offerings,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function extractHappyHours(
  input: ExtractInput,
): Promise<ExtractResult> {
  const loaded = loadPrompt("seed-extract-hh.md");
  const { system: rawSystem, user: rawUser } = splitPrompt(loaded.content);

  const system = fillPlaceholders(rawSystem, input);
  const userText = fillPlaceholders(rawUser, input);

  const messages: MessageParam[] = [{ role: "user", content: userText }];

  const summedUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  const model = MODELS.extractor;
  const forceRecord: ToolChoiceTool = { type: "tool", name: "record_happy_hours" };

  let raw: RawExtract = { happyHours: [], confidence: 0, summary: "" };
  let fallbackText = "";
  let recorded = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastTurn = turn === MAX_TURNS - 1;
    const response = await anthropic().messages.create({
      model,
      max_tokens: 4096,
      system,
      tools: TOOLS,
      messages,
      // On the final turn, force the structured-output tool so we never end with prose.
      ...(lastTurn ? { tool_choice: forceRecord } : {}),
    });

    summedUsage.inputTokens += response.usage.input_tokens;
    summedUsage.outputTokens += response.usage.output_tokens;

    if (process.env.EXTRACT_DEBUG) {
      console.error(
        `[extract] turn ${turn} stop=${response.stop_reason} blocks=[${response.content
          .map((b) => (b.type === "tool_use" ? `tool_use:${b.name}` : b.type))
          .join(", ")}]`,
      );
    }

    const recordCall = response.content.find(
      (b): b is ToolUseBlock =>
        b.type === "tool_use" && b.name === "record_happy_hours",
    );
    if (recordCall) {
      raw = recordCall.input as RawExtract;
      recorded = true;
      break;
    }

    for (const block of response.content) {
      if (block.type === "text") fallbackText = block.text;
    }

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

  // Defensive fallback: if no tool call ever landed, salvage any JSON the model left.
  if (!recorded && fallbackText) {
    try {
      raw = parseJsonResponse<RawExtract>(fallbackText);
    } catch {
      raw = { happyHours: [], confidence: 0, summary: fallbackText.slice(0, 500) };
    }
  }

  // Normalise + enforce §13 defensively in code
  const happyHours: ExtractedHappyHour[] = (raw.happyHours ?? [])
    .map(normaliseHappyHour)
    .filter((hh): hh is ExtractedHappyHour => hh !== null);

  const confidence = Math.min(1, Math.max(0, raw.confidence ?? 0));

  return {
    happyHours,
    confidence,
    summary: raw.summary ?? "",
    usage: summedUsage,
    costCents: calcCostCents(model, summedUsage),
    promptHash: loaded.hash,
    model,
  };
}
