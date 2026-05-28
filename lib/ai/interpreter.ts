/**
 * interpreter — turns a user's free-text "report a change" (+ optional menu photo/PDF)
 * into concrete, structured changes against a venue's CURRENT data.
 *
 * This is the front of the unified correction flow: a person lazily says "tacos are $3
 * not $2" or "they added $5 wings" or "they closed", and this stage maps that intent
 * onto the existing schema as one or more operations. Each operation becomes an ordinary
 * child submission that flows through the normal classify → verify → admin-apply pipeline
 * (see lib/jobs/handlers/interpret.ts). Nothing is applied here.
 *
 * Scope (operator decision 2026-05):
 *  - MODIFY existing data only: update venue metadata/status, update an existing happy
 *    hour, update an existing offering, or ADD an offering to an EXISTING happy hour.
 *  - NEVER propose a brand-new happy-hour window or a new venue (separate flows).
 *
 * The module is pure: it calls the model and normalises the response. The caller
 * validates ids against the venue, builds `before` from the real row, fans out the
 * children, and records ledger spend.
 */

import type {
  ContentBlockParam,
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
import type { EvidenceMedia } from "@/lib/ai/verifier";
import type { VenueDetail } from "@/lib/queries/venues";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const INTERPRET_ACTIONS = [
  "update_venue",
  "update_happy_hour",
  "update_offering",
  "new_offering",
] as const;
export type InterpretAction = (typeof INTERPRET_ACTIONS)[number];

export interface InterpretInput {
  note: string;
  venue: VenueDetail;
  /** A photo or PDF of the menu the submitter uploaded, for the model to read. */
  evidenceMedia?: EvidenceMedia | null;
}

export interface InterpretedOp {
  action: InterpretAction;
  /** Existing row id for an update; null for new_offering. Validated by the caller. */
  targetId: string | null;
  /** For new_offering: the existing happy hour the offering attaches to. */
  happyHourId: string | null;
  /** Only the changed / new column values. */
  after: Record<string, unknown>;
  summary: string;
  confidence: number;
}

export interface InterpretResult {
  ops: InterpretedOp[];
  /** The change is bigger than we want to fan out (e.g. a wholesale menu replacement). */
  tooLarge: boolean;
  summary: string;
  confidence: number;
  usage: Usage;
  costCents: number;
  promptHash: string;
  model: string;
}

/** Soft cap on the number of changes we fan out from one report (cost guard). */
export const MAX_OPS = 5;

// ---------------------------------------------------------------------------
// Internal — raw JSON shape the model emits
// ---------------------------------------------------------------------------

interface RawOp {
  action?: string;
  targetId?: string | null;
  happyHourId?: string | null;
  after?: Record<string, unknown>;
  summary?: string;
  confidence?: number;
}

interface RawChanges {
  changes?: RawOp[];
  tooLarge?: boolean;
  summary?: string;
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Tool (forced structured output, like seed-extract-hh's record_happy_hours)
// ---------------------------------------------------------------------------

const RECORD_TOOL: ToolUnion = {
  name: "record_changes",
  description:
    "Record the concrete change(s) the user is reporting, mapped onto the venue's " +
    "existing data. Call exactly once. If nothing actionable can be derived, call it " +
    "with changes: [] and confidence: 0.",
  input_schema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        description: `At most ${MAX_OPS} changes. Only modify EXISTING data or add an offering to an EXISTING happy hour.`,
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [...INTERPRET_ACTIONS],
              description:
                "update_venue (name/address/phone/websiteUrl/otherUrl/status), " +
                "update_happy_hour (startTime/endTime/notes/active/daysOfWeek), " +
                "update_offering (name/priceCents/discountCents/etc), " +
                "new_offering (a new deal on an existing happy hour).",
            },
            targetId: {
              type: ["string", "null"],
              description:
                "The id of the existing venue/happy_hour/offering being changed. " +
                "Must be one of the ids given to you. null only for new_offering.",
            },
            happyHourId: {
              type: ["string", "null"],
              description:
                "new_offering ONLY: the id of the existing happy hour the new offering belongs to.",
            },
            after: {
              type: "object",
              description:
                "Only the columns that change, with their new values. Prices are integer " +
                "cents (e.g. $3 → 300). venue status is one of active/closed/paused/no_happy_hour. " +
                "times are 24h 'HH:MM' or null for 'until close'. For new_offering include at " +
                "least kind (food/drink/other) and category (beer/wine/cocktail/spirit/appetizer/entree/dessert/other).",
            },
            summary: {
              type: "string",
              description: "One line describing this specific change, for the admin queue.",
            },
            confidence: { type: "number", description: "0..1 for this change." },
          },
          required: ["action", "after", "summary", "confidence"],
        },
      },
      tooLarge: {
        type: "boolean",
        description:
          "true if the report implies more than a handful of changes (e.g. 'the whole menu " +
          "is different') — set changes: [] and let a human handle it from the photo.",
      },
      summary: { type: "string", description: "Overall one-line summary of what the user reported." },
      confidence: { type: "number", description: "Overall confidence 0..1." },
    },
    required: ["changes", "summary", "confidence"],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact JSON of the venue's current state (with ids) for the model to target. */
