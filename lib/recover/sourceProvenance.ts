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
import { isFirstPartyUrl } from "@/lib/contribution/firstParty";

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
 * Hosts that legitimately serve many different businesses' menus/PDFs. A source on one
 * of these can't be host-matched to the venue's own domain, so the provenance check
 * skips it rather than hiding real data (the diagnosis's "isn't a known menu host"
 * carve-out). Ordering-only platforms that signal "not a real venue" are handled
 * separately via platform_website_url, not here.
 */
const MENU_HOSTS = [
  "toasttab.com",
  "squarespace.com",
  "squarespace-cdn.com",
  "wixsite.com",
  "wixstatic.com",
  "filesusr.com",
  "usrfiles.com",
  "square.site",
  "popmenu.com",
  "clover.com",
  "weebly.com",
  "godaddysites.com",
  "drive.google.com",
  "docs.google.com",
  "googleusercontent.com",
  "dropbox.com",
  "dropboxusercontent.com",
  "amazonaws.com",
  "cloudfront.net",
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
  if (host(sourceUrl) === null) return false; // unparseable → can't judge
  if (isMenuHost(sourceUrl)) return false;
  return !isFirstPartyUrl(sourceUrl, venueWebsite);
}
