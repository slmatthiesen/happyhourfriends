/**
 * windowReconcile — deterministic, pure-code cleanup of extractor over-capture.
 *
 * The AI extractor captures everything; this gate decides what is shown. It runs on
 * the full SET of a venue's windows (unlike per-window realnessGate) so it can merge
 * duplicates and detect overlaps. It NEVER deletes — it only unions days (merge) or
 * flips active=false (operating-hours / overlap-conflict).
 *
 * See docs/superpowers/specs/2026-06-07-hh-window-reconcile-gate-design.md.
 */
import type { OpenPeriod } from "@/lib/geo/timezone";

export interface ReconcileWindow {
  daysOfWeek: number[]; // ISO 1..7
  startTime: string | null; // "HH:MM" or "HH:MM:SS"; null = open-ended start
  endTime: string | null; // null = until close
  allDay: boolean;
  /** Fingerprint of the window's offerings (offeringsFingerprint). Windows with identical
   *  times but DIFFERENT offerings are distinct deals (Taco Tuesday vs Whiskey Wednesday)
   *  and must not merge. Omitted/null → "" (times-only merge, the pre-offerings behavior). */
  offeringsKey?: string | null;
  /** location_within_venue. Windows in DIFFERENT specific areas coexist (Bistro 44 runs
   *  3–7 in the bar and 3–6 in the dining room — not a conflict). Omitted/null/"all" is
   *  the wildcard: it spans every area, so it still conflicts with anything it overlaps. */
  location?: string | null;
}

/** Order-insensitive fingerprint of an offering set, for merge identity. */
export function offeringsFingerprint(
  offerings: { name: string | null; priceCents: number | null }[],
): string {
  return offerings
    .map((o) => `${(o.name ?? "").trim().toLowerCase()}|${o.priceCents ?? ""}`)
    .sort()
    .join(";");
}

export type ReconcileReason = "operating_hours" | "overlap_conflict" | "merged_duplicate";

export interface ReconcileResult {
  window: ReconcileWindow; // possibly merged (days unioned)
  active: boolean;
  reasons: ReconcileReason[];
}

// Thresholds (tunable). Validated against the Spokane ground-truth venues.
export const OPERATING_HOURS_COVERAGE = 0.8;
export const OPERATING_HOURS_MIN_HOURS = 8;
export const BUSINESS_DAY_START_MAX_MIN = 11 * 60; // 11:00
export const BUSINESS_DAY_MIN_HOURS = 6;
export const OPEN_TIME_TOLERANCE_MIN = 30;

const MIN_PER_DAY = 1440;

/** Parse "HH:MM" or "HH:MM:SS" → minutes from midnight. */
export function hhmmToMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/** Duration of a window in minutes, or null when either bound is missing.
 *  end < start means it crosses midnight (e.g. 11:00 → 00:00 = 13h). */
export function durationMin(win: ReconcileWindow): number | null {
  if (win.startTime == null || win.endTime == null) return null;
  const start = hhmmToMin(win.startTime);
  let end = hhmmToMin(win.endTime);
  if (end <= start) end += MIN_PER_DAY;
  return end - start;
}

function sortedUniqueDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/** Group identity for merging: times + allDay + offerings fingerprint. */
export function mergeKey(win: ReconcileWindow): string {
  return `${win.startTime ?? "-"}|${win.endTime ?? "-"}|${win.allDay}|${win.offeringsKey ?? ""}`;
}

/**
 * Collapse windows with identical (startTime, endTime, allDay, offeringsKey) into one
 * window whose days are the sorted-unique union. A collapsed group carries
 * `merged_duplicate`. Lossless: stays active; only the day arrays combine. Same-time
 * windows whose offerings differ are per-day distinct deals and stay separate rows.
 */
export function mergeDuplicates(windows: ReconcileWindow[]): ReconcileResult[] {
  const groups = new Map<string, { win: ReconcileWindow; count: number }>();
  for (const win of windows) {
    const key = mergeKey(win);
    const g = groups.get(key);
    if (g) {
      g.win = { ...g.win, daysOfWeek: sortedUniqueDays([...g.win.daysOfWeek, ...win.daysOfWeek]) };
      g.count += 1;
    } else {
      groups.set(key, { win: { ...win, daysOfWeek: sortedUniqueDays(win.daysOfWeek) }, count: 1 });
    }
  }
  return [...groups.values()].map((g) => ({
    window: g.win,
    active: true,
    reasons: g.count > 1 ? (["merged_duplicate"] as ReconcileReason[]) : [],
  }));
}

