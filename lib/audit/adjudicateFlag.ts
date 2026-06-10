/**
 * adjudicateFlag — agentic replication of the operator's manual /admin/flags review:
 * deterministic provenance/venue screens ($0), a fresh fetch of the venue's OWN pages
 * with render escalation ($0), then one cheap Haiku compare of stored windows vs page
 * text. Produces a verdict + recommended action; it NEVER writes — callers decide
 * whether to act (scripts/adjudicate-flags.ts previews, the operator applies).
 *
 * Built from the 2026-06-10 review corpus: every screen below caught a real problem in
 * that set (aggregator sources, sibling-brand contamination, airport/resort venues,
 * event-page sourcing, garbled offerings).
 *
 * Pure pieces (screens, request build, parse) are unit-testable; the model call takes
 * an injectable client like hhRelevance.
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
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";
import { sanitizeOfferings } from "@/lib/recover/offeringSanity";
import type { ExtractedOffering } from "@/lib/ai/extractHappyHours";
import type { FetchedPage } from "@/lib/ai/siteContent";

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface StoredOffering {
  kind: string;
  category: string;
  name: string | null;
  priceCents: number | null;
  description: string | null;
}

export interface StoredWindow {
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  sourceUrl: string | null;
  notes: string | null;
  offerings: StoredOffering[];
}

export interface AdjudicationInput {
  venueName: string;
  websiteUrl: string | null;
  address: string | null;
  windows: StoredWindow[];
  pages: FetchedPage[];
}

// ── Stage A: deterministic screens ($0) ───────────────────────────────────────

const EVENT_PATH_RE = /\/(weddings?|events?|catering|groups?|private|party|parties|banquet)/i;
const AIRPORT_RE = /\b(airport|sky ?(hbr|harbor) blvd|terminal \d|concourse)\b/i;
const RESORT_RE = /\b(resort|casino)\b/i;

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Registrable-ish domain: last two labels. Good enough to match own-site subdomains
 *  (catering.veroamorepizza.com → veroamorepizza.com) without a PSL dependency. */
function baseDomain(h: string): string {
  const parts = h.split(".");
  return parts.slice(-2).join(".");
}

export type SourceClass =
  | "own"
  | "own_subdomain"
  | "denylisted_aggregator"
  | "social"
  | "third_party";

export function classifySourceUrl(sourceUrl: string, websiteUrl: string | null): SourceClass {
  if (isDenylistedSource(sourceUrl)) return "denylisted_aggregator";
  const sh = host(sourceUrl);
  if (!sh) return "third_party";
  if (/(^|\.)?(instagram|facebook|x|twitter|tiktok)\.com$/.test(sh)) return "social";
  const vh = websiteUrl ? host(websiteUrl) : null;
  if (vh) {
    if (sh === vh) return "own";
    if (baseDomain(sh) === baseDomain(vh)) return "own_subdomain";
  }
  return "third_party";
}

export interface ScreenFindings {
  /** Human-readable findings; empty = nothing suspicious deterministically. */
  findings: string[];
  /** Venue-level policy hits that suggest the VENUE shouldn't be listed at all. */
  policyHits: string[];
}

