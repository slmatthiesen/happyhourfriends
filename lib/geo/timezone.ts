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
  dayOfWeek: number; // ISO 1..7
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string | null; // null = "until close"
  crossesMidnight?: boolean | null;
}

/**
 * Whether a window is active at `now` (already in venue-local terms). Windows that
 * cross midnight (end < start) are active late on their own day and early the next.
 */
export function isWindowActive(w: HappyHourWindow, now: VenueLocalNow): boolean {
  const start = toMinutes(w.startTime);
  const end = w.endTime == null ? 24 * 60 : toMinutes(w.endTime);
  const crosses = w.crossesMidnight ?? (w.endTime != null && end < start);

  if (!crosses) {
    return now.dayOfWeek === w.dayOfWeek && now.minutes >= start && now.minutes < end;
  }

  const nextDay = w.dayOfWeek === 7 ? 1 : w.dayOfWeek + 1;
  const lateOnStartDay = now.dayOfWeek === w.dayOfWeek && now.minutes >= start;
  const earlyNextDay = now.dayOfWeek === nextDay && now.minutes < end;
  return lateOnStartDay || earlyNextDay;
}
