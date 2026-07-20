/**
 * "Happening now" is computed by converting the current moment into the venue's
 * timezone (PRD handoff §13) — never by normalizing stored times to UTC. Stored
 * happy-hour times are venue-local clock times; day_of_week is ISO (1=Mon..7=Sun).
 */

export interface VenueLocalNow {
  dayOfWeek: number; // ISO 1=Mon .. 7=Sun
  minutes: number; // minutes since venue-local midnight
  hhmm: string; // "HH:MM"
}

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** The current moment expressed in a given IANA timezone. */
export function venueLocalNow(timezone: string, at: Date = new Date()): VenueLocalNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayOfWeek = ISO_WEEKDAY[get("weekday")] ?? 1;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const minute = parseInt(get("minute"), 10);

  return {
    dayOfWeek,
    minutes: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/**
 * A single operating-hours period in ISO-weekday terms. openDay/closeDay are 1=Mon..7=Sun.
 * closeDay/closeMin are null for a venue with no published close (treated as open all that
 * day — Google's 24h representation).
 */
export interface OpenPeriod {
  openDay: number;
  openMin: number;
  closeDay: number | null;
  closeMin: number | null;
}

/** Is the venue open at `now` given its operating periods? */
export function isVenueOpenAt(periods: OpenPeriod[], now: VenueLocalNow): boolean {
  for (const p of periods) {
    // No close published → treat as open the whole open day (24h / unknown close).
    if (p.closeDay === null || p.closeMin === null) {
      if (now.dayOfWeek === p.openDay) return true;
      continue;
    }
    const sameDay = p.closeDay === p.openDay && p.closeMin > p.openMin;
    if (sameDay) {
      if (now.dayOfWeek === p.openDay && now.minutes >= p.openMin && now.minutes < p.closeMin) {
        return true;
      }
      continue;
    }
    // Crosses midnight (closes on a later day, or close minutes ≤ open minutes):
    // open late on the open day, or early on the close day.
    const lateOnOpenDay = now.dayOfWeek === p.openDay && now.minutes >= p.openMin;
    const earlyOnCloseDay = now.dayOfWeek === p.closeDay && now.minutes < p.closeMin;
    if (lateOnOpenDay || earlyOnCloseDay) return true;
  }
  return false;
}

export interface HappyHourWindow {
  daysOfWeek: number[]; // ISO 1..7, the cluster of days this window runs
  allDay: boolean; // true → active any time on listed days (open to close)
  startTime: string | null; // "HH:MM" or "HH:MM:SS"; null when allDay is true
  endTime: string | null; // null = "until close" (or always null when allDay)
  crossesMidnight?: boolean | null;
}

/**
 * Whether a window is active at `now` (already in venue-local terms). A window runs on
 * every day in `daysOfWeek`. Windows that cross midnight (end < start) are active late
 * on each of their days and early the following day.
 *
 * Unbounded windows (allDay or endTime null) are suppressed when `hours` is absent or
 * empty — we never guess a close time; showing "Now" while the venue is shut is the bug
 * we avoid. Bounded windows (known start + end) are independent of operating hours.
 */
export function isWindowActive(
  w: HappyHourWindow,
  now: VenueLocalNow,
  hours?: OpenPeriod[] | null,
): boolean {
  // Unbounded windows have an open-ended side and no intrinsic clock bound there:
  //   - all-day        (both null)
  //   - "until close"  (start set, end null)
  //   - "open until X" (start null, end set) — starts at the venue's open time
  // We can only assert these active if we know the venue's hours; otherwise SUPPRESS
  // (never guess an open/close time — showing "now" while the venue is shut is the bug
  // we fix). The bounded post-midnight tail is intentionally not extended.
  const unbounded = w.allDay || w.startTime == null || w.endTime == null;
  if (unbounded) {
    if (!hours || hours.length === 0) return false;
    if (!isVenueOpenAt(hours, now)) return false;
    const onDay = w.daysOfWeek.includes(now.dayOfWeek);
    if (w.allDay) return onDay;
    // "open until X": active from open until the end time on a listed day.
    if (w.startTime == null) return onDay && now.minutes < toMinutes(w.endTime as string);
    // "until close": active from start onward on a listed day.
    return onDay && now.minutes >= toMinutes(w.startTime);
  }

  // Bounded window (both start and end known) — unchanged, independent of hours.
  if (w.startTime === null) return false; // defensive
  const start = toMinutes(w.startTime);
  const end = toMinutes(w.endTime as string);
  const crosses = w.crossesMidnight ?? end < start;

  if (!crosses) {
    return w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= start && now.minutes < end;
  }
  const lateOnStartDay = w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= start;
  const prevDay = now.dayOfWeek === 1 ? 7 : now.dayOfWeek - 1;
  const earlyNextDay = w.daysOfWeek.includes(prevDay) && now.minutes < end;
  return lateOnStartDay || earlyNextDay;
}

export interface NextWindowStart {
  dayOffset: number; // 0 = today, 1 = tomorrow, … (venue-local days from now)
  isoDay: number; // ISO weekday the window next starts on (1=Mon..7=Sun)
  startTime: string; // "HH:MM" venue-local start
}

/**
 * The next upcoming happy-hour start from `now` (venue-local), scanning the next 7 days.
 * A window "starts" at its startTime on each day in daysOfWeek; open-ended windows
 * (all-day / "open until X") start at the venue's open time that day, resolved from
 * `hours` — if that open time is unknown the window is skipped (we never guess a start we
 * don't have). Today's already-started/passed windows are skipped. Returns null when
 * nothing is resolvable. Intended for the not-currently-active case (pairs with
 * isWindowActive): show "starts <day> at <time>" instead of a bare dot.
 */
export function nextWindowStart(
  windows: HappyHourWindow[],
  now: VenueLocalNow,
  hours?: OpenPeriod[] | null,
): NextWindowStart | null {
  let best: NextWindowStart | null = null;
  for (let offset = 0; offset <= 7; offset++) {
    const isoDay = ((now.dayOfWeek - 1 + offset) % 7) + 1;
    for (const w of windows) {
      if (!w.daysOfWeek.includes(isoDay)) continue;
      let startMin: number | null;
      if (w.startTime != null) {
        startMin = toMinutes(w.startTime);
      } else {
        // all-day / "open until X": the window opens with the venue that day.
        const resolved = resolveBoundsForDay(w, hours, isoDay);
        startMin = resolved ? toMinutes(resolved.startTime) : null;
      }
      if (startMin == null) continue;
      if (offset === 0 && startMin <= now.minutes) continue; // already started or passed today
      if (
        best == null ||
        offset < best.dayOffset ||
        (offset === best.dayOffset && startMin < toMinutes(best.startTime))
      ) {
        best = { dayOffset: offset, isoDay, startTime: minutesToHHMM(startMin) };
      }
    }
  }
  return best;
}

/** Minutes-since-midnight → "HH:MM" (24h, wraps at 1440). */
function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Resolve an open-ended window's bounds to real clock times on a given ISO weekday,
 * using the venue's operating hours. The bounded side passes through unchanged; the
 * open-ended side becomes the venue's earliest open (start) or latest close (end) that
 * day. Split lunch/dinner hours collapse to earliest-open .. latest-close. A cross-
 * midnight close returns its clock value (e.g. 02:00) but ranks later than any same-day
 * close so it wins the "latest close" pick.
 *
 * Returns null — and the caller keeps the existing "close"/"Open to close" text — when:
 *   - the window is fully bounded (nothing to resolve),
 *   - hours are absent/empty,
 *   - no operating period exists for `isoDay`, or
 *   - the side we need (open or close) is unpublished (Google's 24h representation).
 * We never invent a time we don't have.
 */
export function resolveBoundsForDay(
  w: HappyHourWindow,
  hours: OpenPeriod[] | null | undefined,
  isoDay: number,
): { startTime: string; endTime: string } | null {
  const needsOpen = w.allDay || w.startTime == null;
  const needsClose = w.allDay || w.endTime == null;
  if (!needsOpen && !needsClose) return null; // bounded — nothing to resolve

  if (!hours || hours.length === 0) return null;
  const periods = hours.filter((p) => p.openDay === isoDay);
  if (periods.length === 0) return null;

  let openMin: number | null = null;
  for (const p of periods) {
    if (openMin == null || p.openMin < openMin) openMin = p.openMin;
  }

  // Latest close that day. A cross-midnight close (different close day, or close minute
  // ≤ open minute) is later than any same-day close, so rank it +24h while keeping the
  // real clock value to return.
  let closeMin: number | null = null;
  let bestRank = -1;
  for (const p of periods) {
    if (p.closeMin == null) continue;
    const crosses = p.closeDay !== p.openDay || p.closeMin <= p.openMin;
    const rank = crosses ? p.closeMin + 1440 : p.closeMin;
    if (rank > bestRank) {
      bestRank = rank;
      closeMin = p.closeMin;
    }
  }

  if (needsOpen && openMin == null) return null;
  if (needsClose && closeMin == null) return null;

  return {
    startTime: needsOpen ? minutesToHHMM(openMin as number) : (w.startTime as string),
    endTime: needsClose ? minutesToHHMM(closeMin as number) : (w.endTime as string),
  };
}

/**
 * Minutes remaining until an active window closes, given a venue-local now. Returns
 * null when the window has no defined end (all-day or "until close"), so callers can
 * skip the microcopy rather than show "Ends in ?". Callers must have already
 * confirmed the window is active.
 */
export function minutesUntilWindowEnd(
  w: HappyHourWindow,
  now: VenueLocalNow,
): number | null {
  if (w.allDay || w.endTime == null) return null;
  const end = toMinutes(w.endTime);
  const start = w.startTime != null ? toMinutes(w.startTime) : 0;
  const crosses = w.crossesMidnight ?? (w.startTime != null && end < start);

  if (!crosses) {
    // Same-day window: end is later today.
    return end - now.minutes;
  }
  // Cross-midnight: if we're late on a start day, end is tomorrow morning.
  const onStartDay = w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= start;
  if (onStartDay) return 24 * 60 - now.minutes + end;
  // Otherwise we're in the early-morning tail on the day after a start day.
  return end - now.minutes;
}
