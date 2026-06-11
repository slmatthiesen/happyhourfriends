/**
 * hiddenReview — pure logic for the $0 operator review of gate-hidden happy-hour
 * windows on stub venues (scripts/review-hidden-hh.ts).
 *
 * The realness/reconcile gates hide suspect windows (active=false) instead of deleting
 * them ([[capture-everything-realness-filter]]); on a stub venue those windows are the
 * venue's ONLY extracted data, invisible to users and to every admin surface. This
 * module suggests a per-window action for the operator to confirm or override:
 *
 *   promote      window is HH-shaped (timed, 1–5h, starts 11:00+, not all-day) —
 *                likely a real happy hour the gate over-hid
 *   keep_hidden  all-day / open-to-close spans, unknown times — the gate was right
 *
 * Suggestions are deliberately conservative: nothing is promoted without the operator
 * flipping (or keeping) the action in the report JSON.
 */

export interface HiddenWindowShape {
  startTime: string | null; // "HH:MM:SS"
  endTime: string | null;
  allDay: boolean;
  timeKnown: boolean;
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

/** True when the window looks like a deliberate happy hour rather than operating hours:
 *  a stated 1–5h span starting 11:00 or later. Open-to-close spans, unknown times and
 *  all-day windows stay hidden (those are exactly what the gate exists to catch). */
export function isHhShaped(w: HiddenWindowShape): boolean {
  if (w.allDay || !w.timeKnown) return false;
  const dur = durationHours(w.startTime, w.endTime);
  if (dur === null) return false;
  const startHour = Number(w.startTime!.split(":")[0]);
  return dur >= 1 && dur <= 5 && startHour >= 11;
}

export function suggestAction(w: HiddenWindowShape): HiddenAction {
  return isHhShaped(w) ? "promote" : "keep_hidden";
}
