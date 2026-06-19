/**
 * supersedeBareWindows — decide which of a venue's BARE happy-hour windows are made
 * redundant by its richer windows, so a re-extraction ADDS deals without leaving stale
 * duplicates behind. Pure and deterministic; the DB layer (resolveVenue) soft-deletes the
 * returned ids.
 *
 * The invariant (operator directive): add good data, never remove good data, never add
 * bad data. So this NEVER returns a window that carries offerings, and it only retires a
 * bare window when the information it asserts is fully preserved elsewhere:
 *
 *   Rule 1 — deal supersede: a bare window is retired only when EVERY (day, time) it
 *            asserts is contained by a deal-carrying window (same/overlapping area). Partial
 *            coverage keeps the bare window — its uncovered days/times are still real info.
 *   Rule 2 — redundant specific copy: a bare window pinned to a specific area ('bar') that
 *            duplicates a same-time bare 'all' window is retired in favour of the broader
 *            'all' (which never under-claims location). Two DISTINCT specific areas coexist.
 *
 * Generalises the old same-time/different-location helper (Santo Mezcal) to the cross-day
 * coverage case (LOCAL's all-week bare window vs its day-split deal menus).
 */
import { hhmmToMin } from "@/lib/places/windowReconcile";

export interface SupersedeWindow {
  id: string;
  daysOfWeek: number[]; // ISO 1..7
  startTime: string | null; // "HH:MM[:SS]" or null
  endTime: string | null; // null = until close
  allDay: boolean;
  location: string | null; // 'all' (or null) = whole venue; else a specific area
  offeringCount: number; // active, non-deleted offerings on the window
}

const MIN_PER_DAY = 1440;

/** Effective [start,end] minute interval, or null when the window can't be positioned
 *  (no start and not all-day). all-day spans the whole day; null end = until end of day. */
function interval(w: SupersedeWindow): [number, number] | null {
  if (w.allDay) return [0, MIN_PER_DAY];
  if (w.startTime == null) return null;
  const start = hhmmToMin(w.startTime);
  let end = w.endTime == null ? MIN_PER_DAY : hhmmToMin(w.endTime);
  if (w.endTime != null && end <= start) end += MIN_PER_DAY; // crosses midnight
  return [start, end];
}

/** S's clock interval fully contains W's. */
function contains(s: [number, number] | null, ww: [number, number] | null): boolean {
  if (!s || !ww) return false;
  return s[0] <= ww[0] && s[1] >= ww[1];
}

const loc = (w: SupersedeWindow): string => w.location ?? "all";

/** Both windows name a specific, DIFFERENT area → they serve different rooms and never
 *  supersede each other. 'all' (the catch-all) is compatible with anything. */
function locationsDistinct(a: SupersedeWindow, b: SupersedeWindow): boolean {
  return loc(a) !== "all" && loc(b) !== "all" && loc(a) !== loc(b);
}

function sameDays(a: SupersedeWindow, b: SupersedeWindow): boolean {
  if (a.daysOfWeek.length !== b.daysOfWeek.length) return false;
  const set = new Set(a.daysOfWeek);
  return b.daysOfWeek.every((d) => set.has(d));
}

/** Window ids that should be soft-deleted (retired). Only ever bare windows. */
export function planBareSupersedes(windows: SupersedeWindow[]): Set<string> {
  const retire = new Set<string>();

  // Rule 1 — full-coverage deal supersede.
  for (const ww of windows) {
    if (ww.offeringCount > 0) continue; // never retire a deal-carrying window
    const wiv = interval(ww);
    if (!wiv) continue; // unpositionable bare window — leave for review
    const fullyCovered = ww.daysOfWeek.every((d) =>
      windows.some(
        (s) =>
          s.id !== ww.id &&
          s.offeringCount > 0 &&
          s.daysOfWeek.includes(d) &&
          !locationsDistinct(s, ww) &&
          contains(interval(s), wiv),
      ),
    );
    if (fullyCovered) retire.add(ww.id);
  }

  // Rule 2 — a bare specific-area copy of a same-time bare 'all' window.
  for (const ww of windows) {
    if (retire.has(ww.id) || ww.offeringCount > 0) continue;
    if (loc(ww) === "all") continue; // keep the broad one
    const hasBareAllTwin = windows.some(
      (s) =>
        s.id !== ww.id &&
        !retire.has(s.id) &&
        s.offeringCount === 0 &&
        loc(s) === "all" &&
        sameDays(s, ww) &&
        s.startTime === ww.startTime &&
        s.endTime === ww.endTime &&
        s.allDay === ww.allDay,
    );
    if (hasBareAllTwin) retire.add(ww.id);
  }

  return retire;
}
