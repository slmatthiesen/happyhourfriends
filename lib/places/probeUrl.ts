/**
 * probeUrl — one HTTP probe of a URL → a normalized {@link ProbeOutcome} for the
 * pure {@link classifySiteHealth} classifier. Never throws.
 *
 * Shared by `scripts/audit-venue-sites.ts` (the link-health audit) and
 * `lib/places/resolveWebsiteUrl.ts` (the deterministic working-URL resolver) so both see
 * exactly what a user's browser would: a real browser UA (to avoid tripping bot walls) and
 * real TLS validation (so expired/invalid certs surface as the failure they are).
 */
import type { ProbeOutcome } from "@/lib/places/siteHealth";

export const PROBE_TIMEOUT_MS = 12_000;

// A real browser UA: a health check should see what a user sees, not trip bot walls that
// would mislabel a perfectly good site as http_error.
export const PROBE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Map a thrown fetch error to the Node/undici code our classifier reads. */
export function errorCodeOf(e: unknown): string {
  const err = e as { name?: string; code?: unknown; cause?: { code?: unknown } };
  if (err?.cause?.code != null) return String(err.cause.code);
  if (err?.code != null) return String(err.code);
  if (err?.name === "AbortError") return "ABORT_ERR";
  return "UNKNOWN";
}

/** One HTTP GET → normalized outcome. Follows redirects; cancels the body to free the socket. */
export async function probeUrl(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": PROBE_USER_AGENT, accept: "text/html,*/*" },
    });
    try {
      await res.body?.cancel();
    } catch {
      /* already consumed/closed */
    }
    return { finalUrl: res.url || url, status: res.status, errorCode: null };
  } catch (e) {
    return { finalUrl: null, status: null, errorCode: errorCodeOf(e) };
  } finally {
    clearTimeout(timer);
  }
}
