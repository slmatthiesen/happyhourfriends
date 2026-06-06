/**
 * extractHappyHours — Phase 6 seed enrichment: turns a venue's web content into
 * structured happy_hours + offerings rows (PRD §4.3, §13).
 *
 * FETCH POLICY (2026-06-01): we fetch the venue's known pages OURSELVES via the free,
 * robots-respecting `fetchUrl` (plain HTTP, no Anthropic billing) and hand the model the
 * page text + any PDFs as content blocks. The model is given NO web tools — it cannot
 * search or fetch, so it can never autonomously run up Anthropic web_search/web_fetch
 * charges (the failure mode that drained ~$30 with no return). This makes every request a
 * single-shot, deterministic call: ideal for the Batch API (50% cheaper) and free of the
 * server-tool surcharge. The only tool is the structured-output `record_happy_hours`.
 *
 * Returns typed data only — no DB writes. The caller persists the rows.
 *
 * §13 enforcement in code (not just the prompt):
 *  - happyHours / offerings entries without a non-empty sourceUrl are dropped.
 *  - dayOfWeek values outside 1..7 are dropped.
 *  - confidence is clamped to 0..1.
 */

import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  ToolChoiceTool,
  ToolUnion,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";

import { anthropic, parseJsonResponse } from "@/lib/ai/anthropic";
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";
import type { Usage } from "@/lib/ai/anthropic";
import { costCents as calcCostCents } from "@/lib/ai/pricing";
import { MODELS } from "@/lib/ai/models";
import { loadPrompt, splitPrompt } from "@/lib/ai/promptHash";
import { fetchPages, renderPagesAsBlocks, pagesHaveExtractableSignal } from "@/lib/ai/siteContent";
import type { FetchedPage } from "@/lib/ai/siteContent";
import { freeExtractFromPages } from "@/lib/ai/freeExtract";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExtractInput {
  venueName: string;
  websiteUrl?: string | null;
  otherUrl?: string | null;
  /** City/locality name, used to scope the web_search fallback (e.g. "Phoenix"). */
  cityName?: string | null;
  /** Venue's own HH/menu pages found by site triage — fetch these FIRST. */
  priorityUrls?: string[];
  /** Skip the headless-render fallback (the free batch sweep wants pure HTTP, no browser). */
  noRender?: boolean;
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
  /** 24-hour "HH:MM"; null when allDay is true, or null start of an "open until X" window */
  startTime: string | null;
  /** 24-hour "HH:MM" or null ("until close" / when allDay) */
  endTime: string | null;
  /**
   * Did we capture a usable time bound — a start, an end, or an explicit all-day claim?
   * False ONLY for a deal we kept with no time info at all (coerced to all-day so it can
   * be stored). Feeds the realness gate and the live "happening now" logic.
   */
  timeKnown: boolean;
  locationWithinVenue: string;
  notes: string | null;
  /** URL actually fetched this run that contains this schedule. Required by §13. */
  sourceUrl: string;
  offerings: ExtractedOffering[];
  /** Free deterministic parse only: force this window HIDDEN (active=false) for review
   *  even when the realness gate would pass it. Unset by the AI extractor. */
  suspect?: boolean;
}

export interface ExtractResult {
  happyHours: ExtractedHappyHour[];
  /** Overall confidence 0..1 that the returned schedule is current and accurate. */
  confidence: number;
  summary: string;
  venueType: string | null;
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
  venueType?: string | null;
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
                "True ONLY when the page explicitly states an all-open-hours deal on a SPECIFIC, NARROW set of days (at most 2, e.g. 'Monday all day'). Never for most/all days of the week (that's regular pricing, not a happy hour). When true, startTime and endTime MUST be null. Never a fallback when times are unknown.",
            },
            startTime: {
              type: ["string", "null"],
              description:
                '24h "HH:MM"; null when allDay is true, when the deal runs from open until ' +
                'a stated end ("open until 6 PM"), or when no time is published. Never fabricate.',
            },
            endTime: { type: ["string", "null"], description: '24h "HH:MM" or null for "until close"' },
            locationWithinVenue: { type: "string", enum: ["bar", "patio", "dining", "all"] },
            notes: { type: ["string", "null"] },
            sourceUrl: { type: "string", description: "Exact URL fetched that shows this schedule" },
            offerings: {
              type: "array",
              description:
                "Supporting discounted items/prices for this window, if any are published. " +
                "MAY BE EMPTY: a happy hour is the recurring day+time WINDOW itself — record the " +
                "window even when the page lists no individual prices or items (offerings: []). " +
                "Never drop a clearly-stated window for lack of itemized prices.",
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
          required: ["daysOfWeek", "sourceUrl"],
        },
      },
      confidence: { type: "number", description: "0..1" },
      summary: { type: "string" },
      venueType: {
        type: ["string", "null"],
        description:
          "The venue category, ONLY if the site/menu makes it clear (e.g. an explicit " +
          "'dive bar', 'hotel bar', 'brewery taproom', 'wine bar'). One of: restaurant, " +
          "bar, sports_bar, pub, dive_bar, wine_bar, brewery, tasting_room, " +
          "cocktail_lounge, gastropub, club, cafe, hotel_bar, pizzeria, other. " +
          "Null when not clearly stated — do not guess.",
      },
    },
    required: ["happyHours", "confidence", "summary"],
  },
};

