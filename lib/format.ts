// ISO 8601 weekday index: 1=Mon … 7=Sun.
const DAY_ABBR = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** [1,2,3,4,5] → "Mon–Fri"; [6,7] → "Sat–Sun"; [1,3] → "Mon, Wed". */
export function formatDays(days: number[]): string {
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  if (uniq.length === 0) return "";

  const runs: [number, number][] = [];
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

  return runs
    .map(([a, b]) => (a === b ? DAY_ABBR[a] : `${DAY_ABBR[a]}–${DAY_ABBR[b]}`))
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
