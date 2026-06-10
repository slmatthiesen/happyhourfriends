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

export function sanitizeOfferings(
  offerings: ExtractedOffering[],
  windowDays: number[],
): SanitizeResult {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const out: ExtractedOffering[] = [];

  for (const o of offerings) {
    // 1. Dedupe exact repeats within this window's batch.
    const key = `${(o.name ?? "").trim().toLowerCase()}|${o.priceCents ?? ""}|${(o.description ?? "").trim().toLowerCase()}`;
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

    out.push(next);
  }

  return { offerings: out, warnings };
}