// The model gets ONLY the structured-output tool. No web_search / web_fetch — content is
// fetched by us (lib/ai/siteContent) and passed inline, so the model cannot fetch or
// search and cannot incur Anthropic web-tool charges. tool_choice forces this one call.
const TOOLS: ToolUnion[] = [RECORD_TOOL];

// How many of the venue's known URLs we fetch and feed the model. priorityUrls (the HH/menu
// pages site triage already found) come first, then the website + other URL. Bounded so a
// link-heavy site can't balloon the input-token bill. fetchUrl caps each page at ~8k chars.
const MAX_FETCH = 12; // probe more candidate pages (multi-source discovery + PDF/image); 404s dropped free.

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
  const priority =
    input.priorityUrls && input.priorityUrls.length > 0
      ? input.priorityUrls.map((u) => `- ${u}`).join("\n")
      : "none";
  return template
    .replace("{{venue_name}}", input.venueName)
    .replace("{{website_url}}", input.websiteUrl ?? "none")
    .replace("{{other_url}}", input.otherUrl ?? "none")
    .replace("{{priority_urls}}", priority)
    .replaceAll("{{city}}", input.cityName?.trim() || "");
}

// Competitor happy-hour listing sites we refuse to source from (§13 first-party
// guard) — definition + rationale in lib/ai/sourceDenylist (isDenylistedSource,
// imported at top), the single source of truth shared with operator tooling.

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

/**
 * Coerce a model-supplied time into a DB-legal 24-hour "HH:MM" string, or null.
 * The model is asked for "HH:MM" strings but doesn't always comply — it sometimes
 * returns a bare hour NUMBER (e.g. "Fish Fry 11AM-9PM" → 11 / 21), which would crash
 * the postgres `time` bind and abort a whole batch persist. Handles: numeric hours,
 * "HH:MM"/"HH:MM:SS", bare "11", and 12-hour "9pm"/"11:30am". Anything else → null.
 */
export function normaliseTime(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const hhmm = (h: number, m: number) =>
    h >= 0 && h <= 23 && m >= 0 && m <= 59
      ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      : null;

  if (typeof v === "number") return Number.isInteger(v) ? hhmm(v, 0) : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;

  // 12-hour: "9pm", "11:30 am", "12am"
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === "p") h += 12;
    return hhmm(h, m[2] ? Number(m[2]) : 0);
  }
  // 24-hour "HH:MM" / "HH:MM:SS"
  m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return hhmm(Number(m[1]), Number(m[2]));
  // bare hour "11"
  m = s.match(/^(\d{1,2})$/);
  if (m) return hhmm(Number(m[1]), 0);

  return null;
}

