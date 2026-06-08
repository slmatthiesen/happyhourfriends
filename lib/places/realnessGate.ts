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

/** Below this overall extractor confidence, a window is hidden for review. */
export const MIN_CONFIDENCE = 0.5;

/** The deterministic signals the gate checks. Stable string ids — surfaced in reports. */
export type RealnessReason = "all_day_many_days" | "no_time_window" | "low_confidence";

export interface RealnessInput {
  /** Window runs the full open hours of its days (no clock window). */
  allDay: boolean;
  /** How many ISO weekdays this window covers. */
  dayCount: number;
  /** Did we capture a usable time bound (a start, an end, or an explicit all-day claim)? */
  timeKnown: boolean;
  /** Extract-level overall confidence (0..1) that the schedule is current/accurate. */
  confidence: number;
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
 */
export function assessRealness(input: RealnessInput): RealnessVerdict {
  const reasons: RealnessReason[] = [];

  if (input.allDay && input.dayCount >= 3) reasons.push("all_day_many_days");
  if (!input.timeKnown) reasons.push("no_time_window");
  if (input.confidence < MIN_CONFIDENCE) reasons.push("low_confidence");

  return { suspect: reasons.length > 0, reasons };
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
