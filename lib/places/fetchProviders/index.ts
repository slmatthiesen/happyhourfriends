/**
 * Anti-bot fetch provider factory + per-run cost guard.
 *
 * getFetchProvider() returns the configured provider (Jina today) or null when none is set up,
 * so the fetch ladder degrades cleanly to free tiers. The provider is the LAST, paid tier — so
 * a module-level per-run cap bounds spend on dense bot-walled cities. The counter is per
 * process: a city enrich run is one process, so JINA_MAX_CALLS caps that run.
 */
import { JinaFetchProvider } from "./jina";
import type { FetchProvider } from "./types";

export type { FetchProvider, AntiBotFetchResult } from "./types";
export { JinaFetchProvider } from "./jina";

let cached: FetchProvider | null | undefined;

/** The configured anti-bot provider, or null when none is set up (no key). Disable explicitly
 *  with DISABLE_ANTI_BOT_FETCH=1. Cached per process; reset for tests via __resetFetchProvider. */
export function getFetchProvider(): FetchProvider | null {
  if (cached !== undefined) return cached;
  if (process.env.DISABLE_ANTI_BOT_FETCH === "1") return (cached = null);
  const apiKey = process.env.JINA_API_KEY;
  cached = apiKey ? new JinaFetchProvider({ apiKey }) : null;
  return cached;
}

/** Test seam: override or reset the cached provider. */
export function __setFetchProvider(p: FetchProvider | null | undefined): void {
  cached = p;
}

// --- Per-run call cap (cost guard) -----------------------------------------------------------
const MAX_CALLS = Number(process.env.JINA_MAX_CALLS) || 60;
let callsUsed = 0;

/** Whether another anti-bot call is allowed under this run's cap. */
export function antiBotCallsRemaining(): number {
  return Math.max(0, MAX_CALLS - callsUsed);
}

/** Count one anti-bot call against the per-run cap. Call this each time the provider is hit. */
export function recordAntiBotCall(): void {
  callsUsed += 1;
}

/** How many anti-bot calls this run has made (for the end-of-run spend report). */
export function antiBotCallsUsed(): number {
  return callsUsed;
}

/** Test seam: reset the per-run counter. */
export function __resetAntiBotCalls(): void {
  callsUsed = 0;
}
