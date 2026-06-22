/**
 * offeringSanity — deterministic, $0 cleanup of model-extracted offerings before they
 * persist. Born from the 2026-06-10 operator flag review, where two venues showed the
 * same garbling patterns straight from the extractor:
 *
 *   - Bistro 44:  "Half Priced Burgers on Sunday" stored TWICE, kinded as `drink`
 *   - Backyard Public House: "$10 All Shareables" / "$12 Riverside Tacos" kinded as
 *     `drink`/`beer`, and day-specific specials merged into the every-day window
 *
 * Three conservative rules (mutate only when unambiguous, otherwise just warn):
 *   1. DEDUPE   — drop exact repeats of (name, priceCents, description) within a window.
 *   2. RE-KIND  — kind='drink' but the name/description is clearly food (food lexicon
 *                 hit, zero drink-lexicon hits) → kind='food', category 'appetizer'/'other'.
 *   3. DAY FLAG — an offering naming a specific weekday inside a multi-day window that
 *                 doesn't match gets a warning (NOT a mutation — splitting a window is a
 *                 judgment call the reconcile gate / operator owns).
 *
 * Pure, no I/O — golden cases in scripts/test-offering-sanity.ts.
 */
import type { ExtractedOffering } from "@/lib/ai/extractHappyHours";

const FOOD_TOKENS =
  /\b(burgers?|tacos?|wings?|pizzas?|nachos?|fries|sliders?|shareables?|appetizers?|apps?|flatbreads?|quesadillas?|sandwich(es)?|hot ?dogs?|pretzels?|mozzarella|calamari|dumplings?|egg ?rolls?|tots)\b/i;
const DRINK_TOKENS =
  /\b(beers?|drafts?|draughts?|wines?|cocktails?|margaritas?|sangrias?|mimosas?|wells?|pours?|drinks?|ipa|lagers?|pints?|shots?|spirits?|whiskeys?|whisky|tequilas?|vodkas?|rum|gin|seltzers?|ciders?|brews?|bottles?|cans?|mules?|martinis?|spritz(es)?)\b/i;
const APPETIZER_TOKENS = /\b(appetizers?|apps?|shareables?|starters?|small plates?)\b/i;

const DAY_TOKENS: Array<{ iso: number; re: RegExp }> = [
  { iso: 1, re: /\bmondays?\b/i },
  { iso: 2, re: /\btuesdays?\b/i },
  { iso: 3, re: /\bwednesdays?\b/i },
  { iso: 4, re: /\bthursdays?\b/i },
  { iso: 5, re: /\bfridays?\b/i },
  { iso: 6, re: /\bsaturdays?\b/i },
  { iso: 7, re: /\bsundays?\b/i },
];

/** Dedupe identity for an offering name: case/whitespace-insensitive, with a leading
 *  price token stripped — "$5 Wells" and "Wells" (both 500¢) are the same deal, and
 *  "All shareables" vs "All Shareables" differ only by case (Backyard, 2026-06-10). */
export function offeringNameKey(name: string | null): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\$\s*\d+(\.\d+)?\s+(off\s+)?/, "")
    .replace(/\s+/g, " ");
}

/** Strip a redundant leading absolute-price token from a stored name — "$19 Kamala Llama
 *  hummus" (price_cents=1900) becomes "Kamala Llama hummus" so the price isn't printed
 *  twice. Only fires when price_cents is already set (the prefix is redundant, not the
 *  sole price) and never consumes a "$N off …" discount phrase (that price IS the name). */
export function stripRedundantPricePrefix(name: string | null, priceCents: number | null): string | null {
  if (!name || priceCents == null) return name;
  const stripped = name.replace(/^\$\s*\d+(\.\d+)?\s+(?!off\b)/i, "");
  return stripped.length ? stripped : name;
}

/** A bare happy-hour section heading mis-captured as an offering ("HAPPY HOUR AT GLK",
 *  "Happy Hour Menu") — never a real deal. Tight by design: a deal that merely mentions
 *  happy hour and names an item ("Happy Hour Lager") does NOT match. */
export function isHappyHourHeading(name: string | null): boolean {
  if (!name) return false;
  const n = name.trim();
  return (
    /^happy\s+hour\s+at\b/i.test(n) ||
    /^happy\s+hour(\s+(menu|specials?|deals?|hours?|time|food|drinks?))?\s*$/i.test(n)
  );
}

/** Per-row verdict for a backfill over ALREADY-STORED offerings (sanitizeOfferings only
 *  runs on fresh extractions). `drop` = soft-delete a heading mis-captured as an offering;
 *  `rename` = strip the redundant price prefix in place; `keep` = leave it untouched.
 *  Pure and idempotent — re-running over a cleaned row yields `keep`. */
export function classifyStoredOffering(o: {
  name: string | null;
  priceCents: number | null;
}): { action: "drop" } | { action: "rename"; newName: string } | { action: "keep" } {
  const cleaned = stripRedundantPricePrefix(o.name, o.priceCents);
  if (isHappyHourHeading(cleaned)) return { action: "drop" };
  if (cleaned != null && cleaned !== o.name) return { action: "rename", newName: cleaned };
  return { action: "keep" };
}

