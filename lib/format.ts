// ISO 8601 weekday index: 1=Mon … 7=Sun.
const DAY_ABBR = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Collapse a set of weekday indexes into contiguous [start, end] runs. */
function dayRuns(days: number[]): [number, number][] {
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  if (uniq.length === 0) return runs;

  let start = uniq[0];
  let prev = uniq[0];
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] === prev + 1) {
      prev = uniq[i];
    } else {
      runs.push([start, prev]);
      start = prev = uniq[i];
    }
  }
  runs.push([start, prev]);
  return runs;
}

/** [1,2,3,4,5] → "Mon–Fri"; [6,7] → "Sat–Sun"; [1,3] → "Mon, Wed". */
export function formatDays(days: number[]): string {
  return dayRuns(days)
    .map(([a, b]) => (a === b ? DAY_ABBR[a] : `${DAY_ABBR[a]}–${DAY_ABBR[b]}`))
    .join(", ");
}

/** Like {@link formatDays} but spelled out: [1,2,3,4,5] → "Monday – Friday". */
export function formatDaysLong(days: number[]): string {
  return dayRuns(days)
    .map(([a, b]) => (a === b ? DAY_FULL[a] : `${DAY_FULL[a]} – ${DAY_FULL[b]}`))
    .join(", ");
}

/** "15:00:00" → "3 PM"; "15:30" → "3:30 PM"; null → "close". */
export function formatTime(t: string | null): string {
  if (!t) return "close";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function formatPrice(cents: number | null, currency = "USD"): string | null {
  if (cents == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}
