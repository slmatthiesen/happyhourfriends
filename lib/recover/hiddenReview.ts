/**
 * hiddenReview — pure logic for the $0 operator review of gate-hidden happy-hour
 * windows on stub venues (scripts/review-hidden-hh.ts).
 *
 * The realness/reconcile gates hide suspect windows (active=false) instead of deleting
 * them ([[capture-everything-realness-filter]]); on a stub venue those windows are the
 * venue's ONLY extracted data, invisible to users and to every admin surface.
 *
 * Suggestion policy (operator-set 2026-06-11): NEVER suggest `promote`. Going live
 * requires operator verification or a fresh re-extraction — a shape guess is not
 * evidence (the original shape rule promoted Mason Bar's "Dinner Served Daily
 * 5–10pm" because 5h-starting-after-11am looks like a happy hour). `delete` is
 * suggested only on hard evidence the window is service hours, not a deal:
 *
 *   - it matches the venue's Google operating hours (windowReconcile.isOperatingHours —
 *     the same authoritative test the reconcile gate uses), or
 *   - it was extracted from a meal-service menu page (lunch/dinner/brunch/breakfast in
 *     the source URL) and carries ZERO offerings — hours prose, no actual deals.
 *
 * Everything else stays `keep_hidden` (eligible for the paid re-extract sweep, which
 * can reactivate a window when a fresh read of the site confirms it).
 */

import { isOperatingHours } from "@/lib/places/windowReconcile";
import type { OpenPeriod } from "@/lib/geo/timezone";

export interface HiddenWindowShape {
  daysOfWeek: number[];
  startTime: string | null; // "HH:MM:SS"
  endTime: string | null;
  allDay: boolean;
  timeKnown: boolean;
  /** Page the window was extracted from (happy_hours.source_url). */
  sourceUrl: string | null;
  /** Count of active offerings attached to the window. */
  offerings: number;
}

export type HiddenAction = "promote" | "keep_hidden" | "delete";

/** Window length in hours; until-close (null end) and past-midnight ends handled. */
export function durationHours(startTime: string | null, endTime: string | null): number | null {
  if (!startTime || !endTime) return null;
  const toH = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h + m / 60;
  };
  const start = toH(startTime);
  let end = toH(endTime);
  if (end < start) end += 24; // crosses midnight
  return end - start;
}

const MEAL_MENU_RE = /lunch|dinner|brunch|breakfast/i;

/** The evidence behind a `delete` suggestion, or null when there is none.
 *  Surfaced verbatim in the report so the operator sees WHY before nuking. */
export function deleteEvidence(w: HiddenWindowShape, hoursJson: OpenPeriod[] | null): string | null {
  if (
    isOperatingHours(
      { daysOfWeek: w.daysOfWeek, startTime: w.startTime, endTime: w.endTime, allDay: w.allDay },
      hoursJson,
    )
  ) {
    return "matches venue operating hours";
  }
  if (w.offerings === 0 && w.sourceUrl != null && MEAL_MENU_RE.test(w.sourceUrl)) {
    return "meal-service menu page, no deals attached";
  }
  return null;
}

export function suggestAction(w: HiddenWindowShape, hoursJson: OpenPeriod[] | null): HiddenAction {
  return deleteEvidence(w, hoursJson) ? "delete" : "keep_hidden";
}