/** §13: drop HH entries with no/denylisted sourceUrl, invalid dayOfWeek, or malformed time shape. */
function normaliseHappyHour(raw: RawHappyHour): ExtractedHappyHour | null {
  const sourceUrl = raw.sourceUrl?.trim() ?? "";
  if (!sourceUrl || isDenylistedSource(sourceUrl)) return null;

  const daysOfWeek = [...new Set(raw.daysOfWeek ?? [])].filter(
    (d) => Number.isInteger(d) && d >= 1 && d <= 7,
  );
  if (daysOfWeek.length === 0) return null;

  const rawStart = normaliseTime(raw.startTime);
  const rawEnd = normaliseTime(raw.endTime);

  // CAPTURE policy (2026-05-31): never throw away a structurally-valid window for
  // realness reasons — that decision belongs to lib/places/realnessGate downstream.
  // Here we only coerce the row into a DB-legal shape (happy_hours_all_day_shape:
  // all_day=true → both times null; all_day=false → at least one of start/end set):
  //   - explicit all-day claim          → all_day=true, times nulled, timeKnown
  //   - any known start and/or end       → bounded window kept as-is, timeKnown
  //     (incl. "open until X" = start null + end set, and "until close" = start + end null)
  //   - no time info at all, no all-day  → coerce to all_day so it stores; timeKnown=false
  //     so the gate hides it for review (we kept the deal rather than dropping it).
  let allDay: boolean;
  let startTime: string | null;
  let endTime: string | null;
  let timeKnown: boolean;
  if (raw.allDay === true) {
    allDay = true;
    startTime = null;
    endTime = null;
    timeKnown = true;
  } else if (rawStart !== null || rawEnd !== null) {
    allDay = false;
    startTime = rawStart;
    endTime = rawEnd;
    timeKnown = true;
  } else {
    allDay = true;
    startTime = null;
    endTime = null;
    timeKnown = false;
  }

  const offerings: ExtractedOffering[] = (raw.offerings ?? [])
    .map(normaliseOffering)
    .filter((o): o is ExtractedOffering => o !== null);

  return {
    allDay,
    timeKnown,
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
  /** URLs we successfully fetched and fed the model. Empty → nothing to extract from. */
  fetchedUrls: string[];
  /** Free pre-check: do the fetched pages show ANY happy-hour/deal signal (or a PDF/image)?
   *  When false, the page has no happy hour to find — callers skip the paid call ($0). */
  hasSignal: boolean;
  /** The pages we fetched (text/PDF/image). Lets callers run the free deterministic
   *  parser without re-fetching. */
  pages: FetchedPage[];
}

const FORCE_RECORD: ToolChoiceTool = { type: "tool", name: "record_happy_hours" };

/** Model + prompt hash for ledger attribution — input-independent, no fetch. */
export function extractorMetadata(): { model: string; promptHash: string } {
  return { model: MODELS.extractor, promptHash: loadPrompt("seed-extract-hh.md").hash };
}

/**
 * Build the one-shot request used by both the on-demand path and the Batch API. Fetches
 * the venue's pages ourselves (free) and inlines them; the model gets no web tools and is
 * forced to call record_happy_hours, so it returns its findings in exactly one turn.
 */
export async function buildExtractRequest(input: ExtractInput): Promise<ExtractRequest> {
  const loaded = loadPrompt("seed-extract-hh.md");
  const { system: rawSystem, user: rawUser } = splitPrompt(loaded.content);
  const system = fillPlaceholders(rawSystem, input);
  const userText = fillPlaceholders(rawUser, input);

  // Headless render fallback for JS-SPA homepages / robots-blocked menu shortlinks. Lazy +
  // optional: the dynamic import keeps playwright out of the app bundle, and a load failure
  // (e.g. Chromium not installed) degrades to plain-fetch-only rather than breaking enrich.
  let render: typeof import("@/lib/verification/renderUrl").renderUrl | undefined;
  if (!input.noRender && process.env.DISABLE_HEADLESS_RENDER !== "1") {
    try {
      render = (await import("@/lib/verification/renderUrl")).renderUrl;
    } catch {
      render = undefined;
    }
  }
  const pages = await fetchPages(
    // The venue's OWN page goes FIRST: prepending the (up to 12) discovered priorityUrls
    // would push websiteUrl past MAX_FETCH and it never got fetched — so a site whose HH
    // sits on its given URL (Philly's /index.php/scottsdale/) was dropped before fetch.
    [input.websiteUrl, ...(input.priorityUrls ?? []), input.otherUrl],
    MAX_FETCH,
    // Tier-2: menus bury HH deep in big SSR pages — give the extractor a larger,
    // menu-dense budget than the verifier's default 8k (siteContent keeps the
    // highest-signal windows, so this is selected content, not just "more bytes").
    { maxContent: 28_000, render },
  );
  const content: ContentBlockParam[] = [
    { type: "text", text: userText },
    {
      type: "text",
      text:
        pages.length === 0
          ? "No page content could be fetched for this venue. Call record_happy_hours with happyHours: [] and confidence 0."
          : "The following content was fetched from this venue's own pages. Extract ONLY from it. " +
            "Use the exact 'Source: <url>' shown above each page as the sourceUrl for anything you record.",
    },
    ...renderPagesAsBlocks(pages),
  ];

  return {
    params: {
      model: MODELS.extractor,
      // Generous: a full menu's structured record_happy_hours call can be large, and
      // running out mid-tool-call truncates the JSON to nothing (the 0-rows bug).
      max_tokens: 8192,
      system,
      tools: TOOLS,
      tool_choice: FORCE_RECORD,
      messages: [{ role: "user", content }],
    },
    promptHash: loaded.hash,
    model: MODELS.extractor,
    fetchedUrls: pages.map((p) => p.url),
    hasSignal: pagesHaveExtractableSignal(pages),
    pages,
  };
}

/** Normalised, §13-clean extraction plus how many raw windows the model proposed before filtering. */
export interface NormalisedExtract {
  happyHours: ExtractedHappyHour[];
  confidence: number;
  summary: string;
  venueType: string | null;
  /** Count of windows the model proposed before §13/denylist filtering — lets callers tell "model found nothing" from "all dropped". */
  rawWindowCount: number;
}

/** §13 normalisation shared by the loop and the batch path. */
export function normaliseRawExtract(raw: RawExtract): NormalisedExtract {
  // The model is forced to call record_happy_hours, but it does NOT always honor the
  // array shape — it occasionally returns happyHours as an object/string/number. Guard
  // with Array.isArray (a plain `?? []` only catches null/undefined, so a non-array
  // value reaches .map and throws — which previously aborted the whole batch collect).
  const rawWindows = Array.isArray(raw.happyHours) ? raw.happyHours : [];
  const happyHours: ExtractedHappyHour[] = rawWindows
    .map(normaliseHappyHour)
    .filter((hh): hh is ExtractedHappyHour => hh !== null);
  return {
    happyHours,
    confidence: Math.min(1, Math.max(0, raw.confidence ?? 0)),
    summary: raw.summary ?? "",
    venueType: typeof raw.venueType === "string" ? raw.venueType : null,
    rawWindowCount: rawWindows.length,
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
  return { happyHours: [], confidence: 0, summary: "", venueType: null, rawWindowCount: 0, recorded: false };
}

// ---------------------------------------------------------------------------
// Main export — single-shot extraction over pre-fetched content (no web tools)
// ---------------------------------------------------------------------------

const EMPTY_PARSE = {
  happyHours: [] as ExtractedHappyHour[],
  confidence: 0,
  summary: "",
  venueType: null as string | null,
  rawWindowCount: 0,
};

export async function extractHappyHours(
  input: ExtractInput,
): Promise<ExtractResult> {
  const { params, promptHash, model, fetchedUrls, hasSignal, pages } = await buildExtractRequest(input);

  // Nothing fetched (no reachable site / all fetches failed) → no point spending a token.
  if (fetchedUrls.length === 0) {
    return {
      ...EMPTY_PARSE,
      summary: "No venue page content could be fetched.",
      usage: { inputTokens: 0, outputTokens: 0 },
      costCents: 0,
      promptHash,
      model,
    };
  }

  // Free pre-gate: the pages we fetched show NO happy-hour/deal wording and carry no
  // PDF/image menu → there's no happy hour to extract. Skip the paid call (Claude would
  // just return conf 0 after reading "nothing here"). See lib/places/hhText.hasHhOrDealSignal.
  if (!hasSignal) {
    return {
      ...EMPTY_PARSE,
      summary: "No happy-hour or deal signal on the fetched pages — skipped (no model call).",
      usage: { inputTokens: 0, outputTokens: 0 },
      costCents: 0,
      promptHash,
      model,
    };
  }

  // Free deterministic parse: if the fetched HTML yields >=1 CLEAN happy-hour window,
  // take it for $0 and skip the paid model call entirely.
  const free = freeExtractFromPages(pages, { model: "deterministic-html-v1", promptHash });
  if (free) {
    if (process.env.EXTRACT_DEBUG) console.error(`[extract] free parse hit: ${free.happyHours.length} window(s), $0`);
    return free;
  }

  const response: Message = await anthropic().messages.create(params);
  const summedUsage: Usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  if (process.env.EXTRACT_DEBUG) {
    console.error(
      `[extract] stop=${response.stop_reason} fetched=${fetchedUrls.length} blocks=[${response.content
        .map((b) => (b.type === "tool_use" ? `tool_use:${b.name}` : b.type))
        .join(", ")}]`,
    );
  }

  const parsed = parseRecordedExtract(response);

  return {
    happyHours: parsed.happyHours,
    confidence: parsed.confidence,
    summary: parsed.summary,
    venueType: parsed.venueType,
    usage: summedUsage,
    costCents: calcCostCents(model, summedUsage),
    promptHash,
    model,
  };
}
