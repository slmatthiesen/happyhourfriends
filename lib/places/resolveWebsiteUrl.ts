/**
 * resolveWebsiteUrl — deterministic recovery of a working URL for a venue whose stored
 * `website_url` is broken. Many breakages in the link-health audit are pure URL-form issues:
 * the `www.` host has no DNS but the apex does, the cert is valid on one host but not the
 * other, or `http` works but the stored `https` doesn't (and vice-versa). Those need no
 * research — just try the variants and keep the first that a browser would load cleanly.
 *
 * What it does NOT fix: a wrong path / 404 (e.g. a moved menu page) or a genuinely dead
 * domain. Those return `null` → the operator edits or removes the venue by hand. We never
 * guess a different domain, and never suggest a competitor/aggregator (first-party guard).
 *
 * Candidate generation is pure and unit-tested; the network probe is injected so tests run
 * hermetically.
 */
import { classifySiteHealth, type ProbeOutcome } from "@/lib/places/siteHealth";
import { probeUrl } from "@/lib/places/probeUrl";
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";

export interface ResolveResult {
  /** A working URL (HTTP 200 + valid cert), or null if no variant loaded cleanly. */
  suggestedUrl: string | null;
  reason: string;
}

/**
 * Ordered, de-duplicated URL variants to try for a broken `website_url`, preserving the
 * original path + query. https is preferred over http; the original www-ness is tried before
 * its toggle. The exact original URL is excluded (it's already known broken). Returns [] if
 * the input can't be parsed.
 */
export function websiteUrlCandidates(originalUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return [];
  }
  const host = parsed.hostname.toLowerCase();
  const bare = host.replace(/^www\./, "");
  const hostsInOrder = host.startsWith("www.") ? [host, bare] : [bare, `www.${bare}`];
  const pathAndQuery = parsed.pathname + parsed.search;

  const original = parsed.toString();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const scheme of ["https:", "http:"]) {
    for (const h of hostsInOrder) {
      const candidate = `${scheme}//${h}${pathAndQuery}`;
      if (candidate === original) continue; // already known broken
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

/**
 * Probe each candidate in priority order; return the first whose health is `ok`
 * (HTTP 200 + valid TLS), preferring its post-redirect final URL as the canonical link.
 * Skips any candidate or redirect target on the first-party denylist.
 *
 * @param probe injected for tests; defaults to the real network probe.
 */
export async function resolveWorkingUrl(
  originalUrl: string,
  probe: (url: string) => Promise<ProbeOutcome> = probeUrl,
): Promise<ResolveResult> {
  const candidates = websiteUrlCandidates(originalUrl);
  if (candidates.length === 0) return { suggestedUrl: null, reason: "unparseable URL" };

  for (const candidate of candidates) {
    if (isDenylistedSource(candidate)) continue;
    const outcome = await probe(candidate);
    if (classifySiteHealth(outcome, candidate).health !== "ok") continue;
    // Prefer the canonical post-redirect URL, but never hand back a denylisted/parked target.
    const resolved = outcome.finalUrl ?? candidate;
    if (isDenylistedSource(resolved)) continue;
    return { suggestedUrl: resolved, reason: `working variant of broken ${originalUrl}` };
  }
  return { suggestedUrl: null, reason: "no working www/protocol/redirect variant" };
}