function venueStateJson(venue: VenueDetail): string {
  return JSON.stringify({
    id: venue.id,
    name: venue.name,
    status: venue.status,
    address: venue.address,
    phone: venue.phone,
    websiteUrl: venue.websiteUrl,
    otherUrl: venue.otherUrl,
    happyHours: venue.happyHours.map((h) => ({
      id: h.id,
      daysOfWeek: h.daysOfWeek,
      startTime: h.startTime,
      endTime: h.endTime,
      locationWithinVenue: h.locationWithinVenue,
      notes: h.notes,
      active: h.active,
      offerings: h.offerings.map((o) => ({
        id: o.id,
        kind: o.kind,
        category: o.category,
        name: o.name,
        priceCents: o.priceCents,
        discountCents: o.discountCents,
        description: o.description,
        conditions: o.conditions,
      })),
    })),
  });
}

function fillPlaceholders(template: string, input: InterpretInput): string {
  return template
    .replace("{{venue_name}}", input.venue.name)
    .replace("{{venue_state}}", venueStateJson(input.venue))
    .replace("{{note}}", input.note);
}

function normaliseOp(raw: RawOp): InterpretedOp | null {
  const action = (INTERPRET_ACTIONS as readonly string[]).includes(raw.action ?? "")
    ? (raw.action as InterpretAction)
    : null;
  if (!action) return null;
  if (!raw.after || typeof raw.after !== "object") return null;

  return {
    action,
    targetId: typeof raw.targetId === "string" ? raw.targetId : null,
    happyHourId: typeof raw.happyHourId === "string" ? raw.happyHourId : null,
    after: raw.after,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function interpret(input: InterpretInput): Promise<InterpretResult> {
  const loaded = loadPrompt("interpret-submission.md");
  const { system: rawSystem, user: rawUser } = splitPrompt(loaded.content);

  const system = fillPlaceholders(rawSystem, input);
  const userText = fillPlaceholders(rawUser, input);

  // Hand the model the note (+ photo/PDF if attached) and force the structured tool.
  let initialContent: string | ContentBlockParam[] = userText;
  if (input.evidenceMedia) {
    const media: ContentBlockParam =
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
    initialContent = [
      {
        type: "text",
        text:
          userText +
          "\n\nThe submitter also attached a " +
          (input.evidenceMedia.kind === "document" ? "PDF" : "photo") +
          " of the menu — read it to ground the change.",
      },
      media,
    ];
  }

  const messages: MessageParam[] = [{ role: "user", content: initialContent }];
  const model = MODELS.extractor;
  const forceRecord: ToolChoiceTool = { type: "tool", name: "record_changes" };

  const response = await anthropic().messages.create({
    model,
    max_tokens: 2048,
    system,
    tools: [RECORD_TOOL],
    tool_choice: forceRecord,
    messages,
  });

  const usage: Usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  // Pull the forced tool call; fall back to salvaging JSON from text if the SDK
  // surprised us with prose.
  const call = response.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_changes",
  );
  let raw: RawChanges;
  if (call) {
    raw = call.input as RawChanges;
  } else {
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
    try {
      raw = parseJsonResponse<RawChanges>(text);
    } catch {
      raw = { changes: [], summary: text.slice(0, 300), confidence: 0 };
    }
  }

  const ops = (raw.changes ?? [])
    .map(normaliseOp)
    .filter((o): o is InterpretedOp => o !== null)
    .slice(0, MAX_OPS);

  return {
    ops,
    tooLarge: raw.tooLarge === true,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    usage,
    costCents: calcCostCents(model, usage),
    promptHash: loaded.hash,
    model,
  };
}
