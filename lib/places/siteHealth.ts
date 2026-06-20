/**
 * siteHealth — pure classifier that turns a network probe of a venue's website into a
 * health verdict, so operator tooling can flag venues whose link is broken for review.
 *
 * Motivation (2026-06-19, Ernie's Inn / Scottsdale): a stored `website_url` can point at
 * the RIGHT venue yet still "seem bad" — the venue let its TLS certificate lapse, so the
 * site throws a cert error in every browser. URL-form normalization (http→https, www) does
 * NOT fix that; only detecting the broken site does. This module classifies the common
 * failure modes a user would hit when clicking through:
 *
 *   - expired_cert / invalid_cert — server is reachable but the certificate is bad
 *   - dns_dead                    — domain no longer resolves (gone)
 *   - unreachable                 — connection refused / reset / timed out
 *   - http_error                  — reached the server, final response was 4xx/5xx
 *   - parked                      — resolves 200 but lands on a domain-parking/for-sale host
 *   - ok                          — final response was a healthy 2xx
 *
 * Pure and network-free: the caller does the fetch and hands us a normalized {@link ProbeOutcome};
 * we never touch I/O so the rules are unit-testable. Conservative by design — when a signal is
 * ambiguous we prefer `unreachable` (a soft "worth a look") over a confident wrong label.
 */

export type SiteHealth =
  | "ok"
  | "blocked"
  | "expired_cert"
  | "invalid_cert"
  | "dns_dead"
  | "unreachable"
  | "http_error"
  | "parked";

/** Healths that are NOT a broken link from a user's perspective. `blocked` is a bot wall
 *  (Cloudflare/Akamai 401/403/406/429): our probe is refused but a real browser loads fine,
 *  so it must NOT pollute the review queue (same bot-wall set lib/verification/fetchUrl treats
 *  as "render-fallback owns it", not a failure). */
const NON_BROKEN: ReadonlySet<SiteHealth> = new Set<SiteHealth>(["ok", "blocked"]);

/** Statuses that mean "the server refused our automated request", not "the page is gone". */
const BOT_WALL_STATUSES = new Set([401, 403, 406, 429]);

/** Social platforms that refuse automated requests with assorted 4xx (Facebook commonly
 *  returns 400 to a bot) yet load fine in a real browser. A venue whose website_url is one
 *  of these isn't a BROKEN link — so any 4xx from here is a bot wall, not http_error. */
const SOCIAL_HOSTS = ["facebook.com", "fb.com", "instagram.com", "twitter.com", "x.com", "linktr.ee", "yelp.com"];

/** Strict hostname match: exact domain or a subdomain of it (so "x.com" never matches
 *  "phoenix.com"). Use for precise host lists; the looser parked-host check stays substring. */
function matchesHost(host: string, needles: string[]): boolean {
  return needles.some((n) => host === n || host.endsWith("." + n));
}

/** Normalized result of one HTTP probe. Exactly one of (status) or (errorCode) is set:
 *  a completed response carries `status`; a thrown fetch carries `errorCode` (the
 *  Node/undici `err.cause.code`, e.g. "CERT_HAS_EXPIRED", "ENOTFOUND"). */
export interface ProbeOutcome {
  /** Resolved URL after redirects; null if no response was ever received. */
  finalUrl: string | null;
  /** Final HTTP status, or null if the fetch threw before a response. */
  status: number | null;
  /** Node/undici error code from a thrown fetch (`err.cause?.code`), or null on a response. */
  errorCode: string | null;
}

export interface HealthVerdict {
  health: SiteHealth;
  /** Convenience: true for every health except "ok". */
  broken: boolean;
  /** Human-readable one-liner for the operator report. */
  detail: string;
}

/** TLS error codes meaning "the certificate itself is expired" (server is otherwise up). */
const EXPIRED_CERT_CODES = new Set(["CERT_HAS_EXPIRED"]);

/** TLS error codes meaning "certificate present but untrusted" (self-signed, wrong host, …). */
const INVALID_CERT_CODES = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_FORMAT",
  "HOSTNAME_MISMATCH",
]);

/** DNS-resolution failures meaning "the domain is gone / never existed". */
const DNS_DEAD_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME"]);

/** Hosts whose business IS holding parked / for-sale domains. A venue link that lands here
 *  has lapsed and been re-pointed at a marketplace — substring match on the final host. */
const PARKING_HOSTS = [
  "sedoparking",
  "sedo.com",
  "dan.com",
  "afternic",
  "hugedomains",
  "parkingcrew",
  "bodis.com",
  "above.com",
  "uniregistry",
  "domainmarket",
  "cashparking",
  "parklogic",
  "domainsponsor",
  "voodoo.com",
  "buydomains",
  "godaddysites-parked",
];

function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Naive eTLD+1 (last two labels). Good enough to tell an off-domain redirect apart; not a PSL. */
function registrableDomain(host: string): string {
  return host.toLowerCase().split(".").filter(Boolean).slice(-2).join(".");
}

function isParkedHost(host: string): boolean {
  return PARKING_HOSTS.some((p) => host.includes(p));
}

/**
 * Classify a probe outcome into a health verdict.
 *
 * @param o            the normalized probe outcome
 * @param originalUrl  the URL we set out to fetch (used to detect off-domain redirects to parking)
 */
export function classifySiteHealth(o: ProbeOutcome, originalUrl: string): HealthVerdict {
  const ok = (health: SiteHealth, detail: string): HealthVerdict => ({
    health,
    broken: !NON_BROKEN.has(health),
    detail,
  });

  // 1) A thrown fetch — no HTTP response was reached. The error code is the signal.
  if (o.errorCode) {
    const code = String(o.errorCode).toUpperCase();
    if (EXPIRED_CERT_CODES.has(code)) return ok("expired_cert", "TLS certificate has expired");
    if (INVALID_CERT_CODES.has(code)) return ok("invalid_cert", `TLS certificate not trusted (${code})`);
    if (DNS_DEAD_CODES.has(code)) return ok("dns_dead", `domain does not resolve (${code})`);
    // ECONNREFUSED / ECONNRESET / ETIMEDOUT / EHOSTUNREACH / ENETUNREACH / UND_ERR_* / ABORT_ERR / …
    return ok("unreachable", `connection failed (${code})`);
  }

  // 2) A completed response.
  if (o.status != null) {
    const finalHost = hostnameOf(o.finalUrl);
    const startHost = hostnameOf(originalUrl);
    // Parked detection only fires on an OFF-domain redirect to a known parking host — a venue
    // legitimately redirecting brand.com → brandrestaurant.com must never be flagged.
    if (
      finalHost &&
      isParkedHost(finalHost) &&
      (!startHost || registrableDomain(finalHost) !== registrableDomain(startHost))
    ) {
      return ok("parked", `redirects to a parked/for-sale domain (${finalHost})`);
    }
    if (BOT_WALL_STATUSES.has(o.status)) return ok("blocked", `bot wall (HTTP ${o.status}); a real browser likely loads fine`);
    if (o.status >= 400 && (finalHost || startHost) && matchesHost(finalHost ?? startHost ?? "", SOCIAL_HOSTS)) {
      return ok("blocked", `social-page link refused our probe (HTTP ${o.status}); loads in a browser`);
    }
    if (o.status >= 400) return ok("http_error", `server returned HTTP ${o.status}`);
    return ok("ok", `HTTP ${o.status}`);
  }

  // 3) Neither a status nor an error code — shouldn't happen; treat as worth a look.
  return ok("unreachable", "no response and no error code");
}
