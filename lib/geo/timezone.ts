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
 */
export function isWindowActive(w: HappyHourWindow, now: VenueLocalNow): boolean {
  if (w.allDay) {
    return w.daysOfWeek.includes(now.dayOfWeek);
  }
  // Existing logic — only reached when !allDay, so startTime is guaranteed non-null
  // by the DB CHECK and the normaliser.
  if (w.startTime === null) return false; // defensive — should never happen
  const start = toMinutes(w.startTime);
  const end = w.endTime == null ? 24 * 60 : toMinutes(w.endTime);
  const crosses = w.crossesMidnight ?? (w.endTime != null && end < start);

  if (!crosses) {
    return (
      w.daysOfWeek.includes(now.dayOfWeek) &&
      now.minutes >= start &&
      now.minutes < end
    );
  }

  // Cross-midnight: active late on a start day, or early on the day after a start day.
  const lateOnStartDay = w.daysOfWeek.includes(now.dayOfWeek) && now.minutes >= start;
  const prevDay = now.dayOfWeek === 1 ? 7 : now.dayOfWeek - 1;
  const earlyNextDay = w.daysOfWeek.includes(prevDay) && now.minutes < end;
  return lateOnStartDay || earlyNextDay;
}