export function screenVenue(input: AdjudicationInput): ScreenFindings {
  const findings: string[] = [];
  const policyHits: string[] = [];

  if (input.address && AIRPORT_RE.test(input.address)) {
    policyHits.push(`address looks like an airport location: "${input.address}"`);
  }
  if (RESORT_RE.test(input.venueName)) {
    policyHits.push(`venue name contains a resort/casino token: "${input.venueName}"`);
  }

  for (const w of input.windows) {
    if (w.sourceUrl) {
      const cls = classifySourceUrl(w.sourceUrl, input.websiteUrl);
      if (cls === "denylisted_aggregator") findings.push(`window sourced from denylisted aggregator: ${w.sourceUrl}`);
      else if (cls === "third_party") findings.push(`window sourced from a third-party domain: ${w.sourceUrl}`);
      else if (cls === "own_subdomain") findings.push(`window sourced from an own-site subdomain (check it's the right property): ${w.sourceUrl}`);
      else if (cls === "social") findings.push(`window sourced from social media: ${w.sourceUrl}`);
      if (EVENT_PATH_RE.test(w.sourceUrl)) findings.push(`window sourced from an event/group page: ${w.sourceUrl}`);
    }
    // Reuse the offering-sanity lexicons on STORED offerings (dupes, food-as-drink, day mismatch).
    const asExtracted: ExtractedOffering[] = w.offerings.map((o) => ({
      kind: o.kind,
      category: o.category,
      name: o.name,
      priceCents: o.priceCents,
      originalPriceCents: null,
      discountCents: null,
      description: o.description,
      conditions: null,
      sourceUrl: w.sourceUrl ?? "",
    }));
    findings.push(...sanitizeOfferings(asExtracted, w.daysOfWeek).warnings.map((x) => `stored offering: ${x}`));

    // Uniform suspiciously-cheap pricing (Wooden Nickel's hallucinated $2 everything).
    const priced = w.offerings.map((o) => o.priceCents).filter((c): c is number => c != null);
    if (priced.length >= 3 && new Set(priced).size === 1 && priced[0] <= 300) {
      findings.push(`all ${priced.length} priced offerings are identical and ≤$3 (${priced[0]}¢) — verify`);
    }
  }

  return { findings, policyHits };
}

// ── Stage C: the Haiku compare ────────────────────────────────────────────────

const PER_PAGE_CHARS = 3_000;
const TOTAL_CHARS = 12_000;

export type AdjudicationVerdict = "confirmed" | "corrected" | "no_mention" | "unclear";

export interface AdjudicationResult {
  verdict: AdjudicationVerdict;
  /** What the site actually states (days/times in the model's words), when readable. */
  siteSchedule: string | null;
  /** Verbatim quote from the excerpts driving the verdict. */
  evidence: string | null;
  reason: string;
  screens: ScreenFindings;
  recommendedAction: "keep" | "reextract" | "hide" | "operator_review" | "remove_venue";
  pagesJudged: string[];
  usage: Usage;
  costCents: number;
  model: string;
  promptHash: string;
}

const RECORD_ADJUDICATION: ToolUnion = {
  name: "record_adjudication",
  description: "Record the verdict comparing stored happy-hour data to the venue's own pages.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["confirmed", "corrected", "no_mention", "unclear"] },
      site_schedule: {
        type: "string",
        description: "The happy-hour schedule the pages actually state (days + 24h times), or empty.",
      },
      evidence: { type: "string", description: "Verbatim quote (≤200 chars) from the excerpts." },
      reason: { type: "string", description: "One or two sentences justifying the verdict." },
    },
    required: ["verdict", "reason"],
  },
};

const FORCE_ADJUDICATION: ToolChoiceTool = { type: "tool", name: "record_adjudication" };

function buildPagesSnippet(pages: FetchedPage[]): string | null {
  const parts: string[] = [];
  let total = 0;
  for (const p of pages) {
    if (typeof p.text !== "string" || p.text.trim().length === 0) continue;
    if (total >= TOTAL_CHARS) break;
    const room = Math.min(PER_PAGE_CHARS, TOTAL_CHARS - total);
    const body = p.text.trim().slice(0, room);
    parts.push(`Source: ${p.url}\n${body}`);
    total += body.length;
  }
  return parts.length ? parts.join("\n\n---\n\n") : null;
}

export interface AdjudicationRequest {
  params: MessageCreateParamsNonStreaming;
  promptHash: string;
  model: string;
}

export function buildAdjudicationRequest(input: AdjudicationInput): AdjudicationRequest | null {
  const snippet = buildPagesSnippet(input.pages);
  if (snippet === null) return null;
  const stored = input.windows.map((w) => ({
    daysOfWeek: w.daysOfWeek,
    startTime: w.startTime,
    endTime: w.endTime,
    allDay: w.allDay,
    notes: w.notes,
    offerings: w.offerings.map((o) => ({
      kind: o.kind,
      name: o.name,
      priceCents: o.priceCents,
      description: o.description,
    })),
  }));
  const loaded = loadPrompt("flag-adjudicate.md");
  const { system, user } = splitPrompt(loaded.content);
  const userText = user
    .replace("{{venue_name}}", input.venueName)
    .replace("{{stored_json}}", JSON.stringify(stored, null, 1))
    .replace("{{pages}}", snippet);
  return {
    params: {
      model: MODELS.relevance,
      max_tokens: 512,
      system,
      tools: [RECORD_ADJUDICATION],
      tool_choice: FORCE_ADJUDICATION,
      messages: [{ role: "user", content: userText }],
    },
    promptHash: loaded.hash,
    model: MODELS.relevance,
  };
}

