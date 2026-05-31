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
  // Unbounded windows — all-day, or "until close" (endTime null) — have no intrinsic end.
  // We can only assert them active if we know the venue's hours; otherwise SUPPRESS
  // (never guess a close time — showing "now" while the venue is shut is the bug we fix).
  const unbounded = w.allDay || w.endTime == null;
  if (unbounded) {
    if (!hours || hours.length === 0) return false;
    if (!isVenueOpenAt(hours, now)) return false;
    if (w.allDay) return w.daysOfWeek.includes(now.dayOfWeek);
    // until-close: startTime is non-null (DB CHECK). Active on a listed start day, from
    // start onward, while the venue is open. (The rare post-midnight tail is intentionally
    // not extended — under-reporting late-night is acceptable; over-reporting "open" is not.)
    if (w.startTime === null) return false; // defensive
    return w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= toMinutes(w.startTime);
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
