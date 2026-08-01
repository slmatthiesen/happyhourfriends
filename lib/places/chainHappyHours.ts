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

/** Shared by both Pacific Catch windows — the weekday and weekend Aloha Hours run the same
 *  menu, only the end time differs. Verbatim from pacificcatch.com/menu/#aloha-hour. */
const PACIFIC_CATCH_ALOHA_OFFERINGS: ChainOffering[] = [
  { kind: "food", category: "appetizer", name: "Chips & Salsa" },
  { kind: "food", category: "appetizer", name: "Choice of Fries", description: "Regular, chile-lime, sweet potato" },
  { kind: "food", category: "appetizer", name: "Thai Brussels" },
  { kind: "food", category: "appetizer", name: "Coconut Shrimp", description: "Five-spice crispy shrimp, Thai sweet chili sauce" },
  { kind: "food", category: "appetizer", name: "Sticky Ribs", description: "Pan-glazed Korean-style pork ribs, sesame seeds, scallion" },
  { kind: "food", category: "appetizer", name: "Guaca-Poke", description: "Original ahi poke, guacamole, tortilla chips" },
  { kind: "drink", category: "cocktail", name: "Shark Fin", description: "Pearl vodka, honey-guava syrup, lemon, prosecco" },
  { kind: "drink", category: "cocktail", name: "Mai Tai", description: "Flor de Caña silver rum, Lahaina dark rum, lime juice, overproof rum, house-made POG" },
  { kind: "drink", category: "cocktail", name: "Agave Margarita", description: "Lunazul reposado tequila, lime juice, agave nectar, half salt rim" },
  { kind: "drink", category: "cocktail", name: "Guava-Rita", description: "Cazadores blanco tequila, guava purée, lime juice, agave nectar, half salt rim" },
  { kind: "drink", category: "cocktail", name: "Spicy Pacific", description: "Pearl vodka, passion fruit, serrano chile, lemon juice" },
  { kind: "drink", category: "cocktail", name: "Well Cocktails" },
];

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
  // Operator-confirmed 2026-07-31: "ALOHA HOUR: MON - FRI: 3:00 PM - 6:00 PM / SAT - SUN:
  // 3:00 PM - 5:00 PM", identical on the sf-9th-avenue, sf-chestnut-st and mountain-view
  // location pages. Two entries because the weekend window has a different end time.
  //
  // Why this chain earned a floor: Google reported serves_alcohol=false at 8 of the 9 Bay Area
  // listings, so the alcohol gate dropped them all pre-enrich and only Mountain View was ever
  // built. The gate now takes a confirmed sibling HH as an override, but this floor is the
  // belt-and-braces — it also covers locations opened after the last discovery sweep.
  // Offerings are the /menu/#aloha-hour Share Plates + the $9 cocktails, which every location
  // shares; individual prices are omitted because the menu publishes none (PRD §13: null, not a guess).
  {
    chain: "pacific catch",
    label: "Pacific Catch (Aloha Hour, weekdays)",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "15:00",
    endTime: "18:00",
    offerings: PACIFIC_CATCH_ALOHA_OFFERINGS,
    sourceUrl: "https://www.pacificcatch.com/menu/#aloha-hour",
    notes: "Aloha Hour (chain-wide).",
  },
  {
    chain: "pacific catch",
    label: "Pacific Catch (Aloha Hour, weekends)",
    daysOfWeek: [6, 7],
    startTime: "15:00",
    endTime: "17:00",
    offerings: PACIFIC_CATCH_ALOHA_OFFERINGS,
    sourceUrl: "https://www.pacificcatch.com/menu/#aloha-hour",
    notes: "Aloha Hour (chain-wide).",
  },
];

/** Every curated window for a venue name — a chain may publish more than one (Pacific Catch
 *  runs a weekday and a separate weekend Aloha Hour). Empty when no chain matches. */
export function chainHappyHoursFor(name: string): ChainHappyHour[] {
  const n = normalize(name);
  return CHAIN_HAPPY_HOURS.filter(
    (c) => n === c.chain || n.startsWith(c.chain + " ") || n.includes(" " + c.chain + " "),
  );
}

/** The FIRST curated window for a venue name, or null when no chain matches. Use
 *  chainHappyHoursFor when you need every window a chain publishes. */
export function chainHappyHourFor(name: string): ChainHappyHour | null {
  return chainHappyHoursFor(name)[0] ?? null;
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
    discountPercent: null,
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
