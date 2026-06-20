/**
 * In-memory sliding-window rate limiter for the /api/signals endpoint. The signal
 * is a per-fingerprint toggle (one row max), so this guards request VOLUME — a user
 * hammering add/remove for hours — not data integrity. Single-instance only (the app
 * runs one Next server); the store resets on restart, which is acceptable for a
 * delight-gesture limiter. Multi-instance would need a shared store (out of scope).
 */
export interface RateWindow {
  windowMs: number;
  max: number;
}

// Defaults: 10/min burst + 30/hour sustained. Tunable.
export const SIGNAL_WINDOWS: RateWindow[] = [
  { windowMs: 60_000, max: 10 },
  { windowMs: 3_600_000, max: 30 },
];

/**
 * Pure: given prior event timestamps (ms) and `now`, decide whether a new event is
 * allowed. When allowed, returns the pruned list with `now` appended (persist it).
 * When blocked, returns the pruned list unchanged (do not record the blocked hit).
 */
export function evaluateWindow(
  events: number[],
  now: number,
  windows: RateWindow[] = SIGNAL_WINDOWS,
): { allowed: boolean; events: number[] } {
  const maxWindow = Math.max(...windows.map((w) => w.windowMs));
  const recent = events.filter((t) => now - t < maxWindow);
  for (const w of windows) {
    const inWindow = recent.filter((t) => now - t < w.windowMs).length;
    if (inWindow >= w.max) return { allowed: false, events: recent };
  }
  return { allowed: true, events: [...recent, now] };
}

const store = new Map<string, number[]>();

/**
 * Stateful wrapper: check + record one event for `key`. Returns true when the request
 * is LIMITED (should 429). `now` is injectable for tests.
 */
export function hitSignalLimit(key: string, now: number = Date.now()): boolean {
  const prior = store.get(key) ?? [];
  const { allowed, events } = evaluateWindow(prior, now);
  store.set(key, events);
  return !allowed;
}

/** Test seam — clear the in-memory store. */
export function __resetSignalLimiter(): void {
  store.clear();
}
