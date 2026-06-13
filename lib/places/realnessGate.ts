/**
 * realnessGate — the cheap, pure-code filter that decides whether a captured
 * happy-hour window looks REAL enough to show publicly, or should be stored but
 * HIDDEN (active=false) for operator review.
 *
 * Design principle (operator directive 2026-05-31): the expensive AI extractor
 * CAPTURES everything it can read and never judges realness. This gate makes the
 * realness call in deterministic code — no AI, no network — so it is fast, free,
 * unit-testable, and re-runnable over already-stored rows after a rule tweak.
 * It NEVER deletes data; it only flips visibility.
 *
 * See docs/superpowers/specs/2026-05-31-capture-everything-realness-filter-design.md.
 */

import { HH_RE } from "@/lib/places/hhText";

/** Below this overall extractor confidence, a window is hidden for review. */
export const MIN_CONFIDENCE = 0.5;

/** The deterministic signals the gate checks. Stable string ids — surfaced in reports. */
export type RealnessReason =
  | "all_day_many_days"
  | "no_time_window"
  | "low_confidence"
  | "meal_special"
  | "no_offerings_no_hh_text";

export interface RealnessInput {
  /** Window runs the full open hours of its days (no clock window). */
  allDay: boolean;
  /** How many ISO weekdays this window covers. */
  dayCount: number;
  /** Did we capture a usable time bound (a start, an end, or an explicit all-day claim)? */
  timeKnown: boolean;
  /** Extract-level overall confidence (0..1) that the schedule is current/accurate. */
  confidence: number;
  /** Offerings + window context for the meal-special rule; omit to skip that rule
   *  (older callers keep their exact previous behavior). */
  mealSpecial?: MealSpecialInput;
}

export interface RealnessVerdict {
  /** True → store the row HIDDEN (active=false) pending review; false → show it. */
  suspect: boolean;
  /** Which signals fired (empty when not suspect). */
  reasons: RealnessReason[];
}

/**
 * Classify one window. Suspect if ANY signal fires:
 *  - all-day on 3+ days     → almost always regular pricing, not a happy hour
 *  - no usable time at all   → can never be shown as "happening now"
 *  - low overall confidence  → the extractor wasn't sure the schedule is real/current
 *  - no offerings + no HH text → operating hours / lunch menu, not a deal (bucket #2)
 */
export function assessRealness(input: RealnessInput): RealnessVerdict {
  const reasons: RealnessReason[] = [];

  if (input.allDay && input.dayCount >= 3) reasons.push("all_day_many_days");
  if (!input.timeKnown) reasons.push("no_time_window");
  if (input.confidence < MIN_CONFIDENCE) reasons.push("low_confidence");
  if (input.mealSpecial && mealSpecialEvidence(input.mealSpecial)) reasons.push("meal_special");
  if (input.mealSpecial && bareWindowNoHhEvidence(input.mealSpecial)) reasons.push("no_offerings_no_hh_text");

  return { suspect: reasons.length > 0, reasons };
}

// ── meal_special — meal services / events stored as happy hours ─────────────────
//
// Born from the 2026-06-12 all-city price scan: ~20 LIVE windows were lunch menus,
// dinner specials, prix fixes, and paint-and-sip events the extractor had captured
// as happy hours. Three deterministic signals, each with near-zero hits on the real
// (upscale) happy hours in the same scan. Like every gate signal this only HIDES
// (active=false) for operator review — it never deletes.

/** Meal-service / event language in an offering name or window notes. */
export const MEAL_SPECIAL_RE =
  /\b(?:prix[- ]?fixe|early[- ]?bird|lunch(?:eon)?|brunch|breakfast|dinner|supper|bottomless|paint\s*(?:and|&|'?n'?)\s*sip|\d+[- ]course)\b/i;

/** Above this average offering price a meal-shaped time window becomes suspect
 *  (operator's $12 line, 2026-06-12). Price alone NEVER fires — upscale HH is real. */
export const MEAL_AVG_PRICE_CENTS = 1200;

/** 1–2 priced items all at/above this → combo/entrée pricing, not a deal list. */
export const MEAL_EXPENSIVE_ITEM_CENTS = 3000;

export interface MealSpecialInput {
  /** 24-hour "HH:MM[:SS]" or null. */
  startTime: string | null;
  endTime: string | null;
  /** Extractor notes on the window. */
  notes?: string | null;
  /** Page the window was extracted from. */
  sourceUrl?: string | null;
  offerings: Array<{
    name: string | null;
    description?: string | null;
    priceCents: number | null;
  }>;
}

function toMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Why this window looks like meal service rather than a happy hour, or null when it
 * doesn't. The string is operator-facing — surfaced verbatim in review reports so a
 * hide is never unexplained. Signals (ANY fires):
 *
 *   1. meal-service language — prix fixe / lunch / brunch / dinner / early-bird /
 *      bottomless / paint-and-sip / N-course in an offering name or the notes
 *   2. meal-shaped clock window (lunch ≤12:00→≤16:00, or dinner ≥17:00→≥21:00)
 *      AND average offering price above $12 — either alone is common in real HH
 *   3. only 1–2 priced items, ALL ≥ $30 — combo/entrée pricing, not a deal list
 *
 * Veto: explicit happy-hour text anywhere (offering names, notes, source URL) clears
 * all signals — a venue calling it a happy hour is evidence we keep (the D.Monaghans
 * precedent from the hidden-window review).
 */
export function mealSpecialEvidence(input: MealSpecialInput): string | null {
  const offeringText = input.offerings
    .map((o) => `${o.name ?? ""} ${o.description ?? ""}`)
    .join(" | ");
  const windowText = `${offeringText} ${input.notes ?? ""}`;
  if (HH_RE.test(windowText) || HH_RE.test(input.sourceUrl ?? "")) return null;

  const evidence: string[] = [];

  const token = MEAL_SPECIAL_RE.exec(windowText);
  if (token) evidence.push(`meal-service language ("${token[0]}")`);

  const priced = input.offerings
    .map((o) => o.priceCents)
    .filter((p): p is number => p != null && p > 0);
  const avg = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;
  const start = toMinutes(input.startTime);
  const end = toMinutes(input.endTime);

  // end > start excludes crosses-midnight windows — late-night HH is real.
  if (avg != null && avg > MEAL_AVG_PRICE_CENTS && start != null && end != null && end > start) {
    const fmtAvg = `avg $${(avg / 100).toFixed(2)}`;
    if (start <= 12 * 60 && end <= 16 * 60) {
      evidence.push(`lunch-hours window with ${fmtAvg}`);
    } else if (start >= 17 * 60 && end >= 21 * 60) {
      evidence.push(`dinner-service window with ${fmtAvg}`);
    }
  }

  if (
    priced.length >= 1 &&
    priced.length <= 2 &&
    Math.min(...priced) >= MEAL_EXPENSIVE_ITEM_CENTS
  ) {
    evidence.push(
      `only ${priced.length} priced item${priced.length === 1 ? "" : "s"}, all ≥ $${MEAL_EXPENSIVE_ITEM_CENTS / 100} (combo/entrée pricing)`,
    );
  }

  return evidence.length ? evidence.join("; ") : null;
}

// ── bare-window gate (diagnosis 2026-06-13, bucket #2) ──────────────────────────
//
// A recurring time window with ZERO offerings AND no happy-hour wording on its
// source is operating hours or a lunch/menu page captured as a deal, not a happy
// hour (The Quarterdeck's M–F 3–5pm with nothing on it; Sliver's window lifted from
// a /lunch-deals page). We deliberately KEEP bare windows that DO say "happy hour"
// (a real window often lists no itemized prices — North Italia's "Mon–Fri 3–6pm"),
// so the HH_RE veto over notes + source URL is the discriminator. Like every gate
// signal this only HIDES (active=false) for review — it never deletes.

/** True when a window has no offerings AND nothing on it reads as a happy hour. */
export function bareWindowNoHhEvidence(input: MealSpecialInput): boolean {
  if (input.offerings.length > 0) return false; // has deals → not a bare phantom
  const text = `${input.notes ?? ""} ${input.sourceUrl ?? ""}`;
  return !HH_RE.test(text);
}

/**
 * The shared "should this window be shown publicly?" decision, consolidating the two
 * suspicion signals so every persist path agrees:
 *   - `realnessSuspect` — the realness gate flagged it (assessRealness().suspect), and
 *   - `freeSuspect`     — the free deterministic parser flagged it implausible
 *                         (ExtractedHappyHour.suspect; absent for paid-extractor windows).
 * A window goes live ONLY if BOTH are clear. Callers with extra gates (e.g. the
 * reconcile gate) AND their result on top.
 */
export function windowShouldBeActive(input: {
  realnessSuspect: boolean;
  freeSuspect?: boolean;
}): boolean {
  return !input.realnessSuspect && !input.freeSuspect;
}
