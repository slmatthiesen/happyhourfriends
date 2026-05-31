/**
 * Verdict → recommended action for the one-time all-day reverify pass (Phase A).
 * Pure + deterministic so it's unit-testable without network/AI. See
 * docs/superpowers/specs/2026-05-31-all-day-happy-hour-scrutiny-design.md.
 */

export type Verdict =
  | { kind: "real_window"; startTime: string; endTime: string | null; daysOfWeek: number[]; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string }
  | { kind: "legit_all_day"; daysOfWeek: number[]; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string }
  | { kind: "not_happy_hour"; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string }
  | { kind: "unconfirmable"; quote: string; sourceUrl: string; servesAlcohol: boolean; reasoning: string };

/** correct = fix to a real window; keep = leave as legit all-day; stub = drop window, keep venue; delete_venue = recommend removing the venue. */
export type Action = "correct" | "keep" | "stub" | "delete_venue";

export function recommendAction(v: Verdict): Action {
  switch (v.kind) {
    case "real_window":
      return "correct";
    case "legit_all_day":
      // A genuine all-day deal is only credible on ≤2 specific days (industry-night).
      // An empty day list is degenerate (no confirmable content) → stub, don't keep.
      if (v.daysOfWeek.length === 0) return "stub";
      return v.daysOfWeek.length <= 2 ? "keep" : "stub";
    case "not_happy_hour":
      // Clear non-HH place (no alcohol / pure coupon) → recommend deletion; an otherwise
      // plausible drinks venue keeps its listing as a help-wanted stub.
      return v.servesAlcohol ? "stub" : "delete_venue";
    case "unconfirmable":
      // No quotable schedule on any source → can't keep the all-day claim; keep the venue
      // as a stub (it was a plausible-enough HH spot to have been listed).
      return "stub";
  }
}