/** Open minute-of-day for ISO day `d`, or null. */
function openMinForDay(d: number, hoursJson: OpenPeriod[] | null | undefined): number | null {
  if (!hoursJson) return null;
  const p = hoursJson.find((x) => x.openDay === d);
  return p ? p.openMin : null;
}

/** Open [start,end) minute interval for ISO day `d` (end normalized past midnight), or null. */
function openIntervalForDay(d: number, hoursJson: OpenPeriod[] | null | undefined): [number, number] | null {
  if (!hoursJson) return null;
  const p = hoursJson.find((x) => x.openDay === d);
  if (!p || p.closeMin == null) return null;
  let close = p.closeMin;
  if (close <= p.openMin) close += MIN_PER_DAY; // crosses midnight
  return [p.openMin, close];
}

/**
 * True when a bounded, non-allDay window is the venue's operating hours, not a happy hour.
 * When hours_json covers any of the window's days it is AUTHORITATIVE: operating-hours iff
 * the window's clock range overlaps ≥80% of the open period on a strict majority of covered
 * days (overlap, not bare duration ratio — a 2h special at a club that's open a different
 * 2.5h of the day is NOT its operating hours). Only without usable hours_json do the
 * heuristics apply: ≥8h duration, or business-day span (start ≤11:00 and ≥6h). A start-only
 * window whose start ≈ open time is operating-hours ("open till close").
 */
export function isOperatingHours(win: ReconcileWindow, hoursJson: OpenPeriod[] | null | undefined): boolean {
  if (win.allDay) return false; // governed by the all-day policy
  if (win.startTime == null) return false; // need at least a start
  const start = hhmmToMin(win.startTime);

  // Start-only ("open till close") whose start matches the venue's open time.
  if (win.endTime == null) {
    let near = 0;
    let total = 0;
    for (const d of win.daysOfWeek) {
      const open = openMinForDay(d, hoursJson);
      if (open == null) continue;
      total += 1;
      if (Math.abs(start - open) <= OPEN_TIME_TOLERANCE_MIN) near += 1;
    }
    return total > 0 && near * 2 > total; // strict majority of covered days
  }

  const dur = durationMin(win);
  if (dur == null) return false;
  let end = hhmmToMin(win.endTime);
  if (end <= start) end += MIN_PER_DAY; // crosses midnight

  // hours_json overlap-coverage on a majority of covered days (authoritative when usable).
  let covered = 0;
  let matches = 0;
  for (const d of win.daysOfWeek) {
    const open = openIntervalForDay(d, hoursJson);
    if (!open || open[1] === open[0]) continue;
    covered += 1;
    const overlap = Math.max(0, Math.min(end, open[1]) - Math.max(start, open[0]));
    if (overlap / (open[1] - open[0]) >= OPERATING_HOURS_COVERAGE) matches += 1;
  }
  if (covered > 0) return matches * 2 > covered; // strict majority of covered days

  // No usable hours_json → duration heuristics.
  if (dur >= OPERATING_HOURS_MIN_HOURS * 60) return true;
  if (start <= BUSINESS_DAY_START_MAX_MIN && dur >= BUSINESS_DAY_MIN_HOURS * 60) return true;
  return false;
}

/** Effective [start,end] minute interval; end-null → until end of day (MIN_PER_DAY). */
function interval(win: ReconcileWindow): [number, number] | null {
  if (win.startTime == null) return null; // no start → cannot position
  const start = hhmmToMin(win.startTime);
  let end = win.endTime == null ? MIN_PER_DAY : hhmmToMin(win.endTime);
  if (win.endTime != null && end <= start) end += MIN_PER_DAY; // crosses midnight
  return [start, end];
}

function shareADay(a: ReconcileWindow, b: ReconcileWindow): boolean {
  const set = new Set(a.daysOfWeek);
  return b.daysOfWeek.some((d) => set.has(d));
}

/**
 * True when two windows share a day AND their clock ranges overlap but are NOT identical.
 * Identical-time windows are never conflicts: same offerings → merged in Task 2; different
 * offerings → deliberately coexisting per-day deals (base HH + a daily special).
 */