/** Shared lexicon predicates — also consumed by the audit anomaly rules so persist-time
 *  cleanup and stored-data auditing agree on what "looks like food" / "names a day" means. */
export function isFoodTextMislabeledAsDrink(text: string): boolean {
  return FOOD_TOKENS.test(text) && !DRINK_TOKENS.test(text);
}

/** ISO day numbers (1=Mon…7=Sun) explicitly named in the text. */
export function namedDaysIn(text: string): number[] {
  return DAY_TOKENS.filter((d) => d.re.test(text)).map((d) => d.iso);
}

export interface SanitizeResult {
  offerings: ExtractedOffering[];
  /** Human-readable notes about what was changed or looks off — for audit/report output. */
  warnings: string[];
}

/** Text an offering is judged by: name + description (conditions stay out — they
 *  legitimately mention days, e.g. "bar only on Fridays"). */
function offeringText(o: ExtractedOffering): string {
  return [o.name, o.description].filter(Boolean).join(" ");
}

// Drink-price plausibility bounds (diagnosis bucket #3). WARN-only — never hide: real
// dive $2 deals and real upscale $15 cocktails both exist, so price alone is a flag for
// review, not a verdict (the operator owns the over-hide call).
const DRINK_PRICE_FLOOR_CENTS = 200; // ≤ $2 a drink → almost always a scrape/parse error
const CASUAL_DRINK_CEILING_CENTS = 1400; // ≥ $14 …
const CASUAL_MAX_PRICE_LEVEL = 2; // … at a casual venue (Google price tier 1–2) → likely a full-price scrape

export interface SanitizeOptions {
  /** Google price tier 1–4 of the venue; enables the tier-aware high-price warning. */
  priceLevel?: number | null;
}

export function sanitizeOfferings(
  offerings: ExtractedOffering[],
  windowDays: number[],
  opts: SanitizeOptions = {},
): SanitizeResult {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const out: ExtractedOffering[] = [];

  for (const raw of offerings) {
    // 0. Normalize the stored name (strip a redundant "$N " price prefix) before anything
    //    downstream reads it, then drop a happy-hour heading mis-captured as an offering.
    const cleanName = stripRedundantPricePrefix(raw.name, raw.priceCents);
    if (isHappyHourHeading(cleanName)) {
      warnings.push(`dropped section-heading pseudo-offering: ${cleanName}`);
      continue;
    }
    const o = cleanName === raw.name ? raw : { ...raw, name: cleanName };

    // 1. Dedupe repeats within this window's batch (name key is case/price-prefix
    //    insensitive so "$5 Wells" and "Wells" at 500¢ collapse).
    const key = `${offeringNameKey(o.name)}|${o.priceCents ?? ""}|${(o.description ?? "").trim().toLowerCase()}`;
    if (seen.has(key)) {
      warnings.push(`dropped duplicate offering: ${o.name ?? o.description ?? "(unnamed)"}`);
      continue;
    }
    seen.add(key);

    let next = o;

    // 2. Re-kind obvious food mislabeled as drink.
    const text = offeringText(o);
    if (o.kind === "drink" && isFoodTextMislabeledAsDrink(text)) {
      next = {
        ...o,
        kind: "food",
        category: APPETIZER_TOKENS.test(text) ? "appetizer" : "other",
      };
      warnings.push(`re-kinded drink→food: ${o.name ?? o.description ?? "(unnamed)"}`);
    }

    // 3. Day-specific item whose named day(s) don't equal the window's days — warn only.
    const namedDays = namedDaysIn(text);
    if (namedDays.length > 0) {
      const windowMatchesNamed =
        windowDays.length === namedDays.length && namedDays.every((d) => windowDays.includes(d));
      if (!windowMatchesNamed) {
        warnings.push(
          `day-specific offering vs window days {${windowDays.join(",")}} (verify): ${o.name ?? o.description ?? "(unnamed)"}`,
        );
      }
    }

    // 4. Implausible drink price (warn only) — judged on the FINAL kind so re-kinded food
    //    (e.g. "$14 Wing Central") is never treated as a pricey drink.
    if (next.kind === "drink" && typeof next.priceCents === "number" && next.priceCents > 0) {
      const label = next.name ?? next.description ?? "(unnamed)";
      const dollars = `$${(next.priceCents / 100).toFixed(2)}`;
      if (next.priceCents <= DRINK_PRICE_FLOOR_CENTS) {
        warnings.push(`implausibly cheap drink price (${dollars}) — verify: ${label}`);
      } else if (
        next.priceCents >= CASUAL_DRINK_CEILING_CENTS &&
        typeof opts.priceLevel === "number" &&
        opts.priceLevel <= CASUAL_MAX_PRICE_LEVEL
      ) {
        warnings.push(`drink price ${dollars} high for happy hour at this venue tier — verify: ${label}`);
      }
    }

    out.push(next);
  }

  return { offerings: out, warnings };
}