/** Parse the forced tool call. Anything malformed → 'unclear' (routes to the operator —
 *  the adjudicator must never auto-clear or auto-condemn on a parse hiccup). */
export function parseAdjudication(message: Message): {
  verdict: AdjudicationVerdict;
  siteSchedule: string | null;
  evidence: string | null;
  reason: string;
} {
  const call = message.content.find(
    (b): b is ToolUseBlock => b.type === "tool_use" && b.name === "record_adjudication",
  );
  const fallback = { verdict: "unclear" as const, siteSchedule: null, evidence: null, reason: "no/invalid tool call" };
  if (!call) return fallback;
  const input = call.input as Record<string, unknown>;
  const v = input.verdict;
  if (v !== "confirmed" && v !== "corrected" && v !== "no_mention" && v !== "unclear") return fallback;
  return {
    verdict: v,
    siteSchedule: typeof input.site_schedule === "string" && input.site_schedule ? input.site_schedule : null,
    evidence: typeof input.evidence === "string" && input.evidence ? input.evidence : null,
    reason: typeof input.reason === "string" ? input.reason : "",
  };
}

/** Map verdict + screens to the action the operator would take (per the review corpus). */
export function recommendAction(
  verdict: AdjudicationVerdict,
  screens: ScreenFindings,
): AdjudicationResult["recommendedAction"] {
  if (screens.policyHits.length > 0) return "remove_venue"; // airport/resort — policy excluded
  switch (verdict) {
    case "confirmed":
      return "keep";
    case "corrected":
      return "reextract"; // hide bad window + targeted reextract from the right page
    case "no_mention":
      return "hide"; // own site is silent → unconfirmable (Wooden City, Quarterdeck pattern)
    case "unclear":
      return "operator_review";
  }
}

export type AnthropicLike = {
  messages: { create: (p: MessageCreateParamsNonStreaming) => Promise<Message> };
};

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

/**
 * Adjudicate one flagged venue. $0 when there is no readable page text (verdict
 * 'unclear' → operator). Model/parse errors also land on 'unclear' — this tool
 * routes doubt to a human, it never resolves doubt on its own.
 */
export async function adjudicateFlaggedVenue(
  input: AdjudicationInput,
  opts: { client?: AnthropicLike } = {},
): Promise<AdjudicationResult> {
  const screens = screenVenue(input);
  const pagesJudged = input.pages.filter((p) => typeof p.text === "string" && p.text.trim()).map((p) => p.url);
  const req = buildAdjudicationRequest(input);
  if (req === null) {
    return {
      verdict: "unclear",
      siteSchedule: null,
      evidence: null,
      reason: "no readable page text fetched from the venue's own site",
      screens,
      recommendedAction: recommendAction("unclear", screens),
      pagesJudged,
      usage: ZERO_USAGE,
      costCents: 0,
      model: MODELS.relevance,
      promptHash: "",
    };
  }
  const client = opts.client ?? (anthropic() as unknown as AnthropicLike);
  try {
    const message = await client.messages.create(req.params);
    const usage: Usage = {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
    };
    const parsed = parseAdjudication(message);
    return {
      ...parsed,
      screens,
      recommendedAction: recommendAction(parsed.verdict, screens),
      pagesJudged,
      usage,
      costCents: calcCostCents(req.model, usage),
      model: req.model,
      promptHash: req.promptHash,
    };
  } catch (e) {
    return {
      verdict: "unclear",
      siteSchedule: null,
      evidence: null,
      reason: `model call failed: ${(e as Error).message}`,
      screens,
      recommendedAction: recommendAction("unclear", screens),
      pagesJudged,
      usage: ZERO_USAGE,
      costCents: 0,
      model: req.model,
      promptHash: req.promptHash,
    };
  }
}
