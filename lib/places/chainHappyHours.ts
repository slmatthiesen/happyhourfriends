/**
 * Curated chain happy hours — a FLOOR applied to every location of a chain.
 *
 * The extractor captures most chain HHs from each venue's own site, but some locations land
 * bare (window captured, 0 offerings) or miss the HH page entirely. When the operator has
 * CONFIRMED a chain runs a standardized, published happy hour, an entry here guarantees every
 * current and future location gets it — filled in only where extraction fell short, so a
 * location that already pulled richer site data keeps its own (see
 * lib/recover/applyChainHappyHour → the gap-fill guard).
 *
 * RULES (PRD §13): add an entry ONLY for an operator-verified, chain-wide HH with a real
 * published `sourceUrl`. Never a guess. The synthetic ExtractResult flows through the ONE
 * canonical persist path, so the realness + reconcile + provenance gates still apply.
 */
import type {
  ExtractResult,
  ExtractedHappyHour,
  ExtractedOffering,
} from "@/lib/ai/extractHappyHours";
import { normalize } from "@/lib/places/chainDenylist";

export interface ChainOffering {
  kind: "food" | "drink" | "other";
  /** offering_category enum: beer|wine|cocktail|spirit|appetizer|entree|dessert|other */
  category: string;
  name: string;
  description?: string | null;
}

export interface ChainHappyHour {
  /** Normalized chain key — matched whole-word/prefix like HH_CHAINS (e.g. "super duper"). */
  chain: string;
  /** Human label for logs/audit. */
  label: string;
  /** ISO days: 1=Mon … 7=Sun. */
  daysOfWeek: number[];
  /** 24h "HH:MM"; null only for an all-day deal. */
  startTime: string | null;
  endTime: string | null;
  offerings: ChainOffering[];
  /** The chain's own published HH source — required (§13: every applied change needs one). */
  sourceUrl: string;
  notes: string;
}

export const CHAIN_HAPPY_HOURS: ChainHappyHour[] = [
  {
    // Operator-confirmed 2026-06-18: "Happy Hour drinks and fries at any Super Duper
    // location, Mon–Fri, 4–6pm." Berkeley extracted the window bare (0 offerings); Daly
    // City extracted it with 8 — the floor fills the former, leaves the latter.
    chain: "super duper",
    label: "Super Duper Burgers",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "16:00",
    endTime: "18:00",
    offerings: [
      { kind: "drink", category: "other", name: "Happy Hour drinks" },
      { kind: "food", category: "appetizer", name: "Fries" },
    ],
    sourceUrl: "https://www.superduperburgers.com/#seasonal-specials",
    notes: "Happy Hour drinks and fries (chain-wide).",
  },
];

/** The curated HH for a venue name, or null when no chain matches. */
export function chainHappyHourFor(name: string): ChainHappyHour | null {
  const n = normalize(name);
  return (
    CHAIN_HAPPY_HOURS.find(
      (c) => n === c.chain || n.startsWith(c.chain + " ") || n.includes(" " + c.chain + " "),
    ) ?? null
  );
}

/** Marker recorded as model/prompt_hash in ai_usage_ledger — a curated, $0, non-AI source. */
export const CHAIN_HH_MODEL = "chain-hh-registry-v1";

/**
 * Wrap a registry entry as a synthetic ExtractResult so it flows through the ONE persist path
 * (persistExtractedWindows) — same realness/reconcile/provenance gates, offering dedup, audit
 * — instead of a forked write. Confidence 1 (operator-verified); $0 usage (no model call).
 */
export function buildChainExtractResult(c: ChainHappyHour): ExtractResult {
  const offerings: ExtractedOffering[] = c.offerings.map((o) => ({
    kind: o.kind,
    category: o.category,
    name: o.name,
    priceCents: null,
    originalPriceCents: null,
    discountCents: null,
    description: o.description ?? null,
    conditions: null,
    sourceUrl: c.sourceUrl,
  }));
  const hh: ExtractedHappyHour = {
    daysOfWeek: c.daysOfWeek,
    allDay: c.startTime === null && c.endTime === null,
    startTime: c.startTime,
    endTime: c.endTime,
    timeKnown: c.startTime !== null || c.endTime !== null,
    locationWithinVenue: "all",
    notes: c.notes,
    sourceUrl: c.sourceUrl,
    offerings,
  };
  return {
    happyHours: [hh],
    confidence: 1,
    summary: `Curated chain happy hour: ${c.label}`,
    venueType: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    costCents: 0,
    promptHash: CHAIN_HH_MODEL,
    model: CHAIN_HH_MODEL,
  };
}