export function windowsOverlap(a: ReconcileWindow, b: ReconcileWindow): boolean {
  if (!shareADay(a, b)) return false;
  if (a.startTime === b.startTime && a.endTime === b.endTime && a.allDay === b.allDay)
    return false; // identical → merge, not conflict
  const ia = interval(a);
  const ib = interval(b);
  if (!ia || !ib) return false;
  return ia[0] < ib[1] && ib[0] < ia[1];
}

/**
 * Reconcile a venue's full window set. Order: (1) merge exact duplicates;
 * (2) hide operating-hours windows; (3) among still-active survivors, hide any that
 * overlap another survivor on a shared day with a different time. Pure — caller persists.
 *
 * Offerings discriminate in passes 2 and 3 (validated against Spokane + Tacoma ground
 * truth, 2026-06-09): an over-capture is offerings-BARE (Swinging Doors' 08–23) or a
 * COPY of a real window's deal set at bogus times (Lantern's 10–23 beside its real
 * 14–17; Bigfoot's five same-deal overlaps). A window carrying its own unique deal set
 * is a real deal even when its shape says operating-hours (Twisted Fork's open-to-close
 * daily specials) or it overlaps a different deal (Fondi's lunch menu vs Pizza Per Due).
 * Callers that pass no offeringsKey get the strict pre-discriminator behavior.
 */
export function reconcileWindows(
  windows: ReconcileWindow[],
  hoursJson?: OpenPeriod[] | null,
): ReconcileResult[] {
  const results = mergeDuplicates(windows);
  const key = (r: ReconcileResult) => r.window.offeringsKey ?? "";

  // Pass 2: operating-hours shape, hidden only when bare or a copy of a real window.
  const shapeFlagged = results.map((r) => isOperatingHours(r.window, hoursJson));
  for (let i = 0; i < results.length; i++) {
    if (!shapeFlagged[i]) continue;
    const k = key(results[i]);
    const copyOfReal =
      k !== "" && results.some((other, j) => j !== i && !shapeFlagged[j] && key(other) === k);
    if (k === "" || copyOfReal) {
      results[i].active = false;
      results[i].reasons.push("operating_hours");
    }
  }

  // Pass 3: overlap-conflict among survivors only. Same deal sets at overlapping times
  // contradict each other UNLESS one runs on a strict subset of the other's days — that
  // is a day-specific extension of the same deal ("Tuesday extended happy hour, 4–8" at
  // Mr. An's, site-verified), not a contradiction. A BARE window overlapping a
  // deal-carrying one hides alone: the deal side is better evidenced (SunSet's real
  // 16:00–17:30 must not be poisoned by a bare 16:00–17:00 fragment). Distinct
  // non-empty deal sets coexist.
  const survivors = results.filter((r) => r.active);
  const conflicted = new Set<ReconcileResult>();
  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      const a = survivors[i];
      const b = survivors[j];
      if (!windowsOverlap(a.window, b.window)) continue;
      if (locationsDistinct(a.window, b.window)) continue; // bar vs dining etc. coexist
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) {
        if (ka !== "" && isDayVariant(a.window, b.window)) continue; // extended-day special
        conflicted.add(a);
        conflicted.add(b);
      } else if (ka === "") {
        conflicted.add(a);
      } else if (kb === "") {
        conflicted.add(b);
      }
    }
  }
  for (const r of conflicted) {
    r.active = false;
    r.reasons.push("overlap_conflict");
  }

  return results;
}

/** Both windows name a specific, different area — they serve different rooms and coexist.
 *  "all" (or unset) spans every area and conflicts as before. */
function locationsDistinct(a: ReconcileWindow, b: ReconcileWindow): boolean {
  const la = a.location ?? "all";
  const lb = b.location ?? "all";
  return la !== "all" && lb !== "all" && la !== lb;
}

function isProperSubset(a: number[], b: number[]): boolean {
  if (a.length >= b.length) return false;
  const set = new Set(b);
  return a.every((d) => set.has(d));
}

/** One window runs on a strict subset of the other's days (a per-day variant of the
 *  same deal). Equal day-sets are NOT a variant — that is the 4–6-vs-4–7 conflict. */
function isDayVariant(a: ReconcileWindow, b: ReconcileWindow): boolean {
  return isProperSubset(a.daysOfWeek, b.daysOfWeek) || isProperSubset(b.daysOfWeek, a.daysOfWeek);
}
