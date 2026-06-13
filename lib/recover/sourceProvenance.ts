/**
 * sourceProvenance — persist-time guard for the highest-leverage D-bucket failure in
 * the 2026-06-13 extraction-miss diagnosis: a stored happy-hour window whose
 * `source_url` is NOT the venue's own site silently poisons a good venue.
 *
 * Real cases this catches (source host ≠ venue host, neither a menu-hosting platform):
 *   - The Depot Bar — source thedepotbar.com, venue thedepotbar.shop (a different,
 *     Nashville business; same brand name, different TLD = different domain).
 *   - Blanco Tacos — source www.blancococinacantina.com (a sibling-brand domain),
 *     venue blancotacostequila.com.
 * Aggregator leaks (cheerhop & siblings) are dropped earlier by isDenylistedSource at
 * extraction; this is the second, deterministic layer at the ONE persist path.
 *
 * NON-DESTRUCTIVE by design: a suspect window is HIDDEN (active=false) for operator
 * review, never deleted — matching the realness/reconcile gates it sits beside.
 *
 * Pure, no I/O. Returns false (no opinion) whenever we cannot fairly judge: no source,
 * no stored venue website, an unparseable source, or a source on a known menu/file
 * host whose domain identifies the platform, not the business.
 */
import { isDenylistedSource } from "@/lib/ai/sourceDenylist";

/** Lowercase host with a leading "www." stripped; null if unparseable. */
function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Registrable domain (eTLD+1) of an already-normalized host — the unit of "same
 * business": sibling subdomains (locations.doghaus.com vs downtownphoenix.doghaus.com)
 * share one, so they aren't flagged, while a different TLD (thedepotbar.com vs
 * thedepotbar.shop) or brand (blancococinacantina.com vs blancotacostequila.com) does
 * not. US-focused: defaults to the last two labels, with a small set of common
 * multi-part public suffixes handled explicitly. Not a full PSL — extend as needed.
 */
const MULTIPART_TLDS = new Set([
  "co.uk", "org.uk", "com.au", "net.au", "co.nz", "com.br", "co.jp", "com.mx",
]);
function registrableDomain(normalizedHost: string): string {
  const parts = normalizedHost.split(".");
  if (parts.length <= 2) return normalizedHost;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTIPART_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/**
 * Hosts that legitimately serve many different businesses' menus/PDFs. A source on one
 * of these can't be host-matched to the venue's own domain, so the provenance check
 * skips it rather than hiding real data (the diagnosis's "isn't a known menu host"
 * carve-out). Ordering-only platforms that signal "not a real venue" are handled
 * separately via platform_website_url, not here.
 */
const MENU_HOSTS = [
  // Site builders + their asset CDNs (a venue's own menu image/PDF lives here).
  "squarespace.com",
  "squarespace-cdn.com",
  "wixsite.com",
  "wixstatic.com",
  "filesusr.com",
  "usrfiles.com",
  "weebly.com",
  "godaddysites.com",
  "wsimg.com", // GoDaddy Website Builder asset CDN (img1.wsimg.com)
  "cdn-website.com", // Duda site builder CDN (irp.cdn-website.com)
  "website-files.com", // Webflow asset CDN (cdn.prod.website-files.com)
  "wp.com", // WordPress.com / Jetpack image CDN (i0/i1/i2.wp.com)
  "shopify.com", // Shopify asset CDN (cdn.shopify.com)
  // Menu / ordering platforms restaurants host their OWN menu on.
  "toasttab.com",
  "square.site",
  "popmenu.com",
  "popmenucloud.com", // Popmenu asset CDN
  "sagemenu.com", // digital-menu platform
  "clover.com",
  // Generic file / object hosts used for menu PDFs & QR menus.
  "drive.google.com",
  "docs.google.com",
  "googleusercontent.com",
  "dropbox.com",
  "dropboxusercontent.com",
  "amazonaws.com",
  "cloudfront.net",
  "qr-code-generator.com", // QR-menu file host (cdn.qr-code-generator.com)
];

function isMenuHost(url: string): boolean {
  const h = host(url);
  if (!h) return false;
  return MENU_HOSTS.some((m) => h === m || h.endsWith(`.${m}`));
}

/**
 * True when a window's `source_url` is NOT verifiably the venue's own site and should be
 * HIDDEN for review. No opinion (false) when we can't judge: missing/garbage source,
 * no stored venue website, or a known menu-hosting platform.
 */
export function isSourceProvenanceSuspect(
  sourceUrl: string | null | undefined,
  venueWebsite: string | null | undefined,
): boolean {
  if (!sourceUrl || !venueWebsite) return false;
  const sourceHost = host(sourceUrl);
  const venueHost = host(venueWebsite);
  if (sourceHost === null || venueHost === null) return false; // unparseable → can't judge
  if (isDenylistedSource(sourceUrl)) return true; // aggregator leak — never trust
  if (isMenuHost(sourceUrl)) return false; // platform host, can't be domain-matched
  // Same business iff same registrable domain (sibling subdomains count, e.g. Dog Haus).
  return registrableDomain(sourceHost) !== registrableDomain(venueHost);
}
